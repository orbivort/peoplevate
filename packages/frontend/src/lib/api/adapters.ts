import type {
  AnomalyAlert,
  ConsentRecord,
  DataBreach,
  DataSubjectAccessRequest,
  Department,
  Position,
  Employee,
  EncryptionKeyVersion,
  ExpiryAlert,
  User,
  EmployeeDocument,
  AuditLogEntry,
  RetentionPolicy,
} from '@/types';

/**
 * Adapters that translate the backend's snake_case API payloads into the
 * camelCase shapes the frontend components expect.
 *
 * Backend convention:
 *  - List/detail responses use `first_name`, `employee_no`, ... and embed
 *    related records as nested objects (`department: { id, name }`,
 *    `position: { id, name }`, `manager: { id, first_name, last_name }`).
 *  - Frontend types flatten those into `departmentName`, `positionName`,
 *    `managerName` plus the ids.
 */

function formatName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(' ') || '';
}

/** Map a backend EmploymentType enum (e.g. FULL_TIME) to the frontend label. */
export function mapEmploymentType(value: string | null | undefined): Employee['employmentType'] {
  switch ((value ?? '').toUpperCase()) {
    case 'FULL_TIME':
      return 'Full-time';
    case 'PART_TIME':
      return 'Part-time';
    case 'CONTRACT':
      return 'Contract';
    default:
      return 'Full-time';
  }
}

/** Map a backend EmploymentStatus enum (e.g. NEW_HIRE) to the frontend label. */
export function mapEmploymentStatus(value: string | null | undefined): Employee['status'] {
  switch ((value ?? '').toUpperCase()) {
    case 'NEW_HIRE':
      return 'New Hire';
    case 'PROBATION':
      return 'Probation';
    case 'ACTIVE':
      return 'Active';
    case 'ON_LEAVE':
      return 'On Leave';
    case 'TERMINATED':
      return 'Terminated';
    default:
      return 'Active';
  }
}

/** Map a backend Gender enum (e.g. FEMALE) to the frontend label. */
function mapGender(value: string | null | undefined): Employee['gender'] {
  switch ((value ?? '').toUpperCase()) {
    case 'MALE':
      return 'Male';
    case 'FEMALE':
      return 'Female';
    case 'OTHER':
      return 'Other';
    default:
      return 'Other';
  }
}

type BackendRecord = Record<string, unknown>;

export function adaptDepartment(raw: BackendRecord): Department {
  const parent = raw.parent as BackendRecord | null | undefined;
  return {
    id: String(raw.id),
    name: String(raw.name),
    description: (raw.description as string | null) ?? undefined,
    parentId: (raw.parent_id as string | null) ?? (parent?.id as string | null) ?? null,
    createdAt: (raw.created_at as string) ?? new Date().toISOString(),
    positionCount: Number(raw.positionCount ?? raw.position_count ?? 0),
    employeeCount: Number(raw.employeeCount ?? raw.employee_count ?? 0),
  };
}

export function adaptPosition(raw: BackendRecord): Position {
  const dept = (raw.department as BackendRecord | null) ?? {};
  return {
    id: String(raw.id),
    name: String(raw.name),
    grade: (raw.grade as string | null) ?? undefined,
    description: (raw.description as string | null) ?? undefined,
    departmentId: String(dept.id ?? raw.department_id ?? ''),
    departmentName: String(dept.name ?? ''),
    employeeCount: Number(raw.employeeCount ?? raw.employee_count ?? 0),
    createdAt: (raw.created_at as string) ?? new Date().toISOString(),
  };
}

export function adaptEmployee(raw: BackendRecord): Employee {
  const dept = (raw.department as BackendRecord | null) ?? {};
  const pos = (raw.position as BackendRecord | null) ?? {};
  const mgr = (raw.manager as BackendRecord | null) ?? null;
  const rawSal = raw.salary;
  const salary =
    typeof rawSal === 'number'
      ? rawSal
      : typeof rawSal === 'string' && rawSal !== 'Restricted'
        ? Number(rawSal)
        : 0;

  return {
    id: String(raw.id),
    employeeNo: String(raw.employeeNo ?? raw.employee_no ?? ''),
    firstName: String(raw.firstName ?? raw.first_name ?? ''),
    lastName: String(raw.lastName ?? raw.last_name ?? ''),
    dateOfBirth: (raw.dateOfBirth as string) ?? (raw.date_of_birth as string) ?? '',
    gender: mapGender(raw.gender as string),
    nationalId: (raw.nationalId as string) ?? '',
    email: String(raw.email ?? ''),
    phone: (raw.phone as string | null) ?? '',
    address: (raw.address as string | null) ?? '',
    emergencyContactName: (raw.emergencyContactName as string) ?? '',
    emergencyContactRelationship: (raw.emergencyContactRelationship as string) ?? '',
    emergencyContactPhone: (raw.emergencyContactPhone as string) ?? '',
    departmentId: String(dept.id ?? raw.department_id ?? ''),
    departmentName: String(dept.name ?? ''),
    positionId: String(pos.id ?? raw.position_id ?? ''),
    positionName: String(pos.name ?? ''),
    managerId: mgr?.id ? String(mgr.id) : null,
    managerName: mgr?.id
      ? formatName(mgr.first_name as string | undefined, mgr.last_name as string | undefined)
      : null,
    hireDate: (raw.hireDate as string) ?? (raw.hire_date as string) ?? '',
    employmentType: mapEmploymentType(
      (raw.employmentType as string) ?? (raw.employment_type as string),
    ),
    salary,
    status: mapEmploymentStatus(raw.status as string),
    deactivationDate:
      (raw.deactivationDate as string | null) ?? (raw.deactivation_date as string | null) ?? null,
    avatarUrl: (raw.avatarUrl as string | undefined) ?? (raw.avatar_url as string | undefined),
    createdAt: (raw.createdAt as string) ?? (raw.created_at as string) ?? new Date().toISOString(),
    updatedAt: (raw.updatedAt as string) ?? (raw.updated_at as string) ?? new Date().toISOString(),
  };
}

/** Map a backend role enum (e.g. ADMIN) to the frontend Role label. */
function mapRole(role: string | undefined | null): User['role'] {
  const normalized = (role ?? '').toUpperCase().replace(/[\s_-]+/g, '_');
  switch (normalized) {
    case 'ADMIN':
      return 'Admin';
    case 'HR_MANAGER':
      return 'HR Manager';
    case 'MANAGER':
      return 'Manager';
    default:
      return 'Employee';
  }
}

/** Map a backend user status enum to the frontend status literal. */
function mapStatus(status: string | undefined | null): User['status'] {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'active';
    case 'DEACTIVATED':
      return 'deactivated';
    case 'PENDING_SETUP':
      return 'pending_setup';
    default:
      return 'active';
  }
}

export function adaptUser(raw: BackendRecord): User {
  const emp = (raw.employee as BackendRecord | null) ?? {};
  return {
    id: String(raw.id),
    email: String(raw.email),
    role: mapRole(raw.role as string),
    status: mapStatus(raw.status as string),
    employeeId: emp?.id != null ? String(emp.id) : undefined,
  };
}

export function adaptDocument(raw: BackendRecord): EmployeeDocument {
  return {
    id: String(raw.id),
    employeeId: (raw.employeeId as string) ?? (raw.employee_id as string) ?? '',
    type: (raw.type as EmployeeDocument['type']) ?? 'Other',
    originalFilename: String(raw.originalFilename ?? raw.original_filename ?? ''),
    fileSize: Number(raw.fileSize ?? raw.file_size ?? 0),
    mimeType: String(raw.mimeType ?? raw.mime_type ?? ''),
    uploadedBy: (raw.uploadedBy as string) ?? (raw.uploaded_by as string) ?? '',
    uploadedAt:
      (raw.uploadedAt as string) ??
      (raw.createdAt as string) ??
      (raw.created_at as string) ??
      new Date().toISOString(),
    expiryDate: (raw.expiryDate as string | null) ?? (raw.expiry_date as string | null) ?? null,
  };
}

export function adaptAuditLog(raw: BackendRecord): AuditLogEntry {
  const rawChanges = Array.isArray(raw.changes) ? (raw.changes as Record<string, unknown>[]) : [];
  return {
    id: String(raw.id),
    actorId: String(raw.actor_id ?? raw.actorId ?? ''),
    actorName: String(raw.actor_name ?? raw.actorName ?? ''),
    action: (raw.action as AuditLogEntry['action']) ?? 'UPDATE',
    entity: String(raw.entity ?? ''),
    entityLabel: String(
      raw.entity_label ?? raw.entityLabel ?? humanizeEntity(String(raw.entity ?? '')),
    ),
    entityId: String(raw.entity_id ?? raw.entityId ?? ''),
    changes: rawChanges.map((c) => ({
      field: String(c.field ?? ''),
      label: String(c.label ?? c.field ?? ''),
      old: c.old != null ? String(c.old) : null,
      new: c.new != null ? String(c.new) : null,
      sensitive: Boolean(c.sensitive),
    })),
    status: String(raw.status ?? 'Success'),
    timestamp: (raw.timestamp as string) ?? new Date().toISOString(),
  };
}

/**
 * Fallback humanizer for entity enum values. The backend already sends a
 * humanized `entity_label`, but this keeps mock/legacy data readable too.
 */
function humanizeEntity(entity: string): string {
  if (!entity) return entity;
  return entity
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function adaptExpiryAlert(raw: BackendRecord): ExpiryAlert {
  const severity = String(raw.severity ?? '').toLowerCase();
  return {
    id: String(raw.id),
    documentId: (raw.document_id as string) ?? '',
    employeeId: (raw.employee_id as string) ?? '',
    employeeName: (raw.employee_name as string) ?? '',
    documentType: (raw.document_type as ExpiryAlert['documentType']) ?? 'Other',
    expiryDate: (raw.expiry_date as string) ?? new Date().toISOString(),
    daysUntilExpiry: Number(raw.days_until_expiry ?? 0),
    severity: severity === 'EXPIRED' || severity === 'expired' ? 'expired' : 'soon',
    acknowledged: Boolean(raw.acknowledged),
  };
}

// ── GDPR adapters ─────────────────────────────────────────────

function snake(raw: BackendRecord, snakeKey: string, camelKey?: string): string | null | undefined {
  return (raw[camelKey ?? snakeKey] ?? raw[snakeKey]) as string | null | undefined;
}

export function adaptRetentionPolicy(raw: BackendRecord): RetentionPolicy {
  return {
    id: String(raw.id),
    dataCategory: String(
      raw.dataCategory ?? raw.data_category ?? '',
    ) as RetentionPolicy['dataCategory'],
    retentionYears: Number(raw.retentionYears ?? raw.retention_years ?? 0),
    action: String(raw.action ?? '') as RetentionPolicy['action'],
    description: (raw.description as string | null | undefined) ?? null,
    isDefault: Boolean(raw.isDefault ?? raw.is_default ?? false),
    createdAt: (snake(raw, 'created_at') as string) ?? new Date().toISOString(),
    updatedAt: (snake(raw, 'updated_at') as string) ?? new Date().toISOString(),
  };
}

export function adaptDsar(raw: BackendRecord): DataSubjectAccessRequest {
  return {
    id: String(raw.id),
    requestType: String(
      raw.requestType ?? raw.request_type ?? '',
    ) as DataSubjectAccessRequest['requestType'],
    status: String(raw.status ?? '') as DataSubjectAccessRequest['status'],
    dataSubjectUserId:
      (raw.dataSubjectUserId as string | null) ??
      (raw.data_subject_user_id as string | null) ??
      null,
    dataSubjectEmail: String(raw.dataSubjectEmail ?? raw.data_subject_email ?? ''),
    description: (raw.description as string | null) ?? null,
    identityVerifiedBy:
      (raw.identityVerifiedBy as string | null) ??
      (raw.identity_verified_by_id as string | null) ??
      null,
    identityVerifiedAt:
      (raw.identityVerifiedAt as string | null) ??
      (raw.identity_verified_at as string | null) ??
      null,
    verifiedAt: (raw.verifiedAt as string | null) ?? (raw.verified_at as string | null) ?? null,
    completedAt: (raw.completedAt as string | null) ?? (raw.completed_at as string | null) ?? null,
    slaDeadline: (raw.slaDeadline as string | null) ?? (raw.sla_deadline as string | null) ?? null,
    assignedTo: (raw.assignedTo as string | null) ?? (raw.assigned_to_id as string | null) ?? null,
    rejectionReason:
      (raw.rejectionReason as string | null) ?? (raw.rejection_reason as string | null) ?? null,
    createdAt: (snake(raw, 'created_at') as string) ?? new Date().toISOString(),
    updatedAt: (snake(raw, 'updated_at') as string) ?? new Date().toISOString(),
  };
}

export function adaptBreach(raw: BackendRecord): DataBreach {
  return {
    id: String(raw.id),
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    detectionAt:
      (raw.detectionAt as string) ?? (raw.detection_at as string) ?? new Date().toISOString(),
    severity: String(raw.severity ?? '') as DataBreach['severity'],
    isHighRisk: Boolean(raw.isHighRisk ?? raw.is_high_risk ?? false),
    dataCategoriesAffected: Array.isArray(
      raw.dataCategoriesAffected ?? raw.data_categories_affected,
    )
      ? ((raw.dataCategoriesAffected ?? raw.data_categories_affected) as string[])
      : [],
    affectedSubjectsCount: Number(raw.affectedSubjectsCount ?? raw.affected_subjects_count ?? 0),
    containmentStatus: String(
      raw.containmentStatus ?? raw.containment_status ?? '',
    ) as DataBreach['containmentStatus'],
    rootCause: (raw.rootCause as string | null) ?? (raw.root_cause as string | null) ?? null,
    resolution: (raw.resolution as string | null) ?? null,
    saNotificationDeadline:
      (raw.saNotificationDeadline as string) ??
      (raw.sa_notification_deadline as string) ??
      new Date().toISOString(),
    saNotifiedAt:
      (raw.saNotifiedAt as string | null) ?? (raw.sa_notified_at as string | null) ?? null,
    saNotificationMethod:
      (raw.saNotificationMethod as string | null) ??
      (raw.sa_notification_method as string | null) ??
      null,
    saNotificationReference:
      (raw.saNotificationReference as string | null) ??
      (raw.sa_notification_reference as string | null) ??
      null,
    subjectNotificationPlan:
      (raw.subjectNotificationPlan as string | null) ??
      (raw.subject_notification_plan as string | null) ??
      null,
    subjectNotifiedAt:
      (raw.subjectNotifiedAt as string | null) ??
      (raw.subject_notified_at as string | null) ??
      null,
    createdBy: (raw.createdBy as string | null) ?? (raw.created_by_id as string | null) ?? null,
    createdAt: (snake(raw, 'created_at') as string) ?? new Date().toISOString(),
    updatedAt: (snake(raw, 'updated_at') as string) ?? new Date().toISOString(),
  };
}

export function adaptConsent(raw: BackendRecord): ConsentRecord {
  return {
    id: String(raw.id),
    dataSubjectUserId:
      (raw.dataSubjectUserId as string | null) ??
      (raw.data_subject_user_id as string | null) ??
      null,
    dataSubjectEmail: String(raw.dataSubjectEmail ?? raw.data_subject_email ?? ''),
    processingPurpose: String(raw.processingPurpose ?? raw.processing_purpose ?? ''),
    consentText: String(raw.consentText ?? raw.consent_text ?? ''),
    noticeVersion: String(raw.noticeVersion ?? raw.notice_version ?? ''),
    mechanism: String(raw.mechanism ?? '') as ConsentRecord['mechanism'],
    ipAddressTruncated:
      (raw.ipAddressTruncated as string | null) ??
      (raw.ip_address_truncated as string | null) ??
      null,
    status: String(raw.status ?? '') as ConsentRecord['status'],
    withdrawsConsentId:
      (raw.withdrawsConsentId as string | null) ??
      (raw.withdraws_consent_id as string | null) ??
      null,
    lawfulBasisOverride:
      (raw.lawfulBasisOverride as string | null) ??
      (raw.lawful_basis_override as string | null) ??
      null,
    recordedAt:
      (raw.recordedAt as string) ?? (raw.recorded_at as string) ?? new Date().toISOString(),
    createdAt: (snake(raw, 'created_at') as string) ?? new Date().toISOString(),
    updatedAt: (snake(raw, 'updated_at') as string) ?? new Date().toISOString(),
  };
}

export function adaptKeyVersion(raw: BackendRecord): EncryptionKeyVersion {
  return {
    id: String(raw.id),
    keyId: String(raw.keyId ?? raw.key_id ?? ''),
    purpose: String(raw.purpose ?? '') as EncryptionKeyVersion['purpose'],
    algorithm: String(raw.algorithm ?? 'AES-256-GCM'),
    status: String(raw.status ?? '') as EncryptionKeyVersion['status'],
    createdAt: (snake(raw, 'created_at') as string) ?? new Date().toISOString(),
    activatedAt: (raw.activatedAt as string | null) ?? (raw.activated_at as string | null) ?? null,
    retiredAt: (raw.retiredAt as string | null) ?? (raw.retired_at as string | null) ?? null,
  };
}

export function adaptAnomalyAlert(raw: BackendRecord): AnomalyAlert {
  return {
    id: String(raw.id),
    alertType: String(raw.alertType ?? raw.alert_type ?? '') as AnomalyAlert['alertType'],
    entityType: String(raw.entityType ?? raw.entity_type ?? ''),
    entityId: String(raw.entityId ?? raw.entity_id ?? ''),
    severity: String(raw.severity ?? ''),
    details: (raw.details as Record<string, unknown>) ?? {},
    status: String(raw.status ?? '') as AnomalyAlert['status'],
    reviewedBy: (raw.reviewedBy as string | null) ?? (raw.reviewed_by_id as string | null) ?? null,
    reviewedAt: (raw.reviewedAt as string | null) ?? (raw.reviewed_at as string | null) ?? null,
    dismissalReason:
      (raw.dismissalReason as string | null) ?? (raw.dismissal_reason as string | null) ?? null,
    createdAt: (snake(raw, 'created_at') as string) ?? new Date().toISOString(),
    updatedAt: (snake(raw, 'updated_at') as string) ?? new Date().toISOString(),
  };
}
