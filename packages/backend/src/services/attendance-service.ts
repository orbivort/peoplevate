import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withAuditContext } from '../utils/audit-context.js';
import { sendLeaveStatusEmail } from './email-service.js';
import { HttpError } from '../utils/http-error.js';
import { AttendanceType, LeaveRequestStatus, ApprovalAction, EmploymentStatus } from '#prisma';

// ── Attendance ─────────────────────────────────

/**
 * Truncates an IP address for data minimization (GDPR compliance).
 * IPv4: zeroes the last octet (e.g., 192.168.1.100 -> 192.168.1.0)
 * IPv6: zeroes the last 80 bits (e.g., 2001:db8::1 -> 2001:db8::)
 * Purpose: attendance fraud prevention. Retained for IP_RETENTION_DAYS (default 90).
 */
export function truncateIpAddress(ip: string | undefined): string | null {
  if (!ip) return null;
  // IPv4
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      parts[3] = '0';
      return parts.join('.');
    }
  }
  // IPv6 - truncate to first 4 groups (first 64 bits)
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length >= 4) {
      return parts.slice(0, 4).join(':') + '::';
    }
  }
  return ip;
}

export async function clockInOut(params: {
  employeeId: string;
  type: AttendanceType;
  ipAddress?: string | undefined;
  actorId: string;
  actorName: string;
}): Promise<unknown> {
  // Block clock-in while on approved leave
  if (params.type === AttendanceType.IN) {
    const onLeave = await isOnApprovedLeave(params.employeeId, new Date());
    if (onLeave) {
      throw new HttpError(400, 'You are on approved leave');
    }
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date();
  dayEnd.setHours(23, 59, 59, 999);

  // Duplicate clock-in warning
  let duplicateWarning = false;
  if (params.type === AttendanceType.IN) {
    const existing = await prisma.attendanceRecord.findFirst({
      where: {
        employee_id: params.employeeId,
        type: AttendanceType.IN,
        timestamp: { gte: dayStart, lte: dayEnd },
        deleted_at: null,
      },
    });
    duplicateWarning = !!existing;
    if (existing) {
      throw new HttpError(400, 'Already clocked in');
    }
  }

  const record = await withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.attendanceRecord.create({
      data: {
        employee_id: params.employeeId,
        timestamp: new Date(),
        type: params.type,
        ip_address: truncateIpAddress(params.ipAddress),
      },
    }),
  );

  // Auto-create missing clock-in if clocking out without prior clock-in
  let missingClockInFlag = false;
  if (params.type === AttendanceType.OUT) {
    const hasClockIn = await prisma.attendanceRecord.findFirst({
      where: {
        employee_id: params.employeeId,
        type: AttendanceType.IN,
        timestamp: { gte: dayStart, lte: dayEnd },
        deleted_at: null,
      },
    });
    if (!hasClockIn) {
      const startOfBusiness = new Date();
      startOfBusiness.setHours(9, 0, 0, 0);
      await withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
        tx.attendanceRecord.create({
          data: {
            employee_id: params.employeeId,
            timestamp: startOfBusiness,
            type: AttendanceType.IN,
            ip_address: null,
          },
        }),
      );
      missingClockInFlag = true;
    }
  }

  return { record, duplicateWarning, missingClockInFlag };
}

async function isOnApprovedLeave(employeeId: string, date: Date): Promise<boolean> {
  const active = await prisma.leaveRequest.findFirst({
    where: {
      employee_id: employeeId,
      status: LeaveRequestStatus.APPROVED,
      start_date: { lte: date },
      end_date: { gte: date },
      deleted_at: null,
    },
  });
  return !!active;
}

// Daily summary derivation
export async function getDailySummaries(params: {
  employeeId?: string | undefined;
  date?: string | undefined;
  role: string;
  userId: string;
}): Promise<unknown[]> {
  const date = params.date ? new Date(params.date) : new Date();
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  // Company / statutory holiday? If so, everyone is marked HOLIDAY (not Absent).
  const isHoliday = !!(await prisma.holiday.findFirst({
    where: {
      date: { gte: dayStart, lte: dayEnd },
      deleted_at: null,
    },
  }));

  let employees: { id: string; first_name: string; last_name: string }[];

  if (params.role === 'EMPLOYEE') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { id: true },
    });
    if (!self) return [];
    employees = [{ id: self.id, first_name: '', last_name: '' }];
  } else if (params.role === 'MANAGER' && params.employeeId) {
    employees = await prisma.employee.findMany({
      where: { id: params.employeeId },
      select: { id: true, first_name: true, last_name: true },
    });
  } else if (params.role === 'MANAGER') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { id: true },
    });
    if (!self) return [];
    employees = await prisma.employee.findMany({
      where: { manager_id: self.id },
      select: { id: true, first_name: true, last_name: true },
    });
  } else {
    employees = params.employeeId
      ? await prisma.employee.findMany({
          where: { id: params.employeeId },
          select: { id: true, first_name: true, last_name: true },
        })
      : await prisma.employee.findMany({
          where: { deleted_at: null },
          select: { id: true, first_name: true, last_name: true },
        });
  }

  const summaries: Record<string, unknown>[] = [];
  for (const emp of employees) {
    const records = await prisma.attendanceRecord.findMany({
      where: { employee_id: emp.id, timestamp: { gte: dayStart, lte: dayEnd }, deleted_at: null },
      orderBy: { timestamp: 'asc' },
    });

    const onLeave = await isOnApprovedLeave(emp.id, date);
    const clockIn = records.find((r) => r.type === AttendanceType.IN);
    const clockOut = records.find((r) => r.type === AttendanceType.OUT);

    let status = 'ABSENT';
    const totalHours =
      clockIn && clockOut
        ? ((clockOut.timestamp.getTime() - clockIn.timestamp.getTime()) / (1000 * 60 * 60)).toFixed(
            2,
          )
        : '0';

    if (isHoliday) {
      status = 'HOLIDAY';
    } else if (onLeave) {
      status = 'ON_LEAVE';
    } else if (clockIn && clockOut) {
      const graceEnd = new Date(clockIn.timestamp);
      graceEnd.setHours(9, 0, 0, 0);
      // Late: clock-in after grace window (09:00 + grace minutes)
      const lateThreshold = new Date();
      lateThreshold.setHours(9, env.ATTENDANCE_GRACE_MINUTES, 0, 0);
      const late = clockIn.timestamp.getTime() > lateThreshold.getTime();

      // Early departure: clock-out before end-of-business
      const [eobH, eobM] = env.ATTENDANCE_END_OF_BUSINESS.split(':').map(Number);
      const eob = new Date(date);
      eob.setHours(eobH ?? 0, eobM ?? 0, 0, 0);
      const earlyDeparture = clockOut.timestamp.getTime() < eob.getTime();

      if (late && earlyDeparture) status = 'LATE_EARLY_DEPARTURE';
      else if (late) status = 'LATE';
      else if (earlyDeparture) status = 'EARLY_DEPARTURE';
      else status = 'PRESENT';
    }

    summaries.push({
      employeeId: emp.id,
      employeeName: `${emp.first_name} ${emp.last_name}`.trim(),
      status,
      clockIn: clockIn?.timestamp ?? null,
      clockOut: clockOut?.timestamp ?? null,
      totalHours: Number(totalHours),
    });
  }
  return summaries;
}

// ── Leave Types ────────────────────────────────

export async function listLeaveTypes(): Promise<unknown[]> {
  return prisma.leaveType.findMany({ where: { deleted_at: null }, orderBy: { name: 'asc' } });
}

export async function createLeaveType(params: {
  name: string;
  accrualRate: number;
  carryForwardPolicy: string;
  maxConsecutiveDays?: number | undefined;
  approvalLevels: number;
  autoApproveSickDays: number;
}): Promise<unknown> {
  // Map camelCase API params to the snake_case Prisma column names.
  return prisma.leaveType.create({
    data: {
      name: params.name,
      accrual_rate: params.accrualRate,
      carry_forward_policy: params.carryForwardPolicy,
      max_consecutive_days: params.maxConsecutiveDays ?? null,
      approval_levels: params.approvalLevels,
      auto_approve_sick_days: params.autoApproveSickDays,
    },
  });
}

export async function updateLeaveType(
  id: string,
  params: Partial<{
    name: string | undefined;
    accrualRate: number | undefined;
    carryForwardPolicy: string | undefined;
    maxConsecutiveDays?: number | undefined;
    approvalLevels: number | undefined;
    autoApproveSickDays: number | undefined;
  }>,
): Promise<unknown> {
  return prisma.leaveType.update({
    where: { id },
    data: {
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.accrualRate !== undefined ? { accrual_rate: params.accrualRate } : {}),
      ...(params.carryForwardPolicy !== undefined
        ? { carry_forward_policy: params.carryForwardPolicy }
        : {}),
      ...(params.maxConsecutiveDays !== undefined
        ? { max_consecutive_days: params.maxConsecutiveDays ?? null }
        : {}),
      ...(params.approvalLevels !== undefined ? { approval_levels: params.approvalLevels } : {}),
      ...(params.autoApproveSickDays !== undefined
        ? { auto_approve_sick_days: params.autoApproveSickDays }
        : {}),
    },
  });
}

// ── Leave Policy Groups (replaces role-based templates) ──

/**
 * Round a day count to the nearest half day (0.5). Round-half-up is used so
 * that exact midpoint values (e.g. 3.25) resolve to the next half day (3.5),
 * which guarantees an employee is never short-changed by a fractional day.
 */
function roundToHalfDay(days: number): number {
  return Math.round(days * 2) / 2;
}

/** Number of whole calendar days in the given year. */
function daysInYear(year: number): number {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

/**
 * Derive the probation end date from the hire date plus the configured
 * probation duration (in months). Probation ends at midnight UTC of the day
 * one month-period after the hire date, so an employee is "still under
 * probation" on any day strictly before the computed end date.
 */
function computeProbationEnd(hireDate: Date, probationMonths: number): Date {
  const end = new Date(hireDate);
  end.setUTCMonth(end.getUTCMonth() + probationMonths);
  end.setUTCHours(0, 0, 0, 0);
  return end;
}

export interface ProbationBlock {
  /** True while the employee is under probation and has no leave entitlement. */
  underProbation: boolean;
  /** The employee's hire date (ISO). */
  hireDate: string;
  /** Configured probation duration in months. */
  probationMonths: number;
  /** The derived probation end date (ISO). */
  probationEndDate: string;
  /** Days remaining until probation ends (>= 0). */
  remainingDays: number;
}

/**
 * Determine whether an employee is still under probation and therefore
 * ineligible for a leave entitlement. An employee is under probation when their
 * employment status is NEW_HIRE or PROBATION AND the current date is before the
 * derived probation end date (hire date + configured probation months).
 */
function isUnderProbation(
  status: string | null | undefined,
  hireDate: Date | null | undefined,
  probationMonths: number,
  now: Date,
): ProbationBlock | null {
  if (!hireDate) return null;
  const isProbationaryStatus =
    status === EmploymentStatus.NEW_HIRE || status === EmploymentStatus.PROBATION;
  if (!isProbationaryStatus) return null;

  const probationEnd = computeProbationEnd(hireDate, probationMonths);
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endUtc = Date.UTC(
    probationEnd.getUTCFullYear(),
    probationEnd.getUTCMonth(),
    probationEnd.getUTCDate(),
  );
  // Still under probation only when the probation end date has not yet passed.
  if (nowUtc >= endUtc) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  const remainingDays = Math.max(0, Math.ceil((endUtc - nowUtc) / msPerDay));
  return {
    underProbation: true,
    hireDate: hireDate.toISOString().slice(0, 10),
    probationMonths,
    probationEndDate: probationEnd.toISOString().slice(0, 10),
    remainingDays,
  };
}

export interface ProrationDetail {
  fullEntitlement: number;
  proratedEntitlement: number;
  hireDate: string;
  remainingDays: number;
  totalDays: number;
  /** Remaining months in the year at the hire month (Dec inclusive), used for the breakdown label. */
  remainingMonths: number;
  fraction: number;
}

/**
 * Compute the pro-rata entitlement and the derivation metadata needed to
 * explain how the balance was calculated in the UI.
 *
 * Rules:
 *  - Hired on or before Jan 1 of the year → full entitlement, no proration.
 *  - Hired after Dec 31 of the year → 0 (not entitled that year).
 *  - Otherwise → day-precise pro-rata, rounded to the nearest 0.5 day.
 */
function computeProration(fullDays: number, hireDate: Date, year: number): ProrationDetail {
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31);
  const totalDays = daysInYear(year);
  // Normalise the hire date to UTC midnight so all day comparisons are
  // unaffected by the server's local timezone offset.
  const hireUtc = Date.UTC(
    hireDate.getUTCFullYear(),
    hireDate.getUTCMonth(),
    hireDate.getUTCDate(),
  );

  if (hireUtc <= yearStart) {
    return {
      fullEntitlement: fullDays,
      proratedEntitlement: fullDays,
      hireDate: hireDate.toISOString().slice(0, 10),
      remainingDays: totalDays,
      totalDays,
      remainingMonths: 12,
      fraction: 1,
    };
  }
  if (hireUtc > yearEnd) {
    return {
      fullEntitlement: fullDays,
      proratedEntitlement: 0,
      hireDate: hireDate.toISOString().slice(0, 10),
      remainingDays: 0,
      totalDays,
      remainingMonths: 0,
      fraction: 0,
    };
  }

  // Remaining days from the hire date (inclusive) through Dec 31 of the year.
  const msPerDay = 24 * 60 * 60 * 1000;
  const remainingDays = Math.round((yearEnd - hireUtc) / msPerDay) + 1;
  const fraction = remainingDays / totalDays;
  const remainingMonths = 12 - hireDate.getUTCMonth();
  const proratedEntitlement = roundToHalfDay(fullDays * fraction);

  return {
    fullEntitlement: fullDays,
    proratedEntitlement,
    hireDate: hireDate.toISOString().slice(0, 10),
    remainingDays,
    totalDays,
    remainingMonths,
    fraction,
  };
}

/** Find the best-matching policy group entitlement for an employee's attributes. */
async function findMatchingPolicyGroup(
  leaveTypeId: string,
  year: number,
  empInfo: {
    hire_date: Date | null;
    employment_type: string | null;
    department_id: string | null;
    position: { grade: string | null } | null;
    status: string | null;
  } | null,
): Promise<{
  annual_days: number;
  policy_group_name: string | null;
  proration: ProrationDetail | null;
  probation: ProbationBlock | null;
} | null> {
  if (!empInfo) return null;
  // Employees still under probation receive no leave entitlement for the year.
  const probation = isUnderProbation(
    empInfo.status,
    empInfo.hire_date,
    env.PROBATION_DEFAULT_MONTHS,
    new Date(),
  );
  if (probation) {
    return { annual_days: 0, policy_group_name: null, proration: null, probation };
  }
  const groups = await prisma.leavePolicyGroup.findMany({
    where: { year, deleted_at: null },
    include: {
      entitlements: {
        where: { leave_type_id: leaveTypeId, deleted_at: null },
        select: { annual_days: true },
      },
    },
  });
  const grade = empInfo.position?.grade ?? null;
  const matched = groups
    .filter((g) => {
      if (g.employment_type && g.employment_type !== empInfo.employment_type) return false;
      if (g.grades.length > 0 && (!grade || !g.grades.includes(grade))) return false;
      if (g.department_id && g.department_id !== empInfo.department_id) return false;
      return g.entitlements.length > 0;
    })
    .map((g) => {
      const fullDays = g.entitlements[0]?.annual_days ?? 0;
      let days = fullDays;
      // Apply proration for mid-year joiners if the policy group enables it.
      let proration: ProrationDetail | null = null;
      if (g.proration_enabled && empInfo.hire_date) {
        const detail = computeProration(fullDays, empInfo.hire_date, year);
        days = detail.proratedEntitlement;
        proration = detail.fraction < 1 ? detail : null;
      }
      return {
        name: g.name,
        annual_days: days,
        proration,
        criteriaCount: [
          g.employment_type != null,
          g.grades.length > 0,
          g.department_id != null,
        ].filter(Boolean).length,
      };
    })
    .sort((a, b) => b.criteriaCount - a.criteriaCount);
  if (matched.length === 0) return null;
  const best = matched[0];
  if (!best) return null;
  return {
    annual_days: best.annual_days,
    policy_group_name: best.name,
    proration: best.proration,
    probation: null,
  };
}

export async function listPolicyGroups(params: { year?: number | undefined }): Promise<unknown[]> {
  const where: Record<string, unknown> = { deleted_at: null };
  if (params.year) where.year = params.year;
  const groups = await prisma.leavePolicyGroup.findMany({
    where,
    include: {
      entitlements: {
        where: { deleted_at: null },
        include: { leave_type: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ year: 'desc' }, { name: 'asc' }],
  });
  // Attach matching headcount for each group
  const year = params.year ?? new Date().getFullYear();
  const result: Record<string, unknown>[] = [];
  for (const g of groups) {
    const headcount = await countMatchingEmployees(g, year);
    result.push({ ...g, headcount });
  }
  return result;
}

/** Build a Prisma where-clause for employees matching a policy group's criteria. */
function buildEligibilityWhere(group: {
  employment_type: string | null;
  grades: string[];
  department_id: string | null;
}): Record<string, unknown> {
  const where: Record<string, unknown> = {
    deleted_at: null,
    status: { not: 'TERMINATED' },
    // KEY: no user filter - all employees are eligible, not just those with system accounts
  };
  if (group.employment_type) where.employment_type = group.employment_type;
  if (group.department_id) where.department_id = group.department_id;
  if (group.grades.length > 0) where.position = { grade: { in: group.grades } };
  return where;
}

async function countMatchingEmployees(
  group: { employment_type: string | null; grades: string[]; department_id: string | null },
  _year: number,
): Promise<number> {
  const where = buildEligibilityWhere(group);
  // Exclude employees with manual overrides
  const overrides = await prisma.leavePolicyAssignment.findMany({
    where: { year: _year, is_manual: true, deleted_at: null },
    select: { employee_id: true },
  });
  const overrideIds = new Set(overrides.map((o) => o.employee_id));
  const employees = await prisma.employee.findMany({ where, select: { id: true } });
  return employees.filter((e) => !overrideIds.has(e.id)).length;
}

export async function createPolicyGroup(params: {
  name: string;
  description?: string | undefined;
  year: number;
  employment_type?: string | undefined;
  grades?: string[] | undefined;
  department_id?: string | undefined;
  proration_enabled?: boolean | undefined;
  entitlements: { leave_type_id: string; annual_days: number }[];
}): Promise<unknown> {
  // Note: policy groups are soft-deleted (deleted_at is set rather than the row
  // being removed), but the DB still enforces a unique (name, year) constraint.
  // We therefore check for ANY row — active or soft-deleted — so re-creating a
  // previously-deleted group name yields a clear 409 instead of a unique
  // constraint error that surfaces as a 500 "Internal server error".
  const existing = await prisma.leavePolicyGroup.findFirst({
    where: { name: params.name, year: params.year },
  });
  if (existing)
    throw new HttpError(409, 'A policy group with this name already exists for this year');

  return prisma.leavePolicyGroup.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      year: params.year,
      employment_type: (params.employment_type || null) as never,
      grades: (params.grades ?? []).filter(Boolean),
      department_id: params.department_id || null,
      proration_enabled: params.proration_enabled ?? true,
      entitlements: {
        create: params.entitlements.map((e) => ({
          leave_type_id: e.leave_type_id,
          annual_days: e.annual_days,
        })),
      },
    },
    include: { entitlements: { include: { leave_type: { select: { id: true, name: true } } } } },
  });
}

export async function updatePolicyGroup(
  id: string,
  params: {
    name?: string | undefined;
    description?: string | undefined;
    employment_type?: string | undefined;
    grades?: string[] | undefined;
    department_id?: string | undefined;
    proration_enabled?: boolean | undefined;
    entitlements?: { leave_type_id: string; annual_days: number }[] | undefined;
  },
): Promise<unknown> {
  const group = await prisma.leavePolicyGroup.findFirst({ where: { id, deleted_at: null } });
  if (!group) throw new HttpError(404, 'Policy group not found');

  // Prevent renaming to a name that is already taken (including soft-deleted
  // rows, which still hold the unique (name, year) constraint in the DB) —
  // otherwise the DB unique constraint error surfaces as a 500.
  if (params.name !== undefined && params.name !== group.name) {
    const clash = await prisma.leavePolicyGroup.findFirst({
      where: { name: params.name, year: group.year, id: { not: id } },
    });
    if (clash)
      throw new HttpError(409, 'A policy group with this name already exists for this year');
  }

  // Soft-delete old entitlements and create new ones if provided
  if (params.entitlements) {
    await prisma.leavePolicyGroupEntitlement.updateMany({
      where: { policy_group_id: id, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    for (const e of params.entitlements) {
      const existing = await prisma.leavePolicyGroupEntitlement.findFirst({
        where: { policy_group_id: id, leave_type_id: e.leave_type_id, deleted_at: { not: null } },
      });
      if (existing) {
        await prisma.leavePolicyGroupEntitlement.update({
          where: { id: existing.id },
          data: { annual_days: e.annual_days, deleted_at: null },
        });
      } else {
        await prisma.leavePolicyGroupEntitlement.create({
          data: { policy_group_id: id, leave_type_id: e.leave_type_id, annual_days: e.annual_days },
        });
      }
    }
  }

  const { entitlements: _entitlements, ...rest } = params;
  const data: Record<string, unknown> = {};
  if (rest.name !== undefined) data.name = rest.name;
  if (rest.description !== undefined) data.description = rest.description;
  if (rest.employment_type !== undefined)
    data.employment_type = (rest.employment_type || null) as never;
  if (rest.grades !== undefined) data.grades = rest.grades.filter(Boolean);
  if (rest.department_id !== undefined) data.department_id = rest.department_id || null;
  if (rest.proration_enabled !== undefined) data.proration_enabled = rest.proration_enabled;

  return prisma.leavePolicyGroup.update({
    where: { id },
    data,
    include: {
      entitlements: {
        where: { deleted_at: null },
        include: { leave_type: { select: { id: true, name: true } } },
      },
    },
  });
}

export async function deletePolicyGroup(id: string): Promise<unknown> {
  const group = await prisma.leavePolicyGroup.findFirst({ where: { id, deleted_at: null } });
  if (!group) throw new HttpError(404, 'Policy group not found');
  await prisma.leavePolicyGroupEntitlement.updateMany({
    where: { policy_group_id: id, deleted_at: null },
    data: { deleted_at: new Date() },
  });
  return prisma.leavePolicyGroup.update({ where: { id }, data: { deleted_at: new Date() } });
}

export async function listEmployeeAssignments(params: { year: number }): Promise<unknown[]> {
  const year = params.year;
  // Get all active employees with their entitlements and any manual assignments
  const employees = await prisma.employee.findMany({
    where: { deleted_at: null, status: { not: 'TERMINATED' } },
    select: {
      id: true,
      employee_no: true,
      first_name: true,
      last_name: true,
      employment_type: true,
      department: { select: { name: true } },
      position: { select: { name: true, grade: true } },
      hire_date: true,
      leave_entitlements: {
        where: { year, deleted_at: null },
        include: {
          leave_type: { select: { id: true, name: true } },
          policy_group: { select: { id: true, name: true } },
        },
      },
      leave_policy_assignments: {
        where: { year, deleted_at: null },
        include: { policy_group: { select: { id: true, name: true } } },
      },
    },
    orderBy: { first_name: 'asc' },
  });

  return employees.map((e) => ({
    employee_id: e.id,
    employee_no: e.employee_no,
    name: `${e.first_name} ${e.last_name}`.trim(),
    employment_type: e.employment_type,
    department: e.department?.name,
    position: e.position?.name,
    grade: e.position?.grade,
    hire_date: e.hire_date,
    manual_assignment: e.leave_policy_assignments[0]?.policy_group ?? null,
    entitlements: e.leave_entitlements.map((ent) => ({
      leave_type_id: ent.leave_type_id,
      leave_type_name: ent.leave_type.name,
      annual_entitlement: ent.annual_entitlement,
      source: ent.source,
      policy_group: ent.policy_group?.name ?? null,
    })),
  }));
}

export async function setEmployeeAssignment(params: {
  employeeId: string;
  policyGroupId: string;
  year: number;
  assignedBy: string;
  actorId: string;
  actorName: string;
}): Promise<unknown> {
  const group = await prisma.leavePolicyGroup.findFirst({
    where: { id: params.policyGroupId, deleted_at: null },
    include: { entitlements: { where: { deleted_at: null } } },
  });
  if (!group) throw new HttpError(404, 'Policy group not found');

  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, deleted_at: null },
    select: { id: true, hire_date: true, status: true },
  });
  if (!employee) throw new HttpError(404, 'Employee not found');

  // Employees still under probation receive zero entitlement until probation ends.
  const probation = isUnderProbation(
    employee.status ?? null,
    employee.hire_date ?? null,
    env.PROBATION_DEFAULT_MONTHS,
    new Date(),
  );

  // Upsert the manual assignment
  const existing = await prisma.leavePolicyAssignment.findFirst({
    where: { employee_id: params.employeeId, year: params.year, deleted_at: null },
  });
  if (existing) {
    await prisma.leavePolicyAssignment.update({
      where: { id: existing.id },
      data: { policy_group_id: params.policyGroupId, assigned_by: params.assignedBy },
    });
  } else {
    await prisma.leavePolicyAssignment.create({
      data: {
        employee_id: params.employeeId,
        policy_group_id: params.policyGroupId,
        year: params.year,
        assigned_by: params.assignedBy,
        is_manual: true,
      },
    });
  }

  // Immediately provision entitlements from the assigned group
  const prorations: ProrationDetail[] = [];
  for (const ent of group.entitlements) {
    let annualDays = ent.annual_days;
    let proration: ProrationDetail | null = null;
    if (probation) {
      // No leave entitlement while under probation.
      annualDays = 0;
    } else if (group.proration_enabled && employee.hire_date) {
      const detail = computeProration(ent.annual_days, employee.hire_date, params.year);
      annualDays = detail.proratedEntitlement;
      proration = detail.fraction < 1 ? detail : null;
    }
    if (proration) prorations.push(proration);

    const existingEnt = await prisma.leaveEntitlement.findUnique({
      where: {
        employee_id_leave_type_id_year: {
          employee_id: params.employeeId,
          leave_type_id: ent.leave_type_id,
          year: params.year,
        },
      },
    });
    if (existingEnt) {
      await prisma.leaveEntitlement.update({
        where: { id: existingEnt.id },
        data: { annual_entitlement: annualDays, source: 'OVERRIDE', policy_group_id: group.id },
      });
    } else {
      await prisma.leaveEntitlement.create({
        data: {
          employee_id: params.employeeId,
          leave_type_id: ent.leave_type_id,
          year: params.year,
          annual_entitlement: annualDays,
          source: 'OVERRIDE',
          policy_group_id: group.id,
        },
      });
    }
  }

  return {
    assigned: true,
    employeeId: params.employeeId,
    policyGroupId: params.policyGroupId,
    year: params.year,
    prorated: prorations.length > 0,
    proration: prorations[0] ?? null,
    probation,
  };
}

// ── Holidays ───────────────────────────────────

export async function listHolidays(params: { year?: number | undefined }): Promise<unknown[]> {
  const where: Record<string, unknown> = { deleted_at: null };
  if (params.year) where.year = params.year;
  return prisma.holiday.findMany({
    where,
    orderBy: { date: 'asc' },
  });
}

export async function upsertHoliday(params: {
  name: string;
  date: Date | string;
  year: number;
  type: string;
  recurring: boolean;
}): Promise<unknown> {
  const date = typeof params.date === 'string' ? new Date(params.date) : params.date;
  const existing = await prisma.holiday.findFirst({
    where: { name: params.name, date, deleted_at: null },
  });
  const data = {
    name: params.name,
    date,
    year: params.year,
    type: params.type,
    recurring: params.recurring,
  };
  if (existing) {
    return prisma.holiday.update({ where: { id: existing.id }, data });
  }
  return prisma.holiday.create({ data });
}

export async function deleteHoliday(id: string): Promise<unknown> {
  const existing = await prisma.holiday.findFirst({ where: { id, deleted_at: null } });
  if (!existing) throw new HttpError(404, 'Holiday not found');
  return prisma.holiday.update({ where: { id }, data: { deleted_at: new Date() } });
}

// ── Leave Requests & Approval ──────────────────

export async function submitLeaveRequest(params: {
  employeeId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  reason?: string | undefined;
  attachmentPath?: string | undefined;
  submittedBy: string;
  actorId: string;
  actorName: string;
}): Promise<unknown> {
  if (params.startDate.getTime() > params.endDate.getTime()) {
    throw new HttpError(400, 'Start date must be before end date');
  }

  const leaveType = await prisma.leaveType.findFirst({
    where: { id: params.leaveTypeId, deleted_at: null },
  });
  if (!leaveType) throw new HttpError(404, 'Leave type not found');

  const days =
    Math.ceil((params.endDate.getTime() - params.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Overlap with existing approved leave
  const overlap = await prisma.leaveRequest.findFirst({
    where: {
      employee_id: params.employeeId,
      status: LeaveRequestStatus.APPROVED,
      start_date: { lte: params.endDate },
      end_date: { gte: params.startDate },
      deleted_at: null,
    },
  });

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    const request = await tx.leaveRequest.create({
      data: {
        employee_id: params.employeeId,
        leave_type_id: params.leaveTypeId,
        start_date: params.startDate,
        end_date: params.endDate,
        days,
        reason: params.reason ?? null,
        attachment_path: params.attachmentPath ?? null,
        status: LeaveRequestStatus.PENDING_MANAGER_APPROVAL,
        submitted_by: params.submittedBy,
      },
    });
    return { request, overlapWarning: overlap ? { overlapId: overlap.id } : null };
  });
}

export async function approveLeaveRequest(params: {
  leaveRequestId: string;
  approverId: string;
  approverRole: string;
  comment?: string | undefined;
}): Promise<unknown> {
  const request = await prisma.leaveRequest.findFirst({
    where: { id: params.leaveRequestId, deleted_at: null },
    include: { leave_type: true, employee: true },
  });
  if (!request) throw new HttpError(404, 'Leave request not found');

  const leaveType = request.leave_type;

  // Level 1 approval (Manager) — verify manager of direct report
  if (request.status === LeaveRequestStatus.PENDING_MANAGER_APPROVAL) {
    // Urgent sick leave auto-approve (1-2 days)
    const autoApprove = leaveType.auto_approve_sick_days >= request.days && request.days <= 2;
    const canApprove =
      params.approverRole === 'ADMIN' || params.approverRole === 'HR_MANAGER'
        ? true
        : await isManagerOf(params.approverId, request.employee_id);

    if (!canApprove && !autoApprove) {
      throw new HttpError(403, 'Only the employee manager can approve this request');
    }

    const approvalData = {
      leave_request_id: request.id,
      approver_id: params.approverId,
      level: 1,
      action: ApprovalAction.APPROVE,
      comment: params.comment ?? null,
    };

    if (autoApprove) {
      return withAuditContext(prisma, params.approverId, '', async (tx) => {
        await tx.leaveApproval.create({
          data: { ...approvalData, comment: params.comment ?? 'Auto-approved (urgent sick leave)' },
        });
        const updated = await tx.leaveRequest.update({
          where: { id: request.id },
          data: {
            status:
              leaveType.approval_levels >= 2
                ? LeaveRequestStatus.PENDING_HR_APPROVAL
                : LeaveRequestStatus.APPROVED,
          },
        });
        // If no HR level, deduct balance immediately
        if (leaveType.approval_levels < 2) {
          await deductBalance(
            tx as never,
            request.employee_id,
            request.leave_type_id,
            request.days,
          );
          await sendLeaveStatusEmail(
            request.employee.email,
            `${request.employee.first_name} ${request.employee.last_name}`,
            'Approved',
            leaveType.name,
          );
        }
        return updated;
      });
    }

    return withAuditContext(prisma, params.approverId, '', async (tx) => {
      await tx.leaveApproval.create({ data: approvalData });
      const updated = await tx.leaveRequest.update({
        where: { id: request.id },
        data: {
          status:
            leaveType.approval_levels >= 2
              ? LeaveRequestStatus.PENDING_HR_APPROVAL
              : LeaveRequestStatus.APPROVED,
        },
      });
      if (leaveType.approval_levels < 2) {
        await deductBalance(tx as never, request.employee_id, request.leave_type_id, request.days);
        await sendLeaveStatusEmail(
          request.employee.email,
          `${request.employee.first_name} ${request.employee.last_name}`,
          'Approved',
          leaveType.name,
        );
      }
      return updated;
    });
  }

  // Level 2 final approval (HR)
  if (request.status === LeaveRequestStatus.PENDING_HR_APPROVAL) {
    if (params.approverRole !== 'ADMIN' && params.approverRole !== 'HR_MANAGER') {
      throw new HttpError(403, 'Only HR can give final approval');
    }

    return withAuditContext(prisma, params.approverId, '', async (tx) => {
      await tx.leaveApproval.create({
        data: {
          leave_request_id: request.id,
          approver_id: params.approverId,
          level: 2,
          action: ApprovalAction.APPROVE,
          comment: params.comment ?? null,
        },
      });
      const updated = await tx.leaveRequest.update({
        where: { id: request.id },
        data: { status: LeaveRequestStatus.APPROVED },
      });
      // Deduct balance atomically; block if negative
      await deductBalance(tx as never, request.employee_id, request.leave_type_id, request.days);
      await sendLeaveStatusEmail(
        request.employee.email,
        `${request.employee.first_name} ${request.employee.last_name}`,
        'Approved',
        leaveType.name,
      );
      return updated;
    });
  }

  throw new HttpError(400, `Cannot approve a request in status ${request.status}`);
}

export async function rejectLeaveRequest(params: {
  leaveRequestId: string;
  approverId: string;
  approverRole: string;
  comment?: string | undefined;
}): Promise<unknown> {
  const request = await prisma.leaveRequest.findFirst({
    where: { id: params.leaveRequestId, deleted_at: null },
    include: { leave_type: true, employee: true },
  });
  if (!request) throw new HttpError(404, 'Leave request not found');

  if (request.status === LeaveRequestStatus.PENDING_MANAGER_APPROVAL) {
    if (params.approverRole !== 'ADMIN' && params.approverRole !== 'HR_MANAGER') {
      const manager = await isManagerOf(params.approverId, request.employee_id);
      if (!manager) throw new HttpError(403, 'Only the employee manager can reject this request');
    }
  } else if (request.status === LeaveRequestStatus.PENDING_HR_APPROVAL) {
    if (params.approverRole !== 'ADMIN' && params.approverRole !== 'HR_MANAGER') {
      throw new HttpError(403, 'Only HR can reject a pending HR approval');
    }
  } else {
    throw new HttpError(400, `Cannot reject a request in status ${request.status}`);
  }

  const updated = await prisma.leaveRequest.update({
    where: { id: request.id },
    data: { status: LeaveRequestStatus.REJECTED },
  });
  await sendLeaveStatusEmail(
    request.employee.email,
    `${request.employee.first_name} ${request.employee.last_name}`,
    'Rejected',
    request.leave_type.name,
  );
  return updated;
}

export async function listLeaveRequests(params: {
  employeeId?: string | undefined;
  status?: string | undefined;
  role: string;
  userId: string;
}): Promise<unknown[]> {
  const where: Record<string, unknown> = { deleted_at: null };

  if (params.role === 'EMPLOYEE') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { id: true },
    });
    if (!self) return [];
    where.employee_id = self.id;
  } else if (params.role === 'MANAGER') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { id: true },
    });
    if (!self) return [];
    const directReports = await prisma.employee.findMany({
      where: { manager_id: self.id },
      select: { id: true },
    });
    where.employee_id = { in: [...directReports.map((e) => e.id), self.id] };
  } else if (params.employeeId) {
    where.employee_id = params.employeeId;
  }

  if (params.status) where.status = params.status;

  return prisma.leaveRequest.findMany({
    where,
    include: {
      employee: { select: { id: true, first_name: true, last_name: true, email: true } },
      leave_type: { select: { id: true, name: true } },
      approvals: true,
    },
    orderBy: { submitted_at: 'desc' },
  });
}

// ── Leave Balance ──────────────────────────────

export async function getLeaveBalance(params: {
  employeeId?: string | undefined;
  role: string;
  userId: string;
}): Promise<unknown[]> {
  let employeeIds: string[];

  if (params.role === 'EMPLOYEE') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { id: true },
    });
    if (!self) return [];
    employeeIds = [self.id];
  } else if (params.role === 'MANAGER') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { id: true },
    });
    if (!self) return [];
    const reports = await prisma.employee.findMany({
      where: { manager_id: self.id },
      select: { id: true },
    });
    employeeIds = [...reports.map((e) => e.id), self.id];
  } else if (params.employeeId) {
    employeeIds = [params.employeeId];
  } else {
    const all = await prisma.employee.findMany({
      where: { deleted_at: null },
      select: { id: true },
    });
    employeeIds = all.map((e) => e.id);
  }

  const leaveTypes = await prisma.leaveType.findMany({ where: { deleted_at: null } });
  const year = new Date().getFullYear();

  const result: Record<string, unknown>[] = [];
  for (const empId of employeeIds) {
    // Resolve the employee's attributes for policy-group-based fallback.
    const empInfo = await prisma.employee.findUnique({
      where: { id: empId },
      select: {
        hire_date: true,
        employment_type: true,
        department_id: true,
        status: true,
        position: { select: { grade: true } },
      },
    });

    // Employees still under probation receive no leave entitlement for the year.
    const probation = isUnderProbation(
      empInfo?.status ?? null,
      empInfo?.hire_date ?? null,
      env.PROBATION_DEFAULT_MONTHS,
      new Date(),
    );

    const balances: Record<string, unknown>[] = [];
    for (const lt of leaveTypes) {
      // 1) Per-employee entitlement (materialised when HR applies a policy group).
      //    Skip MIGRATED records - they contain stale role-based values and should
      //    be replaced by the policy-group-based fallback below.
      const entitlement = await prisma.leaveEntitlement.findFirst({
        where: { employee_id: empId, leave_type_id: lt.id, year, deleted_at: null },
        include: {
          policy_group: {
            select: {
              id: true,
              name: true,
              entitlements: {
                where: { leave_type_id: lt.id, deleted_at: null },
                select: { annual_days: true },
              },
            },
          },
        },
      });
      let policyDays: number | null = null;
      let source = null as string | null;
      let policyGroupName = null as string | null;
      let proration: ProrationDetail | null = null;

      // Employees under probation receive zero entitlement regardless of any
      // materialised records or matching policy groups.
      if (probation) {
        const used = await prisma.leaveRequest.aggregate({
          where: {
            employee_id: empId,
            leave_type_id: lt.id,
            status: LeaveRequestStatus.APPROVED,
            deleted_at: null,
          },
          _sum: { days: true },
        });
        balances.push({
          leaveTypeId: lt.id,
          name: lt.name,
          entitlement: 0,
          accrued: 0,
          used: used._sum.days ?? 0,
          available: 0,
          pending: 0,
          carryForward: 0,
          source: null,
          policyGroupName: null,
          prorated: false,
          proration: null,
          probation,
        });
        continue;
      }

      if (entitlement && entitlement.source !== 'MIGRATED') {
        // Use the provisioned entitlement (POLICY or OVERRIDE).
        policyDays = entitlement.annual_entitlement;
        source = entitlement.source;
        policyGroupName = entitlement.policy_group?.name ?? null;
        // The materialised entitlement may itself be a prorated value (provisioned
        // by setEmployeeAssignment). Derive the pro-rata breakdown from the policy
        // group's base entitlement (the true full value) so we don't double-prorate
        // the already-prorated stored figure.
        if (empInfo?.hire_date) {
          const baseFull =
            entitlement.policy_group?.entitlements?.[0]?.annual_days ??
            entitlement.annual_entitlement;
          const detail = computeProration(baseFull, empInfo.hire_date, year);
          proration = detail.fraction < 1 ? detail : null;
        }
      }

      // 2) Fallback: find a matching policy group by employee attributes (not role).
      //    This runs when there is no entitlement, when the entitlement is MIGRATED,
      //    or when the entitlement has no linked policy group (e.g. default seed data
      //    that hardcodes an entitlement without attaching the source policy group).
      //    The policy group is the single source of truth for the latest policies,
      //    so when the materialised entitlement is not tied to a policy group we
      //    let the match override BOTH the day count and the displayed group name.
      if (policyDays == null || policyGroupName == null) {
        const match = await findMatchingPolicyGroup(lt.id, year, empInfo);
        if (match) {
          if (policyDays == null || source === 'POLICY') {
            policyDays = match.annual_days;
            source = 'POLICY';
            proration = match.proration;
          }
          policyGroupName = match.policy_group_name;
        }
      }
      const entitlementDays = policyDays ?? 0;

      const used = await prisma.leaveRequest.aggregate({
        where: {
          employee_id: empId,
          leave_type_id: lt.id,
          status: LeaveRequestStatus.APPROVED,
          deleted_at: null,
        },
        _sum: { days: true },
      });
      const pending = await prisma.leaveRequest.aggregate({
        where: {
          employee_id: empId,
          leave_type_id: lt.id,
          status: {
            in: [
              LeaveRequestStatus.PENDING_MANAGER_APPROVAL,
              LeaveRequestStatus.PENDING_HR_APPROVAL,
            ],
          },
          deleted_at: null,
        },
        _sum: { days: true },
      });
      // Carry-forward / accrued days are intentionally ignored: annual leave is
      // not carried over into the next year, so they never add to the balance.
      // Available reflects the entitlement minus used and pending days. Pending
      // leave requests are committed but not-yet-approved, so they reduce the
      // truly available balance.
      const available = entitlementDays - (used._sum.days ?? 0) - (pending._sum.days ?? 0);
      balances.push({
        leaveTypeId: lt.id,
        name: lt.name,
        entitlement: entitlementDays,
        accrued: 0,
        used: used._sum.days ?? 0,
        available: Math.max(available, 0),
        pending: pending._sum.days ?? 0,
        carryForward: 0,
        source,
        policyGroupName,
        prorated: proration != null,
        proration,
        probation: null,
      });
    }
    result.push({ employeeId: empId, balances });
  }
  return result;
}

// ── Helpers ────────────────────────────────────

async function isManagerOf(approverUserId: string, employeeId: string): Promise<boolean> {
  const manager = await prisma.employee.findUnique({
    where: { user_id: approverUserId },
    select: { id: true },
  });
  if (!manager) return false;
  const target = await prisma.employee.findFirst({ where: { id: employeeId } });
  return target?.manager_id === manager.id;
}

async function deductBalance(
  tx: {
    leaveBalance: {
      findFirst: (a: unknown) => Promise<{ id: string } | null>;
      update: (a: unknown) => Promise<unknown>;
      create: (a: unknown) => Promise<unknown>;
    };
  },
  employeeId: string,
  leaveTypeId: string,
  days: number,
): Promise<void> {
  const year = new Date().getFullYear();
  const balance = await tx.leaveBalance.findFirst({
    where: { employee_id: employeeId, leave_type_id: leaveTypeId, year },
  });
  // Negative-balance prevention
  const available = (await getAvailableDays(employeeId, leaveTypeId)) - days;
  if (available < 0) {
    throw new HttpError(400, 'Insufficient leave balance');
  }
  if (balance) {
    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: { used_days: { increment: days } },
    });
  } else {
    await tx.leaveBalance.create({
      data: { employee_id: employeeId, leave_type_id: leaveTypeId, year, used_days: days },
    });
  }
}

async function getAvailableDays(employeeId: string, leaveTypeId: string): Promise<number> {
  const year = new Date().getFullYear();
  const entitlement = await prisma.leaveEntitlement.findFirst({
    where: { employee_id: employeeId, leave_type_id: leaveTypeId, year },
  });
  const used = await prisma.leaveRequest.aggregate({
    where: {
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
      status: LeaveRequestStatus.APPROVED,
      deleted_at: null,
    },
    _sum: { days: true },
  });
  return (entitlement?.annual_entitlement ?? 0) - (used._sum.days ?? 0);
}

// ── Cron: Leave accrual ────────────────────────

export async function runLeaveAccrual(): Promise<void> {
  logger.info('Running leave accrual...');
  const year = new Date().getFullYear();

  const leaveTypes = await prisma.leaveType.findMany({
    where: { deleted_at: null, accrual_rate: { gt: 0 } },
  });
  const employees = await prisma.employee.findMany({
    where: { deleted_at: null },
    select: { id: true },
  });

  let updated = 0;
  for (const lt of leaveTypes) {
    for (const emp of employees) {
      const existing = await prisma.leaveBalance.findFirst({
        where: { employee_id: emp.id, leave_type_id: lt.id, year },
      });
      // Idempotent: only accrue if balance exists or create with one accrual step.
      // The accrual_rate is treated as the amount per accrual run.
      if (existing) {
        await prisma.leaveBalance.update({
          where: { id: existing.id },
          data: { accrued_days: { increment: lt.accrual_rate } },
        });
      } else {
        await prisma.leaveBalance.create({
          data: { employee_id: emp.id, leave_type_id: lt.id, year, accrued_days: lt.accrual_rate },
        });
      }
      updated++;
    }
  }
  logger.info(`Leave accrual complete: ${updated} balances updated.`);
}
