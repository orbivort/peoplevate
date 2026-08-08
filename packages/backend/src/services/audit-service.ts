import { prisma } from '../config/prisma.js';
import { AuditAction, AuditEntity } from '#prisma';

/**
 * Human-readable labels for audit entity enum values. Unknown entities fall
 * back to a sentence-case transformation of the raw value.
 */
const ENTITY_LABELS: Record<string, string> = {
  [AuditEntity.EMPLOYEES]: 'Employees',
  [AuditEntity.DEPARTMENTS]: 'Departments',
  [AuditEntity.POSITIONS]: 'Positions',
  [AuditEntity.USERS]: 'Users',
  [AuditEntity.AUTH]: 'Authentication',
  [AuditEntity.DOCUMENTS]: 'Documents',
  [AuditEntity.JOB_REQUISITIONS]: 'Job requisitions',
  [AuditEntity.JOB_POSTINGS]: 'Job postings',
  [AuditEntity.CANDIDATES]: 'Candidates',
  [AuditEntity.INTERVIEWS]: 'Interviews',
  [AuditEntity.OFFER_LETTERS]: 'Offer letters',
  [AuditEntity.ONBOARDING_TASKS]: 'Onboarding tasks',
  [AuditEntity.ATTENDANCE_RECORDS]: 'Attendance records',
  [AuditEntity.LEAVE_TYPES]: 'Leave types',
  [AuditEntity.LEAVE_ENTITLEMENTS]: 'Leave entitlements',
  [AuditEntity.LEAVE_REQUESTS]: 'Leave requests',
  [AuditEntity.LEAVE_APPROVALS]: 'Leave approvals',
  [AuditEntity.LEAVE_BALANCES]: 'Leave balances',
  [AuditEntity.EVALUATION_CYCLES]: 'Evaluation cycles',
  [AuditEntity.PERFORMANCE_REVIEWS]: 'Performance reviews',
  [AuditEntity.OFFBOARDING_RECORDS]: 'Offboarding records',
  [AuditEntity.CLEARANCE_ITEMS]: 'Clearance items',
  [AuditEntity.EXIT_INTERVIEWS]: 'Exit interviews',
  [AuditEntity.SETTLEMENTS]: 'Settlements',
  [AuditEntity.DATA_SUBJECT_RIGHTS]: 'Data subject rights',
  [AuditEntity.BREACH]: 'Data breach',
  [AuditEntity.CONSENT]: 'Consent',
  [AuditEntity.RETENTION]: 'Retention',
  [AuditEntity.KEYS]: 'Encryption keys',
  [AuditEntity.ANOMALIES]: 'Anomalies',
};

/**
 * Field-name hints for data that must never be surfaced in a user-facing
 * audit log (GDPR data minimization + PII protection). Any changed field whose
 * key matches one of these is shown as a redacted value instead of its content.
 */
const SENSITIVE_FIELD_HINTS = [
  'email',
  'phone',
  'address',
  'gender',
  'date_of_birth',
  'birth',
  'salary',
  'national_id',
  'social_security',
  'ssn',
  'emergency_contact',
  'user_id',
  'password',
  'token',
  'secret',
  'iban',
  'account_number',
  'bank',
];

/** A single field-level change extracted from a raw audit row. */
export interface AuditChange {
  field: string;
  label: string;
  old: string | null;
  new: string | null;
  sensitive: boolean;
}

/** A display-safe, PII-redacted view of an audit log row. */
export interface AuditLogView {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entity: string;
  entityLabel: string;
  entityId: string | null;
  changes: AuditChange[];
  /** Result of the operation. Audit rows are immutable and only ever record
   * successfully committed operations, so this is always "Success". */
  status: string;
  timestamp: Date | string;
}

function isSensitiveField(field: string): boolean {
  const key = field.toLowerCase();
  return SENSITIVE_FIELD_HINTS.some((hint) => key.includes(hint));
}

/** Sentence-case a raw enum value, e.g. "JOB_REQUISITIONS" -> "Job requisitions". */
export function humanizeEntity(entity: string): string {
  if (!entity) return entity;
  const known = ENTITY_LABELS[entity.toUpperCase()];
  if (known) return known;
  return entity
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Prettify a scalar JSON value into a short display string. */
function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

const REDACTED = '[redacted]';

/**
 * Build a redacted, human-readable list of field changes from the raw JSONB
 * old/new values captured by the DB trigger. This is what gets sent to the UI —
 * raw rows are never exposed so PII stays out of the response payload.
 */
export function summarizeAuditRow(row: {
  id: string;
  actor_id?: string | null;
  actor_name?: string | null;
  action?: string | null;
  entity?: string | null;
  entity_id?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  timestamp?: Date | string;
}): AuditLogView {
  const action = String(row.action ?? '').toUpperCase();
  const oldObj = (row.old_value ?? null) as Record<string, unknown> | null;
  const newObj = (row.new_value ?? null) as Record<string, unknown> | null;

  const changes: AuditChange[] = [];

  const collect = (field: string, from: unknown, to: unknown) => {
    const sensitive = isSensitiveField(field);
    const oldVal = formatValue(from);
    const newVal = formatValue(to);
    const fieldKey = field.toLowerCase();
    // Skip internal audit/tracking columns that add no user value.
    if (['created_at', 'updated_at', 'deleted_at', 'id'].includes(fieldKey)) {
      return;
    }
    // Skip raw foreign-key reference columns: they hold internal UUIDs that
    // are meaningless to an HR user. Resolving them to friendly labels is a
    // separate concern; showing the raw UUID is not "correct" data.
    if (fieldKey !== 'id' && fieldKey.endsWith('_id')) {
      return;
    }
    // Skip fields where neither side has a value (no meaningful change).
    if (oldVal === null && newVal === null) {
      return;
    }
    if (sensitive) {
      changes.push({
        field,
        label: field,
        old: oldVal ? REDACTED : null,
        new: newVal ? REDACTED : null,
        sensitive: true,
      });
      return;
    }
    changes.push({
      field,
      label: field,
      old: oldVal,
      new: newVal,
      sensitive: false,
    });
  };

  if (action === 'CREATE') {
    // Everything present on the new row is "added".
    if (newObj) {
      for (const [field, value] of Object.entries(newObj)) {
        collect(field, undefined, value);
      }
    }
  } else if (action === 'DELETE') {
    if (oldObj) {
      for (const [field, value] of Object.entries(oldObj)) {
        collect(field, value, undefined);
      }
    }
  } else if (action === 'UPDATE') {
    const fields = new Set([...Object.keys(oldObj ?? {}), ...Object.keys(newObj ?? {})]);
    for (const field of fields) {
      const from = oldObj?.[field];
      const to = newObj?.[field];
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        collect(field, from, to);
      }
    }
  }
  // LOGIN / LOGOUT / READ-style actions produce no field changes.

  return {
    id: String(row.id ?? ''),
    actorId: row.actor_id ?? null,
    actorName: row.actor_name ?? null,
    action,
    entity: String(row.entity ?? ''),
    entityLabel: humanizeEntity(String(row.entity ?? '')),
    entityId: row.entity_id ?? null,
    changes,
    status: 'Success',
    timestamp: row.timestamp ?? new Date(),
  };
}

/** Map a raw AuditAction enum to a friendly past-tense verb for display. */
export function humanizeAction(action: string): string {
  switch ((action ?? '').toUpperCase()) {
    case 'CREATE':
      return 'created';
    case 'UPDATE':
      return 'updated';
    case 'DELETE':
      return 'deleted';
    case 'LOGIN':
      return 'logged in';
    case 'LOGOUT':
      return 'logged out';
    case 'DOWNLOAD':
      return 'downloaded';
    case 'EXPORT':
      return 'exported';
    case 'VIEW':
      return 'viewed';
    case 'READ':
      return 'read';
    case 'CONSENT':
      return 'recorded consent';
    case 'PURGE':
      return 'purged';
    case 'DSAR':
      return 'processed a data request';
    default:
      return (action ?? '').toLowerCase();
  }
}

/**
 * Application-level audit logging for events that are NOT table mutations
 * (e.g., LOGIN, LOGOUT). Table mutations are handled by PostgreSQL triggers.
 */
export async function logAuditEvent(params: {
  actorId: string | null;
  actorName: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actor_id: params.actorId,
      actor_name: params.actorName,
      action: params.action,
      entity: params.entity,
      entity_id: params.entityId ?? null,
      old_value: params.oldValue as never,
      new_value: params.newValue as never,
    },
  });
}

export async function logLogin(userId: string, userName: string): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorName: userName,
    action: AuditAction.LOGIN,
    entity: AuditEntity.AUTH,
  });
}

export async function logLogout(userId: string, userName: string): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorName: userName,
    action: AuditAction.LOGOUT,
    entity: AuditEntity.AUTH,
  });
}
