import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withAuditContext } from '../utils/audit-context.js';
import {
  sendResignationAck,
  sendDeactivationNotice,
  sendClearanceReminderEmail,
} from './email-service.js';
import {
  SeparationType,
  OffboardingStatus,
  ClearanceItemStatus,
  ClearanceCategory,
  EmploymentStatus,
} from '#prisma';
import { HttpError } from '../utils/http-error.js';

// ── Resignation / Termination ──────────────────

export async function submitResignation(params: {
  employeeId: string;
  reason?: string | undefined;
  lastWorkingDay: Date;
  actorId: string;
  actorName: string;
}): Promise<unknown> {
  const existing = await prisma.offboardingRecord.findFirst({
    where: { employee_id: params.employeeId, deleted_at: null },
  });
  if (existing) throw new HttpError(400, 'An offboarding record already exists for this employee');

  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, deleted_at: null },
  });
  if (!employee) throw new HttpError(404, 'Employee not found');

  // Notice period minimum warning
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + env.NOTICE_PERIOD_MIN_DAYS);
  const noticeWarning = params.lastWorkingDay.getTime() < minDate.getTime();

  const offboarding = await withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.offboardingRecord.create({
      data: {
        employee_id: params.employeeId,
        separation_type: SeparationType.RESIGNATION,
        reason: params.reason ?? null,
        last_working_day: params.lastWorkingDay,
        deactivation_date: params.lastWorkingDay,
        status: OffboardingStatus.INITIATED,
        initiated_by: params.actorId,
      },
    }),
  );

  // Auto-generate clearance checklist
  await generateClearanceChecklist(offboarding.id);

  await sendResignationAck(employee.email, `${employee.first_name} ${employee.last_name}`);

  return { offboarding, noticeWarning };
}

export async function initiateTermination(params: {
  employeeId: string;
  separationType: SeparationType;
  reason?: string | undefined;
  effectiveDate: Date;
  initiatedBy: string;
}): Promise<unknown> {
  if (params.separationType === SeparationType.DISMISSAL) {
    // Dismissal requires HR — enforced at route level
  }

  const existing = await prisma.offboardingRecord.findFirst({
    where: { employee_id: params.employeeId, deleted_at: null },
  });
  if (existing) throw new HttpError(400, 'Employee already has an offboarding record');

  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, deleted_at: null },
  });
  if (!employee) throw new HttpError(404, 'Employee not found');
  if (employee.status === EmploymentStatus.TERMINATED) {
    throw new HttpError(400, 'Employee is already terminated');
  }

  const offboarding = await prisma.offboardingRecord.create({
    data: {
      employee_id: params.employeeId,
      separation_type: params.separationType,
      reason: params.reason ?? null,
      last_working_day: params.effectiveDate,
      deactivation_date: params.effectiveDate,
      status: OffboardingStatus.INITIATED,
      initiated_by: params.initiatedBy,
    },
  });

  await generateClearanceChecklist(offboarding.id);
  return offboarding;
}

export async function listOffboardingRecords(params: {
  role: string;
  userId: string;
  status?: OffboardingStatus | undefined;
}): Promise<unknown[]> {
  if (params.role === 'EMPLOYEE') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { id: true },
    });
    if (!self) return [];
    return prisma.offboardingRecord.findMany({
      where: {
        employee_id: self.id,
        deleted_at: null,
        ...(params.status ? { status: params.status } : {}),
      },
      include: {
        employee: { select: { id: true, first_name: true, last_name: true, email: true } },
      },
      orderBy: { initiated_at: 'desc' },
    });
  }
  return prisma.offboardingRecord.findMany({
    where: { deleted_at: null, ...(params.status ? { status: params.status } : {}) },
    include: { employee: { select: { id: true, first_name: true, last_name: true, email: true } } },
    orderBy: { initiated_at: 'desc' },
  });
}

export async function getOffboardingRecord(id: string): Promise<unknown> {
  const record = await prisma.offboardingRecord.findFirst({
    where: { id, deleted_at: null },
    include: {
      employee: { select: { id: true, first_name: true, last_name: true, email: true } },
      clearance_items: { where: { deleted_at: null } },
      exit_interviews: true,
      settlements: true,
    },
  });
  if (!record) throw new HttpError(404, 'Offboarding record not found');
  return record;
}

// ── Clearance checklist ────────────────────────

async function generateClearanceChecklist(offboardingId: string): Promise<void> {
  const defaultItems: { category: ClearanceCategory; description: string }[] = [
    { category: ClearanceCategory.ASSET_RETURN, description: 'Return company laptop and assets' },
    {
      category: ClearanceCategory.ACCESS_REVOCATION,
      description: 'Revoke system and building access',
    },
    {
      category: ClearanceCategory.KNOWLEDGE_TRANSFER,
      description: 'Complete knowledge transfer to team',
    },
    { category: ClearanceCategory.FINAL_SETTLEMENT, description: 'Prepare final settlement' },
  ];
  for (const item of defaultItems) {
    await prisma.clearanceItem.create({
      data: {
        offboarding_id: offboardingId,
        category: item.category,
        description: item.description,
        status: ClearanceItemStatus.PENDING,
      },
    });
  }
}

export async function listClearanceItems(offboardingId: string): Promise<unknown[]> {
  return prisma.clearanceItem.findMany({
    where: { offboarding_id: offboardingId, deleted_at: null },
    include: { responsible_party: { select: { id: true, email: true } } },
    orderBy: { created_at: 'asc' },
  });
}

export async function updateClearanceItem(params: {
  id: string;
  status?: ClearanceItemStatus | undefined;
  responsiblePartyId?: string | undefined;
  waivedReason?: string | undefined;
  actorId: string;
  actorRole: string;
}): Promise<unknown> {
  const item = await prisma.clearanceItem.findFirst({ where: { id: params.id, deleted_at: null } });
  if (!item) throw new HttpError(404, 'Clearance item not found');

  const data: Record<string, unknown> = {};

  // Waive requires HR approval + audit note
  if (params.status === ClearanceItemStatus.WAIVED) {
    if (params.actorRole !== 'ADMIN' && params.actorRole !== 'HR_MANAGER') {
      throw new HttpError(403, 'Only HR can waive a clearance item');
    }
    data.status = ClearanceItemStatus.WAIVED;
    data.waived_reason = params.waivedReason ?? 'Waived by HR';
  } else if (params.status === ClearanceItemStatus.COMPLETE) {
    data.status = ClearanceItemStatus.COMPLETE;
    data.completed_at = new Date();
    data.sign_off_by = params.actorId;
  } else if (params.status) {
    data.status = params.status;
  }

  if (params.responsiblePartyId !== undefined)
    data.responsible_party_id = params.responsiblePartyId;

  return withAuditContext(prisma, params.actorId, '', async (tx) => {
    const updated = await tx.clearanceItem.update({ where: { id: params.id }, data });
    if (updated.status === ClearanceItemStatus.PENDING) {
      // send reminder
      const party = await tx.user.findFirst({
        where: { id: updated.responsible_party_id ?? '' },
        select: { email: true },
      });
      if (party) await sendClearanceReminderEmail(party.email, party.email, updated.description);
    }
    return updated;
  });
}

export async function closeOffboarding(
  id: string,
  actorId: string,
  _actorRole: string,
): Promise<unknown> {
  const record = await prisma.offboardingRecord.findFirst({ where: { id, deleted_at: null } });
  if (!record) throw new HttpError(404, 'Offboarding record not found');
  if (record.status === OffboardingStatus.CLOSED)
    throw new HttpError(400, 'Offboarding already closed');

  const items = await prisma.clearanceItem.findMany({
    where: { offboarding_id: id, deleted_at: null },
  });
  const incomplete = items.filter((i) => i.status === ClearanceItemStatus.PENDING);
  if (incomplete.length > 0) {
    throw new HttpError(
      400,
      `Clearance items still pending: ${incomplete.map((i) => i.description).join(', ')}`,
    );
  }

  return withAuditContext(prisma, actorId, '', async (tx) => {
    // Set employee deactivation date & status
    await tx.employee.update({
      where: { id: record.employee_id },
      data: { status: EmploymentStatus.TERMINATED, deactivation_date: record.deactivation_date },
    });
    return tx.offboardingRecord.update({
      where: { id },
      data: { status: OffboardingStatus.CLOSED },
    });
  });
}

// ── Exit interview ─────────────────────────────

export async function conductExitInterview(params: {
  offboardingId: string;
  responses: unknown;
  declined?: boolean | undefined;
  conductedBy: string;
}): Promise<unknown> {
  const record = await prisma.offboardingRecord.findFirst({
    where: { id: params.offboardingId, deleted_at: null },
  });
  if (!record) throw new HttpError(404, 'Offboarding record not found');

  return prisma.exitInterview.create({
    data: {
      offboarding_id: params.offboardingId,
      conducted_by: params.conductedBy,
      conducted_at: params.declined ? null : new Date(),
      declined: params.declined ?? false,
      responses: params.responses as never,
    },
  });
}

// ── Cron: Deactivation ─────────────────────────

export async function runDeactivationCheck(): Promise<void> {
  logger.info('Running account deactivation check...');
  const now = new Date();

  const records = await prisma.offboardingRecord.findMany({
    where: {
      status: { not: OffboardingStatus.CLOSED },
      deactivation_date: { lte: now },
      deleted_at: null,
    },
    include: { employee: { include: { user: true } } },
  });

  let deactivated = 0;
  for (const rec of records) {
    const user = rec.employee.user;
    if (user && user.status !== 'DEACTIVATED') {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'DEACTIVATED' },
      });
      await prisma.employee.update({
        where: { id: rec.employee_id },
        data: { status: EmploymentStatus.TERMINATED },
      });
      await sendDeactivationNotice(
        rec.employee.email,
        `${rec.employee.first_name} ${rec.employee.last_name}`,
      );
      deactivated++;
    }
  }
  logger.info(`Deactivation check complete: ${deactivated} accounts deactivated.`);
}
