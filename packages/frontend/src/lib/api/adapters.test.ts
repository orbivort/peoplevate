import { describe, it, expect } from 'vitest';

import {
  adaptAnomalyAlert,
  adaptAuditLog,
  adaptBreach,
  adaptConsent,
  adaptDepartment,
  adaptDocument,
  adaptDsar,
  adaptEmployee,
  adaptExpiryAlert,
  adaptKeyVersion,
  adaptPosition,
  adaptRetentionPolicy,
  adaptUser,
  mapEmploymentStatus,
  mapEmploymentType,
} from './adapters';

describe('mapEmploymentType', () => {
  it('maps known values', () => {
    expect(mapEmploymentType('FULL_TIME')).toBe('Full-time');
    expect(mapEmploymentType('PART_TIME')).toBe('Part-time');
    expect(mapEmploymentType('CONTRACT')).toBe('Contract');
  });

  it('defaults for unknown/null/empty', () => {
    expect(mapEmploymentType('unknown')).toBe('Full-time');
    expect(mapEmploymentType(null)).toBe('Full-time');
    expect(mapEmploymentType(undefined)).toBe('Full-time');
    expect(mapEmploymentType('')).toBe('Full-time');
  });
});

describe('mapEmploymentStatus', () => {
  it('maps known values case-insensitively', () => {
    expect(mapEmploymentStatus('NEW_HIRE')).toBe('New Hire');
    expect(mapEmploymentStatus('probation')).toBe('Probation');
    expect(mapEmploymentStatus('ACTIVE')).toBe('Active');
    expect(mapEmploymentStatus('on_leave')).toBe('On Leave');
    expect(mapEmploymentStatus('TERMINATED')).toBe('Terminated');
  });

  it('defaults to Active', () => {
    expect(mapEmploymentStatus('nope')).toBe('Active');
    expect(mapEmploymentStatus(null)).toBe('Active');
    expect(mapEmploymentStatus(undefined)).toBe('Active');
  });
});

describe('adaptDepartment', () => {
  it('adapts a flat record', () => {
    const d = adaptDepartment({
      id: 1,
      name: 'Engineering',
      description: 'Builds things',
      parent_id: null,
      positionCount: 5,
      employeeCount: 20,
    });
    expect(d).toMatchObject({
      id: '1',
      name: 'Engineering',
      description: 'Builds things',
      parentId: null,
      positionCount: 5,
      employeeCount: 20,
    } as never);
    expect(typeof d.createdAt).toBe('string');
  });

  it('falls back to nested parent id', () => {
    const d = adaptDepartment({ id: 2, name: 'Sub', parent: { id: 9 } });
    expect(d.parentId).toBe(9);
  });

  it('coerces missing counts to 0', () => {
    const d = adaptDepartment({ id: 3, name: 'X' });
    expect(d.positionCount).toBe(0);
    expect(d.employeeCount).toBe(0);
    expect(d.description).toBeUndefined();
  });
});

describe('adaptPosition', () => {
  it('adapts with nested department', () => {
    const p = adaptPosition({
      id: 4,
      name: 'Senior',
      grade: 'G7',
      description: 'desc',
      department: { id: 1, name: 'Eng' },
      employeeCount: 3,
    });
    expect(p).toMatchObject({
      id: '4',
      name: 'Senior',
      grade: 'G7',
      departmentId: '1',
      departmentName: 'Eng',
      employeeCount: 3,
    });
  });

  it('falls back to department_id and defaults', () => {
    const p = adaptPosition({ id: 5, name: 'Jr', department_id: 2 });
    expect(p.departmentId).toBe('2');
    expect(p.departmentName).toBe('');
    expect(p.employeeCount).toBe(0);
  });
});

describe('adaptEmployee', () => {
  it('adapts a fully populated record', () => {
    const e = adaptEmployee({
      id: 10,
      employeeNo: 'E1',
      firstName: 'Jane',
      lastName: 'Doe',
      dateOfBirth: '1990-01-01',
      gender: 'FEMALE',
      nationalId: 'N1',
      email: 'j@example.com',
      phone: '123',
      address: 'addr',
      emergencyContactName: 'Bob',
      emergencyContactRelationship: 'bro',
      emergencyContactPhone: '999',
      department: { id: 1, name: 'Eng' },
      position: { id: 2, name: 'Dev' },
      manager: { id: 3, first_name: 'Mike', last_name: 'Roe' },
      hireDate: '2020-01-01',
      employmentType: 'FULL_TIME',
      salary: 5000,
      status: 'ACTIVE',
      deactivationDate: null,
      avatarUrl: 'http://a',
      createdAt: '2020-01-02',
      updatedAt: '2020-01-03',
    });
    expect(e.firstName).toBe('Jane');
    expect(e.gender).toBe('Female');
    expect(e.employmentType).toBe('Full-time');
    expect(e.status).toBe('Active');
    expect(e.salary).toBe(5000);
    expect(e.managerId).toBe('3');
    expect(e.managerName).toBe('Mike Roe');
    expect(e.avatarUrl).toBe('http://a');
  });

  it('handles snake_case fallbacks and restricted salary', () => {
    const e = adaptEmployee({
      employee_no: 'E2',
      first_name: 'A',
      last_name: 'B',
      salary: 'Restricted',
      employment_type: 'CONTRACT',
      status: 'NEW_HIRE',
    });
    expect(e.employeeNo).toBe('E2');
    expect(e.salary).toBe(0);
    expect(e.employmentType).toBe('Contract');
    expect(e.status).toBe('New Hire');
  });

  it('handles numeric salary string and missing manager', () => {
    const e = adaptEmployee({ id: 1, salary: '4000' });
    expect(e.salary).toBe(4000);
    expect(e.managerId).toBeNull();
    expect(e.managerName).toBeNull();
  });

  it('handles missing employee object', () => {
    const e = adaptEmployee({ id: 1 });
    expect(e.departmentId).toBe('');
    expect(e.departmentName).toBe('');
    expect(e.positionId).toBe('');
    expect(e.positionName).toBe('');
  });
});

describe('adaptUser', () => {
  it('maps all roles and statuses', () => {
    expect(adaptUser({ id: 1, email: 'a', role: 'ADMIN', status: 'ACTIVE' }).role).toBe('Admin');
    expect(adaptUser({ id: 1, email: 'a', role: 'HR_MANAGER' }).role).toBe('HR Manager');
    expect(adaptUser({ id: 1, email: 'a', role: 'MANAGER' }).role).toBe('Manager');
    expect(adaptUser({ id: 1, email: 'a', role: 'OTHER' }).role).toBe('Employee');
    expect(adaptUser({ id: 1, email: 'a', status: 'DEACTIVATED' }).status).toBe('deactivated');
    expect(adaptUser({ id: 1, email: 'a', status: 'PENDING_SETUP' }).status).toBe('pending_setup');
    expect(adaptUser({ id: 1, email: 'a', status: 'unknown' }).status).toBe('active');
  });

  it('attaches employee id when present', () => {
    const u = adaptUser({ id: 1, email: 'a', employee: { id: 5 } });
    expect(u.employeeId).toBe('5');
  });

  it('omits employee id when absent', () => {
    const u = adaptUser({ id: 1, email: 'a' });
    expect(u.employeeId).toBeUndefined();
  });
});

describe('adaptDocument', () => {
  it('adapts with fallbacks', () => {
    const d = adaptDocument({
      id: 1,
      employeeId: 9,
      type: 'Passport',
      originalFilename: 'p.pdf',
      fileSize: 100,
      mimeType: 'application/pdf',
      uploadedBy: 2,
      uploadedAt: '2020-01-01',
      expiryDate: '2030-01-01',
    });
    expect(d.employeeId).toBe(9);
    expect(d.fileSize).toBe(100);
    expect(d.type).toBe('Passport');
    expect(d.expiryDate).toBe('2030-01-01');
  });

  it('uses snake_case and creation fallbacks', () => {
    const d = adaptDocument({
      employee_id: 8,
      original_filename: 'x.pdf',
      file_size: 50,
      mime_type: 'img/png',
      uploaded_by: 3,
      created_at: '2020-02-02',
    });
    expect(d.employeeId).toBe(8);
    expect(d.originalFilename).toBe('x.pdf');
    expect(d.fileSize).toBe(50);
    expect(d.uploadedAt).toBe('2020-02-02');
  });

  it('defaults type to Other when missing', () => {
    const d = adaptDocument({ id: 1 });
    expect(d.type).toBe('Other');
    expect(d.expiryDate).toBeNull();
  });
});

describe('adaptAuditLog', () => {
  it('maps a backend view with a redacted change diff and humanized entity', () => {
    const a = adaptAuditLog({
      id: '1',
      actor_id: 'u1',
      actor_name: 'Admin',
      action: 'UPDATE',
      entity: 'EMPLOYEES',
      entity_label: 'Employees',
      entity_id: 'e1',
      changes: [
        { field: 'status', label: 'status', old: 'ACTIVE', new: 'PROBATION', sensitive: false },
        { field: 'email', label: 'email', old: '[redacted]', new: '[redacted]', sensitive: true },
      ],
      timestamp: '2020-01-01',
    });
    expect(a.actorName).toBe('Admin');
    expect(a.entity).toBe('EMPLOYEES');
    expect(a.entityLabel).toBe('Employees');
    expect(a.action).toBe('UPDATE');
    expect(a.changes).toEqual([
      { field: 'status', label: 'status', old: 'ACTIVE', new: 'PROBATION', sensitive: false },
      { field: 'email', label: 'email', old: '[redacted]', new: '[redacted]', sensitive: true },
    ]);
  });

  it('handles missing changes/entity label and applies defaults', () => {
    const a = adaptAuditLog({ id: 1, entity: 'DEPARTMENTS' });
    expect(a.changes).toEqual([]);
    expect(a.entityLabel).toBe('Departments');
    expect(a.action).toBe('UPDATE');
    expect(a.entityId).toBe('');
  });
});

describe('adaptExpiryAlert', () => {
  it('maps severity and fields', () => {
    const a = adaptExpiryAlert({
      id: 1,
      document_id: 'd1',
      employee_id: 'e1',
      employee_name: 'Jane',
      document_type: 'Visa',
      expiry_date: '2030-01-01',
      days_until_expiry: 5,
      severity: 'EXPIRED',
      acknowledged: true,
    });
    expect(a.severity).toBe('expired');
    expect(a.acknowledged).toBe(true);
    expect(a.daysUntilExpiry).toBe(5);
  });

  it('handles lower-case severity and defaults', () => {
    const a = adaptExpiryAlert({ id: 1, severity: 'soon' });
    expect(a.severity).toBe('soon');
  });

  it('defaults severity to soon and acknowledged to false', () => {
    const a = adaptExpiryAlert({ id: 1 });
    expect(a.severity).toBe('soon');
    expect(a.acknowledged).toBe(false);
  });

  it('coerces lower-cased EXPIRED severity and keeps unknown as soon', () => {
    expect(adaptExpiryAlert({ id: 1, severity: 'expired' }).severity).toBe('expired');
    expect(adaptExpiryAlert({ id: 1, severity: 'warning' }).severity).toBe('soon');
  });

  it('defaults documentType to Other and falls back to new Date for expiry', () => {
    const a = adaptExpiryAlert({ id: 1 });
    expect(a.documentType).toBe('Other');
    expect(typeof a.expiryDate).toBe('string');
    expect(a.daysUntilExpiry).toBe(0);
  });
});

describe('adaptEmployee edge branches', () => {
  it('uses snake_case gender and maps unknown gender to Other', () => {
    expect(adaptEmployee({ id: 1, gender: 'MALE' }).gender).toBe('Male');
    expect(adaptEmployee({ id: 1, gender: 'OTHER' }).gender).toBe('Other');
    expect(adaptEmployee({ id: 1, gender: 'UNKNOWN' }).gender).toBe('Other');
    expect(adaptEmployee({ id: 1, gender: null }).gender).toBe('Other');
  });

  it('maps numeric salary directly', () => {
    expect(adaptEmployee({ id: 1, salary: 7500 }).salary).toBe(7500);
  });

  it('maps snake_case manager fields and skips manager when no id', () => {
    const e = adaptEmployee({
      id: 1,
      manager: { first_name: 'A', last_name: 'B' },
    });
    expect(e.managerId).toBeNull();
    expect(e.managerName).toBeNull();
  });

  it('handles null nested department/position', () => {
    const e = adaptEmployee({ id: 1, department: null, position: null });
    expect(e.departmentId).toBe('');
    expect(e.positionId).toBe('');
  });

  it('falls back to snake_case for employment/date/avatar fields', () => {
    const e = adaptEmployee({
      id: 1,
      employment_type: 'PART_TIME',
      date_of_birth: '1995-05-05',
      hire_date: '2021-06-06',
      deactivation_date: '2022-07-07',
      avatar_url: 'http://img',
      created_at: '2021-01-01',
      updated_at: '2021-01-02',
    });
    expect(e.employmentType).toBe('Part-time');
    expect(e.dateOfBirth).toBe('1995-05-05');
    expect(e.hireDate).toBe('2021-06-06');
    expect(e.deactivationDate).toBe('2022-07-07');
    expect(e.avatarUrl).toBe('http://img');
    expect(e.createdAt).toBe('2021-01-01');
    expect(e.updatedAt).toBe('2021-01-02');
  });

  it('uses default dates when none provided', () => {
    const e = adaptEmployee({ id: 1 });
    expect(typeof e.createdAt).toBe('string');
    expect(typeof e.updatedAt).toBe('string');
  });
});

describe('adaptDepartment edge branches', () => {
  it('prefers parent_id over nested parent', () => {
    const d = adaptDepartment({ id: 1, name: 'Sub', parent_id: 4, parent: { id: 9 } });
    expect(d.parentId).toBe(4);
  });

  it('reads created_at snake fallback', () => {
    const d = adaptDepartment({ id: 1, name: 'X', created_at: '2021-01-01' });
    expect(d.createdAt).toBe('2021-01-01');
  });

  it('coerces string counts', () => {
    const d = adaptDepartment({
      id: 1,
      name: 'X',
      position_count: '3',
      employee_count: '7',
    });
    expect(d.positionCount).toBe(3);
    expect(d.employeeCount).toBe(7);
  });
});

describe('adaptPosition edge branches', () => {
  it('reads snake_case counts and created_at', () => {
    const p = adaptPosition({
      id: 1,
      name: 'P',
      position_count: 2,
      employee_count: 4,
      created_at: '2021-01-01',
    });
    expect(p.employeeCount).toBe(4);
    expect(p.createdAt).toBe('2021-01-01');
  });

  it('handles null department', () => {
    const p = adaptPosition({ id: 1, name: 'P', department: null });
    expect(p.departmentId).toBe('');
    expect(p.departmentName).toBe('');
  });
});

describe('adaptDocument edge branches', () => {
  it('falls back to created_at when uploadedAt missing', () => {
    const d = adaptDocument({ id: 1, createdAt: '2021-03-03' });
    expect(d.uploadedAt).toBe('2021-03-03');
  });

  it('falls back to created_at snake key', () => {
    const d = adaptDocument({ id: 1, created_at: '2021-04-04' });
    expect(d.uploadedAt).toBe('2021-04-04');
  });

  it('uses new Date when no upload/created dates', () => {
    const d = adaptDocument({ id: 1 });
    expect(typeof d.uploadedAt).toBe('string');
  });
});

describe('adaptAuditLog edge branches', () => {
  it('maps snake_case actor/action fields and empty entity label', () => {
    const a = adaptAuditLog({
      id: 1,
      actorId: 'u2',
      actorName: 'Bob',
      action: 'CREATE',
      entity: '',
      entityId: 'e2',
    });
    expect(a.actorId).toBe('u2');
    expect(a.action).toBe('CREATE');
    expect(a.entityLabel).toBe('');
  });

  it('maps a change with missing label/old/new and non-sensitive flag', () => {
    const a = adaptAuditLog({
      id: 1,
      changes: [{ field: 'x' }],
    });
    expect(a.changes[0]).toEqual({
      field: 'x',
      label: 'x',
      old: null,
      new: null,
      sensitive: false,
    });
  });

  it('uses default UPDATE action and Success status when absent', () => {
    const a = adaptAuditLog({ id: 1 });
    expect(a.action).toBe('UPDATE');
    expect(a.status).toBe('Success');
  });

  it('uses new Date timestamp when missing', () => {
    const a = adaptAuditLog({ id: 1 });
    expect(typeof a.timestamp).toBe('string');
  });
});

describe('adaptRetentionPolicy', () => {
  it('adapts camelCase fields', () => {
    const p = adaptRetentionPolicy({
      id: 1,
      dataCategory: 'CANDIDATE_RESUMES',
      retentionYears: 5,
      action: 'ANONYMIZE',
      description: 'desc',
      isDefault: true,
      created_at: '2021-01-01',
      updated_at: '2021-01-02',
    });
    expect(p.dataCategory).toBe('CANDIDATE_RESUMES');
    expect(p.retentionYears).toBe(5);
    expect(p.action).toBe('ANONYMIZE');
    expect(p.description).toBe('desc');
    expect(p.isDefault).toBe(true);
    expect(p.createdAt).toBe('2021-01-01');
    expect(p.updatedAt).toBe('2021-01-02');
  });
  // Note: createdAt is only read from the snake_case key on the backend record.

  it('falls back to snake_case and defaults', () => {
    const p = adaptRetentionPolicy({
      id: 1,
      data_category: 'CONTRACTS',
      retention_years: 10,
      action: 'HARD_DELETE',
      is_default: false,
    });
    expect(p.dataCategory).toBe('CONTRACTS');
    expect(p.retentionYears).toBe(10);
    expect(p.isDefault).toBe(false);
    expect(p.description).toBeNull();
    expect(typeof p.createdAt).toBe('string');
    expect(typeof p.updatedAt).toBe('string');
  });
});

describe('adaptDsar', () => {
  it('adapts a fully populated request (camelCase)', () => {
    const d = adaptDsar({
      id: 1,
      requestType: 'ERASURE',
      status: 'VERIFIED',
      dataSubjectUserId: 'u1',
      dataSubjectEmail: 'a@example.com',
      description: 'please',
      identityVerifiedBy: 'admin',
      identityVerifiedAt: '2021-01-01',
      verifiedAt: '2021-01-02',
      completedAt: '2021-01-03',
      slaDeadline: '2021-02-01',
      assignedTo: 'hr',
      rejectionReason: 'nope',
      createdAt: '2021-01-00',
      updatedAt: '2021-01-09',
    });
    expect(d.requestType).toBe('ERASURE');
    expect(d.status).toBe('VERIFIED');
    expect(d.dataSubjectUserId).toBe('u1');
    expect(d.dataSubjectEmail).toBe('a@example.com');
    expect(d.description).toBe('please');
    expect(d.identityVerifiedBy).toBe('admin');
    expect(d.identityVerifiedAt).toBe('2021-01-01');
    expect(d.verifiedAt).toBe('2021-01-02');
    expect(d.completedAt).toBe('2021-01-03');
    expect(d.slaDeadline).toBe('2021-02-01');
    expect(d.assignedTo).toBe('hr');
    expect(d.rejectionReason).toBe('nope');
  });

  it('falls back to snake_case ids and defaults to null', () => {
    const d = adaptDsar({
      id: 1,
      request_type: 'ACCESS',
      status: 'PENDING_VERIFICATION',
      data_subject_email: 'b@example.com',
      data_subject_user_id: 'u2',
      identity_verified_by_id: 'admin2',
      identity_verified_at: '2021-01-05',
      verified_at: '2021-01-06',
      completed_at: '2021-01-07',
      sla_deadline: '2021-03-01',
      assigned_to_id: 'hr2',
      rejection_reason: 'bad',
    });
    expect(d.dataSubjectUserId).toBe('u2');
    expect(d.dataSubjectEmail).toBe('b@example.com');
    expect(d.identityVerifiedBy).toBe('admin2');
    expect(d.identityVerifiedAt).toBe('2021-01-05');
    expect(typeof d.createdAt).toBe('string');
    expect(typeof d.updatedAt).toBe('string');
  });

  it('returns null for all optional fields when absent', () => {
    const d = adaptDsar({ id: 1, requestType: 'PORTABILITY', status: 'IN_PROGRESS' });
    expect(d.dataSubjectUserId).toBeNull();
    expect(d.description).toBeNull();
    expect(d.identityVerifiedBy).toBeNull();
    expect(d.identityVerifiedAt).toBeNull();
    expect(d.verifiedAt).toBeNull();
    expect(d.completedAt).toBeNull();
    expect(d.slaDeadline).toBeNull();
    expect(d.assignedTo).toBeNull();
    expect(d.rejectionReason).toBeNull();
  });
});

describe('adaptBreach', () => {
  it('adapts a fully populated breach (camelCase)', () => {
    const b = adaptBreach({
      id: 1,
      title: 'Leak',
      description: 'data leak',
      detectionAt: '2021-01-01',
      severity: 'HIGH',
      isHighRisk: true,
      dataCategoriesAffected: ['AUDIT_LOGS'],
      affectedSubjectsCount: 10,
      containmentStatus: 'CONTAINED',
      rootCause: 'misconfig',
      resolution: 'fixed',
      saNotificationDeadline: '2021-01-10',
      saNotifiedAt: '2021-01-09',
      saNotificationMethod: 'EMAIL',
      saNotificationReference: 'REF1',
      subjectNotificationPlan: 'plan',
      subjectNotifiedAt: '2021-01-11',
      createdBy: 'admin',
      createdAt: '2021-01-00',
      updatedAt: '2021-01-08',
    });
    expect(b.title).toBe('Leak');
    expect(b.severity).toBe('HIGH');
    expect(b.isHighRisk).toBe(true);
    expect(b.dataCategoriesAffected).toEqual(['AUDIT_LOGS']);
    expect(b.affectedSubjectsCount).toBe(10);
    expect(b.containmentStatus).toBe('CONTAINED');
    expect(b.rootCause).toBe('misconfig');
    expect(b.resolution).toBe('fixed');
    expect(b.saNotificationMethod).toBe('EMAIL');
    expect(b.saNotificationReference).toBe('REF1');
    expect(b.subjectNotificationPlan).toBe('plan');
    expect(b.subjectNotifiedAt).toBe('2021-01-11');
    expect(b.createdBy).toBe('admin');
  });

  it('falls back to snake_case arrays/ids and empty lists', () => {
    const b = adaptBreach({
      id: 1,
      title: 'T',
      description: 'D',
      detection_at: '2021-02-01',
      severity: 'LOW',
      is_high_risk: false,
      data_categories_affected: ['CONTRACTS', 'LEAVE_RECORDS'],
      affected_subjects_count: 2,
      containment_status: 'OPEN',
      root_cause: 'x',
      sa_notification_deadline: '2021-02-10',
      sa_notified_at: '2021-02-09',
      sa_notification_method: 'POST',
      sa_notification_reference: 'R2',
      subject_notification_plan: 'p2',
      subject_notified_at: '2021-02-11',
      created_by_id: 'admin2',
    });
    expect(b.detectionAt).toBe('2021-02-01');
    expect(b.isHighRisk).toBe(false);
    expect(b.dataCategoriesAffected).toEqual(['CONTRACTS', 'LEAVE_RECORDS']);
    expect(b.affectedSubjectsCount).toBe(2);
    expect(b.containmentStatus).toBe('OPEN');
    expect(b.saNotificationMethod).toBe('POST');
    expect(b.createdBy).toBe('admin2');
  });

  it('treats non-array categories as empty and nulls when absent', () => {
    const b = adaptBreach({
      id: 1,
      title: 'T',
      description: 'D',
      detectionAt: '2021-03-01',
      severity: 'MEDIUM',
      containmentStatus: 'CLOSED',
    });
    expect(b.dataCategoriesAffected).toEqual([]);
    expect(b.rootCause).toBeNull();
    expect(b.resolution).toBeNull();
    expect(b.saNotifiedAt).toBeNull();
    expect(b.saNotificationMethod).toBeNull();
    expect(b.saNotificationReference).toBeNull();
    expect(b.subjectNotificationPlan).toBeNull();
    expect(b.subjectNotifiedAt).toBeNull();
    expect(b.createdBy).toBeNull();
    expect(typeof b.saNotificationDeadline).toBe('string');
  });
});

describe('adaptConsent', () => {
  it('adapts a fully populated consent (camelCase)', () => {
    const c = adaptConsent({
      id: 1,
      dataSubjectUserId: 'u1',
      dataSubjectEmail: 'a@example.com',
      processingPurpose: 'marketing',
      consentText: 'I agree',
      noticeVersion: 'v2',
      mechanism: 'CHECKBOX',
      ipAddressTruncated: '192.168.x.x',
      status: 'GIVEN',
      withdrawsConsentId: 'c2',
      lawfulBasisOverride: 'LEGIT',
      recordedAt: '2021-01-01',
      createdAt: '2021-01-00',
      updatedAt: '2021-01-02',
    });
    expect(c.dataSubjectUserId).toBe('u1');
    expect(c.dataSubjectEmail).toBe('a@example.com');
    expect(c.processingPurpose).toBe('marketing');
    expect(c.consentText).toBe('I agree');
    expect(c.noticeVersion).toBe('v2');
    expect(c.mechanism).toBe('CHECKBOX');
    expect(c.ipAddressTruncated).toBe('192.168.x.x');
    expect(c.status).toBe('GIVEN');
    expect(c.withdrawsConsentId).toBe('c2');
    expect(c.lawfulBasisOverride).toBe('LEGIT');
    expect(c.recordedAt).toBe('2021-01-01');
  });

  it('falls back to snake_case ids and defaults', () => {
    const c = adaptConsent({
      id: 1,
      data_subject_user_id: 'u2',
      data_subject_email: 'b@example.com',
      processing_purpose: 'hr',
      consent_text: 'ok',
      notice_version: 'v1',
      mechanism: 'SIGNATURE',
      ip_address_truncated: '10.0.x.x',
      status: 'WITHDRAWN',
      withdraws_consent_id: 'c3',
      lawful_basis_override: 'CONSENT',
      recorded_at: '2021-02-01',
    });
    expect(c.dataSubjectUserId).toBe('u2');
    expect(c.dataSubjectEmail).toBe('b@example.com');
    expect(c.processingPurpose).toBe('hr');
    expect(c.mechanism).toBe('SIGNATURE');
    expect(c.ipAddressTruncated).toBe('10.0.x.x');
    expect(c.withdrawsConsentId).toBe('c3');
    expect(c.lawfulBasisOverride).toBe('CONSENT');
    expect(c.recordedAt).toBe('2021-02-01');
  });

  it('returns null for all optional fields when absent', () => {
    const c = adaptConsent({
      id: 1,
      dataSubjectEmail: 'c@example.com',
      processingPurpose: 'p',
      consentText: 't',
      noticeVersion: 'v',
      mechanism: 'EXPLICIT',
      status: 'GIVEN',
    });
    expect(c.dataSubjectUserId).toBeNull();
    expect(c.ipAddressTruncated).toBeNull();
    expect(c.withdrawsConsentId).toBeNull();
    expect(c.lawfulBasisOverride).toBeNull();
    expect(typeof c.recordedAt).toBe('string');
  });
});

describe('adaptKeyVersion', () => {
  it('adapts a fully populated key version (camelCase)', () => {
    const k = adaptKeyVersion({
      id: 1,
      keyId: 'k1',
      purpose: 'DATA_ENCRYPTION',
      algorithm: 'AES-256-GCM',
      status: 'ACTIVE',
      createdAt: '2021-01-01',
      activatedAt: '2021-01-02',
      retiredAt: '2021-01-03',
    });
    expect(k.keyId).toBe('k1');
    expect(k.purpose).toBe('DATA_ENCRYPTION');
    expect(k.algorithm).toBe('AES-256-GCM');
    expect(k.status).toBe('ACTIVE');
    expect(k.activatedAt).toBe('2021-01-02');
    expect(k.retiredAt).toBe('2021-01-03');
  });

  it('falls back to snake_case and defaults algorithm', () => {
    const k = adaptKeyVersion({
      id: 1,
      key_id: 'k2',
      purpose: 'TOKEN_SIGNING',
      status: 'RETIRED',
      activated_at: '2021-02-02',
      retired_at: '2021-02-03',
    });
    expect(k.keyId).toBe('k2');
    expect(k.purpose).toBe('TOKEN_SIGNING');
    expect(k.algorithm).toBe('AES-256-GCM');
    expect(k.status).toBe('RETIRED');
    expect(k.activatedAt).toBe('2021-02-02');
    expect(k.retiredAt).toBe('2021-02-03');
  });

  it('returns null activation/retirement when absent', () => {
    const k = adaptKeyVersion({ id: 1, purpose: 'DATA_ENCRYPTION', status: 'ACTIVE' });
    expect(k.activatedAt).toBeNull();
    expect(k.retiredAt).toBeNull();
    expect(typeof k.createdAt).toBe('string');
  });
});

describe('adaptAnomalyAlert', () => {
  it('adapts a fully populated alert (camelCase)', () => {
    const a = adaptAnomalyAlert({
      id: 1,
      alertType: 'FAILED_LOGIN_SPIKE',
      entityType: 'User',
      entityId: 'e1',
      severity: 'HIGH',
      details: { count: 5 },
      status: 'OPEN',
      reviewedBy: 'admin',
      reviewedAt: '2021-01-01',
      dismissalReason: 'false positive',
      createdAt: '2021-01-00',
      updatedAt: '2021-01-02',
    });
    expect(a.alertType).toBe('FAILED_LOGIN_SPIKE');
    expect(a.entityType).toBe('User');
    expect(a.entityId).toBe('e1');
    expect(a.severity).toBe('HIGH');
    expect(a.details).toEqual({ count: 5 });
    expect(a.status).toBe('OPEN');
    expect(a.reviewedBy).toBe('admin');
    expect(a.reviewedAt).toBe('2021-01-01');
    expect(a.dismissalReason).toBe('false positive');
  });

  it('falls back to snake_case ids and defaults', () => {
    const a = adaptAnomalyAlert({
      id: 1,
      alert_type: 'BULK_DOWNLOAD_SPIKE',
      entity_type: 'Document',
      entity_id: 'e2',
      severity: 'MEDIUM',
      details: { n: 1 },
      status: 'REVIEWED',
      reviewed_by_id: 'admin2',
      reviewed_at: '2021-02-01',
      dismissal_reason: 'ok',
    });
    expect(a.alertType).toBe('BULK_DOWNLOAD_SPIKE');
    expect(a.entityType).toBe('Document');
    expect(a.entityId).toBe('e2');
    expect(a.reviewedBy).toBe('admin2');
    expect(a.reviewedAt).toBe('2021-02-01');
    expect(a.dismissalReason).toBe('ok');
  });

  it('returns null optional fields and empty details when absent', () => {
    const a = adaptAnomalyAlert({
      id: 1,
      alertType: 'FAILED_LOGIN_SPIKE',
      entityType: 'User',
      entityId: 'e1',
      severity: 'LOW',
      status: 'DISMISSED',
    });
    expect(a.details).toEqual({});
    expect(a.reviewedBy).toBeNull();
    expect(a.reviewedAt).toBeNull();
    expect(a.dismissalReason).toBeNull();
    expect(typeof a.createdAt).toBe('string');
    expect(typeof a.updatedAt).toBe('string');
  });
});
