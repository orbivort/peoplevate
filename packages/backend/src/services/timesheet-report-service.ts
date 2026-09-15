import { prisma } from '../config/prisma.js';
import { logAuditEvent } from './audit-service.js';
import { HttpError } from '../utils/http-error.js';
import { AuditAction, AuditEntity, TimesheetStatus } from '#prisma';
import type { RequestingUser, TimesheetEntryDto } from './timesheet-service.js';

const DAY_MS = 86_400_000;

export type ReportGroupBy = 'employee' | 'project' | 'department';

export interface TimesheetReportFilters {
  requestingUser: RequestingUser;
  groupBy?: ReportGroupBy | undefined;
  from: Date;
  to: Date;
  employeeId?: string | undefined;
  departmentId?: string | undefined;
  projectId?: string | undefined;
  includeAllStatuses?: boolean | undefined;
}

export interface SummaryRowEmployee {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string | null;
  totalHours: number;
  billableHours: number;
  entryCount: number;
}

export interface SummaryRowProject {
  projectId: string;
  projectCode: string;
  projectName: string;
  client: string | null;
  isBillable: boolean;
  totalHours: number;
  entryCount: number;
}

export interface SummaryRowDepartment {
  departmentId: string | null;
  departmentName: string | null;
  employeeCount: number;
  totalHours: number;
  entryCount: number;
}

/**
 * Detail-report row: the standard `TimesheetEntryDto` (nested `project` / `task`
 * refs) enriched with the owning employee and the owning timesheet's status, as
 * required by the contract's report DTOs.
 */
export interface ReportDetailEntryDto extends TimesheetEntryDto {
  employeeNo: string;
  employeeName: string;
  timesheetStatus: string;
}

type DecimalLike = number | string | { toNumber(): number };

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

function normalizeDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Build the entry where-clause shared by summary/details/export: date range,
 * optional filters, the approved-only default, and role scoping (MANAGER →
 * direct reports only; EMPLOYEE → own entries; HR_MANAGER/ADMIN → all).
 */
async function buildEntryWhere(filters: TimesheetReportFilters): Promise<Record<string, unknown>> {
  const from = normalizeDateOnly(filters.from);
  const to = new Date(normalizeDateOnly(filters.to).getTime() + DAY_MS - 1);
  if (from.getTime() > to.getTime()) {
    throw new HttpError(400, 'from must be before to');
  }

  const where: Record<string, unknown> = {
    deleted_at: null,
    entry_date: { gte: from, lte: to },
  };
  // Default: only APPROVED timesheets' entries count towards reports.
  if (!filters.includeAllStatuses) {
    where.timesheet = { status: TimesheetStatus.APPROVED, deleted_at: null };
  }
  if (filters.projectId) where.project_id = filters.projectId;
  if (filters.departmentId) where.employee = { department_id: filters.departmentId };

  // Role scoping resolved to an allow-list of employee ids (null = unrestricted).
  let allowedEmployeeIds: string[] | null = null;
  if (filters.requestingUser.role === 'MANAGER') {
    const managerId =
      filters.requestingUser.employeeId ??
      (
        await prisma.employee.findUnique({
          where: { user_id: filters.requestingUser.userId },
          select: { id: true },
        })
      )?.id;
    if (!managerId) {
      allowedEmployeeIds = [];
    } else {
      const reports = await prisma.employee.findMany({
        where: { manager_id: managerId, deleted_at: null },
        select: { id: true },
      });
      allowedEmployeeIds = reports.map((r) => r.id);
    }
  } else if (
    filters.requestingUser.role !== 'HR_MANAGER' &&
    filters.requestingUser.role !== 'ADMIN'
  ) {
    // EMPLOYEE (and any unknown role): own entries only.
    const ownId =
      filters.requestingUser.employeeId ??
      (
        await prisma.employee.findUnique({
          where: { user_id: filters.requestingUser.userId },
          select: { id: true },
        })
      )?.id;
    allowedEmployeeIds = ownId ? [ownId] : [];
  }

  if (allowedEmployeeIds !== null) {
    if (filters.employeeId) {
      where.employee_id = allowedEmployeeIds.includes(filters.employeeId)
        ? filters.employeeId
        : { in: [] };
    } else {
      where.employee_id = { in: allowedEmployeeIds };
    }
  } else if (filters.employeeId) {
    where.employee_id = filters.employeeId;
  }

  return where;
}

// ── Summary report ──────────────────────────────

export async function getSummaryReport(filters: TimesheetReportFilters): Promise<{
  rows: SummaryRowEmployee[] | SummaryRowProject[] | SummaryRowDepartment[];
  groupBy: ReportGroupBy;
  from: string;
  to: string;
  includeAllStatuses: boolean;
}> {
  const where = await buildEntryWhere(filters);
  const groupBy = filters.groupBy ?? 'employee';

  if (groupBy === 'project') {
    const grouped = await prisma.timesheetEntry.groupBy({
      by: ['project_id'],
      where: where as never,
      _sum: { hours: true },
      _count: true,
    });
    const projects =
      grouped.length > 0
        ? await prisma.project.findMany({
            where: { id: { in: grouped.map((g) => g.project_id) } },
            select: { id: true, code: true, name: true, client: true, is_billable: true },
          })
        : [];
    const byId = new Map(projects.map((p) => [p.id, p]));
    const rows: SummaryRowProject[] = grouped
      .map((g): SummaryRowProject | null => {
        const project = byId.get(g.project_id);
        if (!project) return null;
        return {
          projectId: project.id,
          projectCode: project.code,
          projectName: project.name,
          client: project.client,
          isBillable: project.is_billable,
          totalHours: round2(toHours(g._sum.hours as DecimalLike | null | undefined)),
          entryCount: g._count,
        };
      })
      .filter((row): row is SummaryRowProject => row !== null)
      .sort((a, b) => a.projectCode.localeCompare(b.projectCode));
    return {
      rows,
      groupBy,
      from: dateKey(filters.from),
      to: dateKey(filters.to),
      includeAllStatuses: filters.includeAllStatuses === true,
    };
  }

  // groupBy employee / department both aggregate per employee first.
  const grouped = await prisma.timesheetEntry.groupBy({
    by: ['employee_id'],
    where: where as never,
    _sum: { hours: true },
    _count: true,
  });

  const employees =
    grouped.length > 0
      ? await prisma.employee.findMany({
          where: { id: { in: grouped.map((g) => g.employee_id) } },
          select: {
            id: true,
            employee_no: true,
            first_name: true,
            last_name: true,
            department: { select: { id: true, name: true } },
          },
        })
      : [];
  const byId = new Map(employees.map((e) => [e.id, e]));

  if (groupBy === 'employee') {
    // Billable hours come from a second aggregation filtered to billable projects.
    const billable = await prisma.timesheetEntry.groupBy({
      by: ['employee_id'],
      where: { ...where, project: { is_billable: true } } as never,
      _sum: { hours: true },
    });
    const billableByEmployee = new Map(billable.map((b) => [b.employee_id, b._sum.hours]));

    const rows: SummaryRowEmployee[] = grouped
      .map((g): SummaryRowEmployee | null => {
        const employee = byId.get(g.employee_id);
        if (!employee) return null;
        return {
          employeeId: employee.id,
          employeeNo: employee.employee_no,
          employeeName: `${employee.first_name} ${employee.last_name}`.trim(),
          departmentId: employee.department?.id ?? null,
          departmentName: employee.department?.name ?? null,
          totalHours: round2(toHours(g._sum.hours as DecimalLike | null | undefined)),
          billableHours: round2(
            toHours(billableByEmployee.get(g.employee_id) as DecimalLike | null | undefined),
          ),
          entryCount: g._count,
        };
      })
      .filter((row): row is SummaryRowEmployee => row !== null)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    return {
      rows,
      groupBy,
      from: dateKey(filters.from),
      to: dateKey(filters.to),
      includeAllStatuses: filters.includeAllStatuses === true,
    };
  }

  // groupBy department — employees are grouped by department in memory from the
  // per-employee aggregation (bounded by the number of employees with entries).
  const departments = new Map<
    string | null,
    {
      departmentId: string | null;
      departmentName: string | null;
      employeeIds: Set<string>;
      totalHours: number;
      entryCount: number;
    }
  >();
  for (const g of grouped) {
    const employee = byId.get(g.employee_id);
    const key = employee?.department?.id ?? null;
    const bucket = departments.get(key) ?? {
      departmentId: key,
      departmentName: employee?.department?.name ?? null,
      employeeIds: new Set<string>(),
      totalHours: 0,
      entryCount: 0,
    };
    bucket.employeeIds.add(g.employee_id);
    bucket.totalHours = round2(
      bucket.totalHours + toHours(g._sum.hours as DecimalLike | null | undefined),
    );
    bucket.entryCount += g._count;
    departments.set(key, bucket);
  }
  const rows: SummaryRowDepartment[] = [...departments.values()]
    .map((d) => ({
      departmentId: d.departmentId,
      departmentName: d.departmentName,
      employeeCount: d.employeeIds.size,
      totalHours: d.totalHours,
      entryCount: d.entryCount,
    }))
    // Named departments alphabetically; employees without one last.
    .sort((a, b) => {
      if (!a.departmentName || !b.departmentName) {
        if (!a.departmentName && !b.departmentName) return 0;
        return a.departmentName ? -1 : 1;
      }
      return a.departmentName.localeCompare(b.departmentName);
    });
  return {
    rows,
    groupBy,
    from: dateKey(filters.from),
    to: dateKey(filters.to),
    includeAllStatuses: filters.includeAllStatuses === true,
  };
}

// ── Details report ──────────────────────────────

/** Raw (snake_case) entry row shape returned by the detail/export queries. */
interface RawDetailEntry {
  id: string;
  timesheet_id: string;
  employee_id: string;
  entry_date: Date;
  project_id: string;
  task_id: string | null;
  hours: DecimalLike;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  employee: { employee_no: string; first_name: string; last_name: string };
  project: { id: string; code: string; name: string; is_billable: boolean };
  task: { id: string; name: string } | null;
  timesheet: { status: string };
}

function mapDetailRow(entry: RawDetailEntry): ReportDetailEntryDto {
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
    employeeNo: entry.employee.employee_no,
    employeeName: `${entry.employee.first_name} ${entry.employee.last_name}`.trim(),
    timesheetStatus: entry.timesheet.status,
  };
}

const DETAIL_INCLUDE = {
  employee: { select: { employee_no: true, first_name: true, last_name: true } },
  project: { select: { id: true, code: true, name: true, is_billable: true } },
  task: { select: { id: true, name: true } },
  timesheet: { select: { status: true } },
};

export async function getDetailsReport(
  filters: TimesheetReportFilters & {
    page?: number | undefined;
    pageSize?: number | undefined;
  },
): Promise<{ entries: ReportDetailEntryDto[]; total: number; page: number; pageSize: number }> {
  const where = await buildEntryWhere(filters);
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 50;

  const [total, entries] = await Promise.all([
    prisma.timesheetEntry.count({ where: where as never }),
    prisma.timesheetEntry.findMany({
      where: where as never,
      orderBy: [{ entry_date: 'asc' }, { employee_id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: DETAIL_INCLUDE,
    }),
  ]);

  return { entries: entries.map(mapDetailRow), total, page, pageSize };
}

// ── CSV export ──────────────────────────────────

/**
 * Escape a CSV field: quote when it contains commas, quotes, or newlines, and
 * neutralize spreadsheet formula injection (CWE-1236) — user-controlled text
 * beginning with `=`, `+`, `-`, `@`, or a tab would otherwise be interpreted
 * as a formula when the export is opened in Excel/Sheets. Standard mitigation:
 * prefix the cell with a single quote.
 */
function escapeCsvField(value: string): string {
  const safe = /^[=+\-@\t]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export async function exportReportCsv(filters: TimesheetReportFilters): Promise<string> {
  const where = await buildEntryWhere(filters);

  const entries = await prisma.timesheetEntry.findMany({
    where: where as never,
    orderBy: [{ entry_date: 'asc' }, { employee_id: 'asc' }],
    include: DETAIL_INCLUDE,
  });

  // Every export is audit-logged (EXPORT / TIMESHEET) with its filter summary.
  await logAuditEvent({
    actorId: filters.requestingUser.userId,
    actorName: filters.requestingUser.userName ?? null,
    action: AuditAction.EXPORT,
    entity: AuditEntity.TIMESHEET,
    newValue: {
      from: dateKey(filters.from),
      to: dateKey(filters.to),
      groupBy: filters.groupBy ?? 'employee',
      employeeId: filters.employeeId ?? null,
      departmentId: filters.departmentId ?? null,
      projectId: filters.projectId ?? null,
      includeAllStatuses: filters.includeAllStatuses === true,
      rowCount: entries.length,
    },
  });

  const header =
    'employee_no,employee_name,date,project_code,project_name,task_name,hours,description,timesheet_status';
  const lines = entries.map((e) => {
    const row = mapDetailRow(e);
    return [
      row.employeeNo,
      row.employeeName,
      row.entryDate,
      row.project.code,
      row.project.name,
      row.task?.name ?? '',
      String(row.hours),
      row.description ?? '',
      row.timesheetStatus,
    ]
      .map(escapeCsvField)
      .join(',');
  });
  return lines.length > 0 ? `${header}\n${lines.join('\n')}\n` : `${header}\n`;
}
