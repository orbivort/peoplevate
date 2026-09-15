import { prisma } from '../config/prisma.js';
import { withAuditContext } from '../utils/audit-context.js';
import { HttpError } from '../utils/http-error.js';
import { sendTimesheetStatusEmail } from './email-service.js';
import { logAuditEvent } from './audit-service.js';
import { ApprovalAction, AuditAction, AuditEntity, TimesheetStatus } from '#prisma';

const DAY_MS = 86_400_000;
const DESCRIPTION_MAX_LENGTH = 500;
const COMMENT_MAX_LENGTH = 500;

/** The authenticated user context threaded from the route layer. */
export interface RequestingUser {
  userId: string;
  role: string;
  employeeId?: string | null;
  userName?: string | null;
}

// ── DTOs (camelCase, contract-shaped) ──────────

export interface TimesheetEntryDto {
  id: string;
  timesheetId: string;
  employeeId: string;
  entryDate: string;
  projectId: string;
  project: { id: string; code: string; name: string; isBillable: boolean };
  taskId: string | null;
  task: { id: string; name: string } | null;
  hours: number;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimesheetApprovalDto {
  id: string;
  action: string;
  comment: string | null;
  approverId: string;
  approverEmail: string | null;
  createdAt: Date;
}

export interface TimesheetSummaryDto {
  id: string;
  employeeId: string;
  employee: { id: string; employeeNo: string; firstName: string; lastName: string };
  periodStart: Date;
  periodEnd: Date;
  status: TimesheetStatus;
  submittedAt: Date | null;
  weeklyTotalHours: number;
  entryCount: number;
}

export interface TimesheetDetailDto extends Omit<TimesheetSummaryDto, 'entryCount'> {
  createdAt: Date;
  updatedAt: Date;
  entries: TimesheetEntryDto[];
  approvals: TimesheetApprovalDto[];
  perDayTotals: { date: string; hours: number }[];
  perProjectTotals: {
    projectId: string;
    projectCode: string;
    projectName: string;
    hours: number;
  }[];
}

// ── Raw (snake_case) row shapes used by the mappers ──

type DecimalLike = number | string | { toNumber(): number };

interface RawProjectRef {
  id: string;
  code: string;
  name: string;
  is_billable: boolean;
}

interface RawEntry {
  id: string;
  timesheet_id: string;
  employee_id: string;
  entry_date: Date;
  project_id: string;
  project: RawProjectRef;
  task_id: string | null;
  task: { id: string; name: string } | null;
  hours: DecimalLike;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RawApproval {
  id: string;
  action: string;
  comment: string | null;
  approver_id: string;
  created_at: Date;
}

interface RawTimesheetDetail {
  id: string;
  employee_id: string;
  period_start: Date;
  period_end: Date;
  status: TimesheetStatus;
  submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  employee: { id: string; employee_no: string; first_name: string; last_name: string };
  entries: RawEntry[];
  approvals: RawApproval[];
}

// ── Helpers ─────────────────────────────────────

/** Convert a Decimal/number/string hour value to a plain JS number. */
function toHours(value: DecimalLike | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return value.toNumber();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Normalize a date to midnight UTC (date-only semantics, matching storage). */
function normalizeDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isPrismaErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === code
  );
}

/**
 * Monday 00:00:00.000 → Sunday 23:59:59.999 (UTC) of the week containing `date`.
 */
export function getWeekPeriod(date: Date): { periodStart: Date; periodEnd: Date } {
  const dayUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (new Date(dayUtc).getUTCDay() + 6) % 7;
  const periodStart = new Date(dayUtc - daysSinceMonday * DAY_MS);
  const periodEnd = new Date(periodStart.getTime() + 7 * DAY_MS - 1);
  return { periodStart, periodEnd };
}

/**
 * Entry dates may only fall within the current or previous week (Monday-based,
 * server time UTC). Rejects future weeks and anything older than last week.
 */
function assertEntryDateInWindow(entryDate: Date, now: Date = new Date()): void {
  const current = getWeekPeriod(now);
  const previousStart = new Date(current.periodStart.getTime() - 7 * DAY_MS);
  if (
    entryDate.getTime() < previousStart.getTime() ||
    entryDate.getTime() > current.periodEnd.getTime()
  ) {
    throw new HttpError(400, 'entryDate must fall within the current or previous week');
  }
}

/** Validate hours using integer cent-hours math (avoids float drift). */
function assertValidHours(hours: number): number {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) {
    throw new HttpError(400, 'hours must be a finite number');
  }
  const centHours = Math.round(hours * 100);
  if (centHours <= 0) throw new HttpError(400, 'hours must be greater than 0');
  if (centHours > 2400) throw new HttpError(400, 'hours cannot exceed 24 per entry');
  if (centHours % 25 !== 0) throw new HttpError(400, 'hours must be a multiple of 0.25');
  return centHours / 100;
}

function assertValidDescription(description: string | null | undefined): void {
  if (
    description !== undefined &&
    description !== null &&
    description.length > DESCRIPTION_MAX_LENGTH
  ) {
    throw new HttpError(400, `description must be at most ${DESCRIPTION_MAX_LENGTH} characters`);
  }
}

/** Entries are only editable while the timesheet is DRAFT or REJECTED. */
function assertEditable(status: TimesheetStatus): void {
  if (status !== TimesheetStatus.DRAFT && status !== TimesheetStatus.REJECTED) {
    throw new HttpError(409, 'Timesheet is locked for editing', 'TIMESHEET_LOCKED');
  }
}

async function assertProjectAndTaskValid(
  projectId: string,
  taskId: string | null | undefined,
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, is_active: true, deleted_at: null },
    select: { id: true },
  });
  if (!project) throw new HttpError(400, 'Project not found or inactive');

  if (taskId) {
    const task = await prisma.projectTask.findFirst({
      where: { id: taskId, project_id: projectId, is_active: true, deleted_at: null },
      select: { id: true },
    });
    if (!task) throw new HttpError(400, 'Task not found, inactive, or not part of the project');
  }
}

/** Sum of non-deleted entries for the day plus the new hours must stay ≤ 24. */
async function assertDayTotalWithinCap(
  employeeId: string,
  entryDate: Date,
  hours: number,
  excludeEntryId?: string,
): Promise<void> {
  const where: Record<string, unknown> = {
    employee_id: employeeId,
    entry_date: entryDate,
    deleted_at: null,
  };
  if (excludeEntryId) where.id = { not: excludeEntryId };

  const dayTotal = await prisma.timesheetEntry.aggregate({
    where: where as never,
    _sum: { hours: true },
  });
  const existing = toHours(dayTotal._sum.hours as DecimalLike | null);
  if (round2(existing + hours) > 24) {
    throw new HttpError(
      409,
      'Total logged hours for this date would exceed 24',
      'DAY_TOTAL_EXCEEDED',
    );
  }
}

/** A duplicate employee + date + project + task entry is an overlap conflict. */
async function assertNoOverlappingEntry(
  employeeId: string,
  entryDate: Date,
  projectId: string,
  taskId: string | null | undefined,
  excludeEntryId?: string,
): Promise<void> {
  const where: Record<string, unknown> = {
    employee_id: employeeId,
    entry_date: entryDate,
    project_id: projectId,
    task_id: taskId ?? null,
    deleted_at: null,
  };
  if (excludeEntryId) where.id = { not: excludeEntryId };

  const overlap = await prisma.timesheetEntry.findFirst({ where: where as never });
  if (overlap) {
    throw new HttpError(
      409,
      'An entry for this project/task on this date already exists',
      'ENTRY_OVERLAP',
    );
  }
}

/** Get-or-create the DRAFT timesheet for an employee's week. */
async function getOrCreateTimesheet(
  employeeId: string,
  periodStart: Date,
  periodEnd: Date,
  actorId: string,
  actorName: string,
): Promise<{ id: string; status: TimesheetStatus }> {
  const existing = await prisma.timesheet.findFirst({
    where: { employee_id: employeeId, period_start: periodStart, deleted_at: null },
    select: { id: true, status: true },
  });
  if (existing) return existing;

  try {
    return await withAuditContext(prisma, actorId, actorName, (tx) =>
      tx.timesheet.create({
        data: {
          employee_id: employeeId,
          period_start: periodStart,
          period_end: periodEnd,
          status: TimesheetStatus.DRAFT,
        },
        select: { id: true, status: true },
      }),
    );
  } catch (err) {
    // Lost the get-or-create race on (employee_id, period_start) — re-fetch.
    if (isPrismaErrorCode(err, 'P2002')) {
      const raced = await prisma.timesheet.findFirst({
        where: { employee_id: employeeId, period_start: periodStart, deleted_at: null },
        select: { id: true, status: true },
      });
      if (raced) return raced;
    }
    throw err;
  }
}

function mapEntryDto(entry: RawEntry): TimesheetEntryDto {
  return {
    id: entry.id,
    timesheetId: entry.timesheet_id,
    employeeId: entry.employee_id,
    entryDate: dateKey(entry.entry_date),
    projectId: entry.project_id,
    project: {
      id: entry.project.id,
      code: entry.project.code,
      name: entry.project.name,
      isBillable: entry.project.is_billable,
    },
    taskId: entry.task_id,
    task: entry.task ? { id: entry.task.id, name: entry.task.name } : null,
    hours: round2(toHours(entry.hours)),
    description: entry.description,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

function mapTimesheetDetail(
  ts: RawTimesheetDetail,
  approverEmails: Map<string, string>,
): TimesheetDetailDto {
  const entries = ts.entries.map(mapEntryDto);
  const weeklyTotalHours = round2(entries.reduce((sum, e) => sum + e.hours, 0));

  // One total per day of the week (Mon–Sun), zero-filled for days without entries.
  const perDayTotals: { date: string; hours: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const key = dateKey(new Date(ts.period_start.getTime() + i * DAY_MS));
    const hours = round2(
      entries.filter((e) => e.entryDate === key).reduce((sum, e) => sum + e.hours, 0),
    );
    perDayTotals.push({ date: key, hours });
  }

  const projectTotals = new Map<
    string,
    { projectId: string; projectCode: string; projectName: string; hours: number }
  >();
  for (const entry of entries) {
    const current = projectTotals.get(entry.projectId) ?? {
      projectId: entry.projectId,
      projectCode: entry.project.code,
      projectName: entry.project.name,
      hours: 0,
    };
    current.hours = round2(current.hours + entry.hours);
    projectTotals.set(entry.projectId, current);
  }

  return {
    id: ts.id,
    employeeId: ts.employee_id,
    employee: {
      id: ts.employee.id,
      employeeNo: ts.employee.employee_no,
      firstName: ts.employee.first_name,
      lastName: ts.employee.last_name,
    },
    periodStart: ts.period_start,
    periodEnd: ts.period_end,
    status: ts.status,
    submittedAt: ts.submitted_at,
    createdAt: ts.created_at,
    updatedAt: ts.updated_at,
    entries,
    approvals: ts.approvals.map((a) => ({
      id: a.id,
      action: a.action,
      comment: a.comment,
      approverId: a.approver_id,
      approverEmail: approverEmails.get(a.approver_id) ?? null,
      createdAt: a.created_at,
    })),
    weeklyTotalHours,
    perDayTotals,
    perProjectTotals: [...projectTotals.values()],
  };
}

/** Fetch a timesheet with entries + approvals and map it to the detail DTO. */
async function getTimesheetDetailById(timesheetId: string): Promise<TimesheetDetailDto> {
  const timesheet = await prisma.timesheet.findFirst({
    where: { id: timesheetId, deleted_at: null },
    include: {
      employee: { select: { id: true, employee_no: true, first_name: true, last_name: true } },
      entries: {
        where: { deleted_at: null },
        orderBy: [{ entry_date: 'asc' }, { created_at: 'asc' }],
        include: {
          project: { select: { id: true, code: true, name: true, is_billable: true } },
          task: { select: { id: true, name: true } },
        },
      },
      approvals: { orderBy: { created_at: 'asc' } },
    },
  });
  if (!timesheet) throw new HttpError(404, 'Timesheet not found');

  // TimesheetApproval.approver_id references User.id without a Prisma relation,
  // so approver emails are resolved with a single batched lookup.
  const approverIds = [...new Set(timesheet.approvals.map((a) => a.approver_id))];
  const approvers =
    approverIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: approverIds } },
          select: { id: true, email: true },
        })
      : [];

  return mapTimesheetDetail(timesheet, new Map(approvers.map((u) => [u.id, u.email])));
}

function periodLabel(periodStart: Date, periodEnd: Date): string {
  return `${dateKey(periodStart)} to ${dateKey(periodEnd)}`;
}

// ── Entry CRUD ──────────────────────────────────

export async function createTimesheetEntry(params: {
  employeeId: string;
  entryDate: Date;
  projectId: string;
  taskId?: string | null | undefined;
  hours: number;
  description?: string | null | undefined;
  actorId: string;
  actorName: string;
}): Promise<TimesheetDetailDto> {
  const hours = assertValidHours(params.hours);
  assertValidDescription(params.description);
  const entryDate = normalizeDateOnly(params.entryDate);
  assertEntryDateInWindow(entryDate);
  await assertProjectAndTaskValid(params.projectId, params.taskId);

  const { periodStart, periodEnd } = getWeekPeriod(entryDate);
  const timesheet = await getOrCreateTimesheet(
    params.employeeId,
    periodStart,
    periodEnd,
    params.actorId,
    params.actorName,
  );
  assertEditable(timesheet.status);

  await assertDayTotalWithinCap(params.employeeId, entryDate, hours);
  await assertNoOverlappingEntry(params.employeeId, entryDate, params.projectId, params.taskId);

  await withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    await tx.timesheetEntry.create({
      data: {
        timesheet_id: timesheet.id,
        employee_id: params.employeeId,
        entry_date: entryDate,
        project_id: params.projectId,
        task_id: params.taskId ?? null,
        hours,
        description: params.description ?? null,
      },
    });
  });

  return getTimesheetDetailById(timesheet.id);
}

export async function updateTimesheetEntry(params: {
  entryId: string;
  employeeId: string;
  entryDate?: Date | undefined;
  projectId?: string | undefined;
  taskId?: string | null | undefined;
  hours?: number | undefined;
  description?: string | null | undefined;
  actorId: string;
  actorName: string;
}): Promise<TimesheetDetailDto> {
  const entry = await prisma.timesheetEntry.findFirst({
    where: { id: params.entryId, deleted_at: null },
    include: { timesheet: true },
  });
  // Owner-only: a missing entry and someone else's entry are indistinguishable.
  if (!entry || entry.employee_id !== params.employeeId) {
    throw new HttpError(404, 'Timesheet entry not found');
  }
  assertEditable(entry.timesheet.status);

  const nextDate =
    params.entryDate !== undefined ? normalizeDateOnly(params.entryDate) : entry.entry_date;
  const nextProjectId = params.projectId ?? entry.project_id;
  const nextTaskId = params.taskId !== undefined ? params.taskId : entry.task_id;
  const nextHours =
    params.hours !== undefined ? assertValidHours(params.hours) : toHours(entry.hours);
  const nextDescription = params.description !== undefined ? params.description : entry.description;
  assertValidDescription(nextDescription);

  if (params.entryDate !== undefined) assertEntryDateInWindow(nextDate);
  if (params.projectId !== undefined || params.taskId !== undefined) {
    await assertProjectAndTaskValid(nextProjectId, nextTaskId);
  }

  // A date change into another week moves the entry to that week's timesheet.
  const nextPeriod = getWeekPeriod(nextDate);
  let targetTimesheet: { id: string; status: TimesheetStatus } = entry.timesheet;
  if (nextPeriod.periodStart.getTime() !== entry.timesheet.period_start.getTime()) {
    targetTimesheet = await getOrCreateTimesheet(
      params.employeeId,
      nextPeriod.periodStart,
      nextPeriod.periodEnd,
      params.actorId,
      params.actorName,
    );
    assertEditable(targetTimesheet.status);
  }

  await assertDayTotalWithinCap(params.employeeId, nextDate, nextHours, params.entryId);
  await assertNoOverlappingEntry(
    params.employeeId,
    nextDate,
    nextProjectId,
    nextTaskId,
    params.entryId,
  );

  const data: Record<string, unknown> = {};
  if (params.entryDate !== undefined) data.entry_date = nextDate;
  if (params.projectId !== undefined) data.project_id = nextProjectId;
  if (params.taskId !== undefined) data.task_id = nextTaskId ?? null;
  if (params.hours !== undefined) data.hours = nextHours;
  if (params.description !== undefined) data.description = nextDescription ?? null;
  if (targetTimesheet.id !== entry.timesheet.id) data.timesheet_id = targetTimesheet.id;

  await withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    await tx.timesheetEntry.update({ where: { id: params.entryId }, data: data as never });
  });

  return getTimesheetDetailById(targetTimesheet.id);
}

export async function deleteTimesheetEntry(params: {
  entryId: string;
  employeeId: string;
  actorId: string;
  actorName: string;
}): Promise<TimesheetDetailDto> {
  const entry = await prisma.timesheetEntry.findFirst({
    where: { id: params.entryId, deleted_at: null },
    include: { timesheet: true },
  });
  if (!entry || entry.employee_id !== params.employeeId) {
    throw new HttpError(404, 'Timesheet entry not found');
  }
  assertEditable(entry.timesheet.status);

  await withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    await tx.timesheetEntry.update({
      where: { id: params.entryId },
      data: { deleted_at: new Date() },
    });
  });

  return getTimesheetDetailById(entry.timesheet_id);
}

// ── Timesheet lifecycle ─────────────────────────

export async function getCurrentTimesheet(params: {
  employeeId: string;
  date?: Date | undefined;
  actorId: string;
  actorName: string;
}): Promise<TimesheetDetailDto> {
  const date = params.date ?? new Date();
  if (params.date !== undefined) assertEntryDateInWindow(normalizeDateOnly(params.date));

  const { periodStart, periodEnd } = getWeekPeriod(date);
  const timesheet = await getOrCreateTimesheet(
    params.employeeId,
    periodStart,
    periodEnd,
    params.actorId,
    params.actorName,
  );
  return getTimesheetDetailById(timesheet.id);
}

export async function listTimesheets(params: {
  employeeId: string;
  status?: TimesheetStatus | undefined;
  periodStart?: Date | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}): Promise<{ timesheets: TimesheetSummaryDto[]; total: number; page: number; pageSize: number }> {
  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 20;

  const where: Record<string, unknown> = { employee_id: params.employeeId, deleted_at: null };
  if (params.status) where.status = params.status;
  if (params.periodStart) {
    // Match the whole week starting at the given Monday.
    where.period_start = {
      gte: normalizeDateOnly(params.periodStart),
      lt: new Date(normalizeDateOnly(params.periodStart).getTime() + 7 * DAY_MS),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.timesheet.count({ where: where as never }),
    prisma.timesheet.findMany({
      where: where as never,
      orderBy: { period_start: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        employee: { select: { id: true, employee_no: true, first_name: true, last_name: true } },
      },
    }),
  ]);

  // Totals come from one grouped aggregation instead of loading all entries.
  const ids = rows.map((r) => r.id);
  const totals =
    ids.length > 0
      ? await prisma.timesheetEntry.groupBy({
          by: ['timesheet_id'],
          where: { timesheet_id: { in: ids }, deleted_at: null },
          _sum: { hours: true },
          _count: true,
        })
      : [];
  const totalsByTimesheet = new Map(totals.map((t) => [t.timesheet_id, t]));

  return {
    timesheets: rows.map((r) => {
      const t = totalsByTimesheet.get(r.id);
      return {
        id: r.id,
        employeeId: r.employee_id,
        employee: {
          id: r.employee.id,
          employeeNo: r.employee.employee_no,
          firstName: r.employee.first_name,
          lastName: r.employee.last_name,
        },
        periodStart: r.period_start,
        periodEnd: r.period_end,
        status: r.status,
        submittedAt: r.submitted_at,
        weeklyTotalHours: round2(toHours(t?._sum.hours as DecimalLike | null | undefined)),
        entryCount: t?._count ?? 0,
      };
    }),
    total,
    page,
    pageSize,
  };
}

/** Resolve the employee record linked to a user (null when not linked). */
async function findEmployeeByUserId(userId: string): Promise<{ id: string } | null> {
  return prisma.employee.findUnique({ where: { user_id: userId }, select: { id: true } });
}

/** Owner, the employee's direct manager, HR_MANAGER, or ADMIN — else 403. */
async function assertCanAccessTimesheet(
  employee: { id: string; manager_id: string | null; user_id: string | null },
  requestingUser: RequestingUser,
): Promise<void> {
  if (requestingUser.role === 'HR_MANAGER' || requestingUser.role === 'ADMIN') return;
  if (employee.user_id === requestingUser.userId) return;
  if (requestingUser.employeeId && requestingUser.employeeId === employee.id) return;

  if (requestingUser.role === 'MANAGER') {
    const manager = await findEmployeeByUserId(requestingUser.userId);
    if (manager && manager.id === employee.manager_id) return;
  }
  throw new HttpError(403, 'Insufficient permissions');
}

export async function getTimesheetById(params: {
  timesheetId: string;
  requestingUser: RequestingUser;
}): Promise<TimesheetDetailDto> {
  const timesheet = await prisma.timesheet.findFirst({
    where: { id: params.timesheetId, deleted_at: null },
    select: {
      id: true,
      employee: { select: { id: true, manager_id: true, user_id: true } },
    },
  });
  if (!timesheet) throw new HttpError(404, 'Timesheet not found');

  await assertCanAccessTimesheet(timesheet.employee, params.requestingUser);
  return getTimesheetDetailById(timesheet.id);
}

export async function submitTimesheet(params: {
  timesheetId: string;
  employeeId: string;
  actorId: string;
  actorName: string;
}): Promise<TimesheetDetailDto> {
  const timesheet = await prisma.timesheet.findFirst({
    where: { id: params.timesheetId, deleted_at: null },
    include: {
      employee: {
        select: { id: true, manager_id: true, first_name: true, last_name: true },
      },
      entries: { where: { deleted_at: null }, select: { id: true } },
    },
  });
  if (!timesheet || timesheet.employee_id !== params.employeeId) {
    throw new HttpError(404, 'Timesheet not found');
  }
  if (timesheet.status !== TimesheetStatus.DRAFT && timesheet.status !== TimesheetStatus.REJECTED) {
    throw new HttpError(409, `Cannot submit a timesheet in status ${timesheet.status}`);
  }
  if (timesheet.entries.length === 0) {
    throw new HttpError(400, 'Timesheet has no entries to submit');
  }
  if (!timesheet.employee.manager_id) {
    throw new HttpError(
      400,
      'No manager is assigned to you. Please contact HR to have a manager assigned before submitting your timesheet',
    );
  }

  await withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    await tx.timesheet.update({
      where: { id: timesheet.id },
      data: {
        status: TimesheetStatus.SUBMITTED,
        submitted_at: new Date(),
        submitted_by: params.actorId,
      },
    });
  });

  // Notify the manager (outside the transaction); skip silently if they have
  // no linked user account or email address.
  const manager = await prisma.employee.findUnique({
    where: { id: timesheet.employee.manager_id },
    select: { first_name: true, last_name: true, user: { select: { email: true } } },
  });
  if (manager?.user?.email) {
    const employeeName = `${timesheet.employee.first_name} ${timesheet.employee.last_name}`.trim();
    await sendTimesheetStatusEmail(
      manager.user.email,
      `${manager.first_name} ${manager.last_name}`.trim(),
      employeeName,
      periodLabel(timesheet.period_start, timesheet.period_end),
      'submitted',
    );
  }

  return getTimesheetDetailById(timesheet.id);
}

export async function listPendingTimesheets(params: {
  managerEmployeeId?: string | undefined;
  role: string;
  userId: string;
}): Promise<TimesheetSummaryDto[]> {
  const where: Record<string, unknown> = {
    status: TimesheetStatus.SUBMITTED,
    deleted_at: null,
  };

  if (params.role === 'MANAGER') {
    const managerId = params.managerEmployeeId ?? (await findEmployeeByUserId(params.userId))?.id;
    if (!managerId) return [];
    where.employee = { manager_id: managerId };
  }

  const rows = await prisma.timesheet.findMany({
    where: where as never,
    orderBy: { submitted_at: 'asc' },
    include: {
      employee: { select: { id: true, employee_no: true, first_name: true, last_name: true } },
    },
  });

  const ids = rows.map((r) => r.id);
  const totals =
    ids.length > 0
      ? await prisma.timesheetEntry.groupBy({
          by: ['timesheet_id'],
          where: { timesheet_id: { in: ids }, deleted_at: null },
          _sum: { hours: true },
          _count: true,
        })
      : [];
  const totalsByTimesheet = new Map(totals.map((t) => [t.timesheet_id, t]));

  return rows.map((r) => {
    const t = totalsByTimesheet.get(r.id);
    return {
      id: r.id,
      employeeId: r.employee_id,
      employee: {
        id: r.employee.id,
        employeeNo: r.employee.employee_no,
        firstName: r.employee.first_name,
        lastName: r.employee.last_name,
      },
      periodStart: r.period_start,
      periodEnd: r.period_end,
      status: r.status,
      submittedAt: r.submitted_at,
      weeklyTotalHours: round2(toHours(t?._sum.hours as DecimalLike | null | undefined)),
      entryCount: t?._count ?? 0,
    };
  });
}

/** Load a timesheet plus its employee for an approve/reject decision. */
async function loadTimesheetForDecision(timesheetId: string): Promise<{
  id: string;
  employee_id: string;
  status: TimesheetStatus;
  period_start: Date;
  period_end: Date;
  employee: {
    id: string;
    manager_id: string | null;
    email: string;
    first_name: string;
    last_name: string;
  };
}> {
  const timesheet = await prisma.timesheet.findFirst({
    where: { id: timesheetId, deleted_at: null },
    include: {
      employee: {
        select: { id: true, manager_id: true, email: true, first_name: true, last_name: true },
      },
    },
  });
  if (!timesheet) throw new HttpError(404, 'Timesheet not found');
  return timesheet;
}

/**
 * Authorization for approve/reject: the employee's direct manager (live
 * relation), HR_MANAGER, or ADMIN. Self-approval/self-rejection is blocked.
 */
async function assertCanDecide(
  timesheetEmployeeId: string,
  employeeManagerId: string | null,
  approverId: string,
  approverRole: string,
): Promise<void> {
  const approverEmployee = await findEmployeeByUserId(approverId);
  if (approverEmployee && approverEmployee.id === timesheetEmployeeId) {
    throw new HttpError(403, 'You cannot approve or reject your own timesheet');
  }
  if (approverRole === 'HR_MANAGER' || approverRole === 'ADMIN') return;
  if (approverEmployee && employeeManagerId && approverEmployee.id === employeeManagerId) return;
  throw new HttpError(403, 'Only the employee manager, HR, or an admin can decide this timesheet');
}

export async function approveTimesheet(params: {
  timesheetId: string;
  approverId: string;
  approverRole: string;
  comment?: string | null | undefined;
  actorId: string;
  actorName: string;
}): Promise<TimesheetDetailDto> {
  if (
    params.comment !== undefined &&
    params.comment !== null &&
    params.comment.length > COMMENT_MAX_LENGTH
  ) {
    throw new HttpError(400, `comment must be at most ${COMMENT_MAX_LENGTH} characters`);
  }

  const timesheet = await loadTimesheetForDecision(params.timesheetId);
  if (timesheet.status !== TimesheetStatus.SUBMITTED) {
    throw new HttpError(409, `Cannot approve a timesheet in status ${timesheet.status}`);
  }
  await assertCanDecide(
    timesheet.employee_id,
    timesheet.employee.manager_id,
    params.approverId,
    params.approverRole,
  );

  await withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    await tx.timesheetApproval.create({
      data: {
        timesheet_id: timesheet.id,
        approver_id: params.approverId,
        action: ApprovalAction.APPROVE,
        comment: params.comment ?? null,
      },
    });
    await tx.timesheet.update({
      where: { id: timesheet.id },
      data: { status: TimesheetStatus.APPROVED },
    });
  });

  // Approve/reject decisions are logged at the application level (the status
  // change itself is already captured by the DB trigger audit context above).
  await logAuditEvent({
    actorId: params.actorId,
    actorName: params.actorName,
    action: AuditAction.APPROVE,
    entity: AuditEntity.TIMESHEET,
    entityId: timesheet.id,
    newValue: { status: TimesheetStatus.APPROVED, comment: params.comment ?? null },
  });

  const employeeName = `${timesheet.employee.first_name} ${timesheet.employee.last_name}`.trim();
  await sendTimesheetStatusEmail(
    timesheet.employee.email,
    employeeName,
    employeeName,
    periodLabel(timesheet.period_start, timesheet.period_end),
    'approved',
    params.comment ?? undefined,
  );

  return getTimesheetDetailById(timesheet.id);
}

export async function rejectTimesheet(params: {
  timesheetId: string;
  approverId: string;
  approverRole: string;
  comment: string;
  actorId: string;
  actorName: string;
}): Promise<TimesheetDetailDto> {
  const comment = params.comment?.trim() ?? '';
  if (comment.length < 1 || comment.length > COMMENT_MAX_LENGTH) {
    throw new HttpError(400, 'A rejection comment between 1 and 500 characters is required');
  }

  const timesheet = await loadTimesheetForDecision(params.timesheetId);
  if (timesheet.status !== TimesheetStatus.SUBMITTED) {
    throw new HttpError(409, `Cannot reject a timesheet in status ${timesheet.status}`);
  }
  await assertCanDecide(
    timesheet.employee_id,
    timesheet.employee.manager_id,
    params.approverId,
    params.approverRole,
  );

  await withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    await tx.timesheetApproval.create({
      data: {
        timesheet_id: timesheet.id,
        approver_id: params.approverId,
        action: ApprovalAction.REJECT,
        comment,
      },
    });
    // REJECTED unlocks entry editing for the owner.
    await tx.timesheet.update({
      where: { id: timesheet.id },
      data: { status: TimesheetStatus.REJECTED },
    });
  });

  await logAuditEvent({
    actorId: params.actorId,
    actorName: params.actorName,
    action: AuditAction.REJECT,
    entity: AuditEntity.TIMESHEET,
    entityId: timesheet.id,
    newValue: { status: TimesheetStatus.REJECTED, comment },
  });

  const employeeName = `${timesheet.employee.first_name} ${timesheet.employee.last_name}`.trim();
  await sendTimesheetStatusEmail(
    timesheet.employee.email,
    employeeName,
    employeeName,
    periodLabel(timesheet.period_start, timesheet.period_end),
    'rejected',
    comment,
  );

  return getTimesheetDetailById(timesheet.id);
}
