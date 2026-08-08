import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { ChangeType } from '#prisma';

const MANAGER_ALLOWED_TYPES: ChangeType[] = [ChangeType.MANAGER_CHANGE, ChangeType.STATUS_CHANGE];
const ALL_TYPES: ChangeType[] = [
  ChangeType.PROMOTION,
  ChangeType.TRANSFER,
  ChangeType.MANAGER_CHANGE,
  ChangeType.SALARY_ADJUSTMENT,
  ChangeType.STATUS_CHANGE,
];

export function getAllowedChangeTypes(role: string): ChangeType[] {
  if (role === 'ADMIN' || role === 'HR_MANAGER') {
    return ALL_TYPES;
  }
  if (role === 'MANAGER') {
    return MANAGER_ALLOWED_TYPES;
  }
  return [];
}

export async function recordChange(params: {
  employeeId: string;
  changeType: ChangeType;
  oldValue?: unknown;
  newValue?: unknown;
  effectiveDate: Date;
  reason?: string | undefined;
  recordedBy: string;
  role: string;
  isDirectReport?: boolean;
}): Promise<void> {
  const allowedTypes = getAllowedChangeTypes(params.role);
  if (!allowedTypes.includes(params.changeType)) {
    throw new HttpError(403, 'You are not allowed to record this change type');
  }

  // Manager can only record for direct reports
  if (params.role === 'MANAGER' && !params.isDirectReport) {
    throw new HttpError(403, 'You can only record changes for your direct reports');
  }

  const isImmediate = params.effectiveDate <= new Date();
  // Manager changes are always Pending, HR/Admin can apply immediately
  const status = params.role === 'MANAGER' || !isImmediate ? 'PENDING' : 'APPLIED';

  await prisma.employmentChange.create({
    data: {
      employee_id: params.employeeId,
      change_type: params.changeType,
      old_value: params.oldValue as never,
      new_value: params.newValue as never,
      effective_date: params.effectiveDate,
      status,
      reason: params.reason ?? null,
      recorded_by: params.recordedBy,
    },
  });

  // If applied immediately, update the employee record
  if (status === 'APPLIED') {
    await applyChange(params.employeeId, params.changeType, params.newValue);
  }
}

export async function listChanges(employeeId: string): Promise<unknown[]> {
  const changes = await prisma.employmentChange.findMany({
    where: { employee_id: employeeId },
    orderBy: [{ effective_date: 'desc' }, { created_at: 'desc' }],
  });
  return changes;
}

export async function applyPendingChange(changeId: string): Promise<void> {
  const change = await prisma.employmentChange.findUnique({
    where: { id: changeId },
  });
  if (!change || change.status !== 'PENDING') {
    throw new HttpError(400, 'Change not found or not pending');
  }

  await applyChange(change.employee_id, change.change_type, change.new_value);

  await prisma.employmentChange.update({
    where: { id: changeId },
    data: { status: 'APPLIED' },
  });
}

// ── Helpers ──────────────────────────────────

async function applyChange(
  employeeId: string,
  changeType: ChangeType,
  newValue: unknown,
): Promise<void> {
  const data = newValue as Record<string, unknown> | null;
  if (!data) return;

  const updateData: Record<string, unknown> = {};

  switch (changeType) {
    case ChangeType.PROMOTION:
      if (data.positionId) updateData.position_id = data.positionId;
      if (data.departmentId) updateData.department_id = data.departmentId;
      if (data.salary != null) {
        const { encrypt } = await import('../utils/crypto.js');
        updateData.salary_encrypted = encrypt(String(data.salary));
      }
      break;
    case ChangeType.TRANSFER:
      if (data.departmentId) updateData.department_id = data.departmentId;
      if (data.positionId) updateData.position_id = data.positionId;
      break;
    case ChangeType.MANAGER_CHANGE:
      if (data.managerId !== undefined) updateData.manager_id = data.managerId;
      break;
    case ChangeType.SALARY_ADJUSTMENT:
      if (data.salary != null) {
        const { encrypt } = await import('../utils/crypto.js');
        updateData.salary_encrypted = encrypt(String(data.salary));
      }
      break;
    case ChangeType.STATUS_CHANGE:
      if (data.status) updateData.status = data.status;
      break;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.employee.update({
      where: { id: employeeId },
      data: updateData,
    });
  }
}
