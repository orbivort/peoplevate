import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimesheetStatus } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    timesheetEntry: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    project: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('./audit-service.js', () => ({
  logAuditEvent: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import { logAuditEvent } from './audit-service.js';
import { exportReportCsv, getDetailsReport, getSummaryReport } from './timesheet-report-service.js';

const mocked = {
  entryGroupBy: vi.mocked(prisma.timesheetEntry.groupBy),
  entryFindMany: vi.mocked(prisma.timesheetEntry.findMany),
  entryCount: vi.mocked(prisma.timesheetEntry.count),
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  employeeFindMany: vi.mocked(prisma.employee.findMany),
  projectFindMany: vi.mocked(prisma.project.findMany),
  logAuditEvent: vi.mocked(logAuditEvent),
};

const HR_USER = { userId: 'user-hr', role: 'HR_MANAGER', userName: 'HR Manager' };

function filters(overrides: Record<string, unknown> = {}) {
  return {
    requestingUser: HR_USER,
    from: new Date('2026-09-01'),
    to: new Date('2026-09-30'),
    ...overrides,
  };
}

function detailEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    timesheet_id: 'ts-1',
    employee_id: 'e1',
    entry_date: new Date('2026-09-15T00:00:00.000Z'),
    project_id: 'proj-1',
    task_id: 'task-1',
    hours: 7.5,
    description: 'API contract review',
    created_at: new Date('2026-09-15T08:00:00.000Z'),
    updated_at: new Date('2026-09-15T09:00:00.000Z'),
    employee: { employee_no: 'EMP-0001', first_name: 'Emma', last_name: 'Employee' },
    project: { id: 'proj-1', code: 'ERP-001', name: 'ERP Migration', is_billable: true },
    task: { id: 'task-1', name: 'Implementation' },
    timesheet: { status: TimesheetStatus.APPROVED },
    ...overrides,
  };
}

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  message?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect((err as { status: number }).status).toBe(status);
    if (message) expect((err as Error).message).toContain(message);
    return;
  }
  throw new Error(`Expected HTTP error ${status} but promise resolved`);
}

describe('timesheet-report-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSummaryReport', () => {
    it('throws 400 when from is after to', async () => {
      await expectHttpError(
        getSummaryReport(filters({ from: new Date('2026-09-30'), to: new Date('2026-09-01') })),
        400,
        'from must be before to',
      );
    });

    it('groups by employee with totals, billable hours and entry counts', async () => {
      mocked.entryGroupBy
        .mockResolvedValueOnce([
          { employee_id: 'e1', _sum: { hours: '15.25' }, _count: 2 },
        ] as never)
        .mockResolvedValueOnce([{ employee_id: 'e1', _sum: { hours: 10 } }] as never);
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'e1',
          employee_no: 'EMP-0001',
          first_name: 'Emma',
          last_name: 'Employee',
          department: { id: 'd1', name: 'Engineering' },
        },
      ] as never);

      const result = await getSummaryReport(filters());

      expect(result.rows).toEqual([
        {
          employeeId: 'e1',
          employeeNo: 'EMP-0001',
          employeeName: 'Emma Employee',
          departmentId: 'd1',
          departmentName: 'Engineering',
          totalHours: 15.25,
          billableHours: 10,
          entryCount: 2,
        },
      ]);
      expect(result.groupBy).toBe('employee');
      expect(result.from).toBe('2026-09-01');
      expect(result.to).toBe('2026-09-30');
      expect(result.includeAllStatuses).toBe(false);
    });

    it('defaults to APPROVED timesheets only', async () => {
      mocked.entryGroupBy.mockResolvedValue([] as never);

      await getSummaryReport(filters());

      const where = mocked.entryGroupBy.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where.timesheet).toEqual({
        status: TimesheetStatus.APPROVED,
        deleted_at: null,
      });
      expect(where.entry_date).toEqual({
        gte: new Date('2026-09-01T00:00:00.000Z'),
        lte: new Date('2026-09-30T23:59:59.999Z'),
      });
    });

    it('includes all statuses when requested', async () => {
      mocked.entryGroupBy.mockResolvedValue([] as never);

      await getSummaryReport(filters({ includeAllStatuses: true }));

      const where = mocked.entryGroupBy.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where.timesheet).toBeUndefined();
    });

    it('scopes a MANAGER to direct reports only', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-1' } as never);
      // The same mock serves the reports lookup and the detail lookup.
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'e1',
          employee_no: 'EMP-0001',
          first_name: 'Emma',
          last_name: 'Employee',
          department: { id: 'd1', name: 'Engineering' },
        },
        {
          id: 'e2',
          employee_no: 'EMP-0002',
          first_name: 'Bob',
          last_name: 'Builder',
          department: null,
        },
      ] as never);
      mocked.entryGroupBy.mockResolvedValue([] as never);

      await getSummaryReport(filters({ requestingUser: { userId: 'user-mgr', role: 'MANAGER' } }));

      // The reports lookup resolves the manager's direct reports.
      expect(mocked.employeeFindMany).toHaveBeenCalledWith({
        where: { manager_id: 'mgr-1', deleted_at: null },
        select: { id: true },
      });
      const where = mocked.entryGroupBy.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where.employee_id).toEqual({ in: ['e1', 'e2'] });
    });

    it('yields an empty scope when a MANAGER filters to a non-report employee', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-1' } as never);
      mocked.employeeFindMany.mockResolvedValue([{ id: 'e1' }] as never);
      mocked.entryGroupBy.mockResolvedValue([] as never);

      await getSummaryReport(
        filters({
          requestingUser: { userId: 'user-mgr', role: 'MANAGER' },
          employeeId: 'e9',
        }),
      );

      const where = mocked.entryGroupBy.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where.employee_id).toEqual({ in: [] });
    });

    it('scopes an EMPLOYEE to their own entries', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'e1' } as never);
      mocked.entryGroupBy.mockResolvedValue([] as never);

      await getSummaryReport(filters({ requestingUser: { userId: 'user-1', role: 'EMPLOYEE' } }));

      const where = mocked.entryGroupBy.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where.employee_id).toEqual({ in: ['e1'] });
    });

    it('leaves HR_MANAGER unrestricted', async () => {
      mocked.entryGroupBy.mockResolvedValue([] as never);

      await getSummaryReport(filters());

      const where = mocked.entryGroupBy.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where.employee_id).toBeUndefined();
      expect(mocked.employeeFindUnique).not.toHaveBeenCalled();
    });

    it('groups by project with code, name, client and billability', async () => {
      mocked.entryGroupBy.mockResolvedValue([
        { project_id: 'proj-1', _sum: { hours: 40 }, _count: 5 },
      ] as never);
      mocked.projectFindMany.mockResolvedValue([
        {
          id: 'proj-1',
          code: 'ERP-001',
          name: 'ERP Migration',
          client: 'Internal',
          is_billable: true,
        },
      ] as never);

      const result = await getSummaryReport(filters({ groupBy: 'project' }));

      expect(result.rows).toEqual([
        {
          projectId: 'proj-1',
          projectCode: 'ERP-001',
          projectName: 'ERP Migration',
          client: 'Internal',
          isBillable: true,
          totalHours: 40,
          entryCount: 5,
        },
      ]);
      expect(result.groupBy).toBe('project');
    });

    it('groups by department with employee counts', async () => {
      mocked.entryGroupBy.mockResolvedValue([
        { employee_id: 'e1', _sum: { hours: 20 }, _count: 3 },
        { employee_id: 'e2', _sum: { hours: 10 }, _count: 2 },
        { employee_id: 'e3', _sum: { hours: 5 }, _count: 1 },
      ] as never);
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'e1',
          employee_no: 'EMP-0001',
          first_name: 'Emma',
          last_name: 'Employee',
          department: { id: 'd1', name: 'Engineering' },
        },
        {
          id: 'e2',
          employee_no: 'EMP-0002',
          first_name: 'Bob',
          last_name: 'Builder',
          department: { id: 'd1', name: 'Engineering' },
        },
        {
          id: 'e3',
          employee_no: 'EMP-0003',
          first_name: 'No',
          last_name: 'Department',
          department: null,
        },
      ] as never);

      const result = await getSummaryReport(filters({ groupBy: 'department' }));

      expect(result.rows).toEqual([
        {
          departmentId: 'd1',
          departmentName: 'Engineering',
          employeeCount: 2,
          totalHours: 30,
          entryCount: 5,
        },
        {
          departmentId: null,
          departmentName: null,
          employeeCount: 1,
          totalHours: 5,
          entryCount: 1,
        },
      ]);
    });
  });

  describe('getDetailsReport', () => {
    it('returns a paged listing with mapped rows', async () => {
      mocked.entryCount.mockResolvedValue(2 as never);
      mocked.entryFindMany.mockResolvedValue([detailEntryRow()] as never);

      const result = await getDetailsReport(filters({ page: 2, pageSize: 25 }));

      expect(mocked.entryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 25, take: 25 }),
      );
      expect(result.total).toBe(2);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(25);
      expect(result.entries[0]).toEqual({
        id: 'entry-1',
        timesheetId: 'ts-1',
        employeeId: 'e1',
        entryDate: '2026-09-15',
        projectId: 'proj-1',
        project: { id: 'proj-1', code: 'ERP-001', name: 'ERP Migration', isBillable: true },
        taskId: 'task-1',
        task: { id: 'task-1', name: 'Implementation' },
        hours: 7.5,
        description: 'API contract review',
        createdAt: new Date('2026-09-15T08:00:00.000Z'),
        updatedAt: new Date('2026-09-15T09:00:00.000Z'),
        employeeNo: 'EMP-0001',
        employeeName: 'Emma Employee',
        timesheetStatus: 'APPROVED',
      });
    });

    it('applies the same manager scoping as the summary', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-1' } as never);
      mocked.employeeFindMany.mockResolvedValue([{ id: 'e1' }] as never);
      mocked.entryCount.mockResolvedValue(0 as never);
      mocked.entryFindMany.mockResolvedValue([] as never);

      await getDetailsReport(filters({ requestingUser: { userId: 'user-mgr', role: 'MANAGER' } }));

      const where = mocked.entryFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where.employee_id).toEqual({ in: ['e1'] });
    });
  });

  describe('exportReportCsv', () => {
    it('renders the contract header and rows with proper CSV escaping', async () => {
      mocked.entryFindMany.mockResolvedValue([
        detailEntryRow(),
        detailEntryRow({
          id: 'entry-2',
          description: 'Fixed the "billing" bug, plus extras\nsecond line',
          hours: 1.25,
          task: null,
          task_id: null,
        }),
      ] as never);

      const csv = await exportReportCsv(filters());

      const lines = csv.trimEnd().split('\n');
      expect(lines[0]).toBe(
        'employee_no,employee_name,date,project_code,project_name,task_name,hours,description,timesheet_status',
      );
      expect(lines[1]).toBe(
        'EMP-0001,Emma Employee,2026-09-15,ERP-001,ERP Migration,Implementation,7.5,API contract review,APPROVED',
      );
      // Commas, quotes and newlines force quoting; inner quotes are doubled and
      // the embedded newline stays inside the quoted field.
      expect(lines[2]).toBe(
        'EMP-0001,Emma Employee,2026-09-15,ERP-001,ERP Migration,,1.25,"Fixed the ""billing"" bug, plus extras',
      );
      expect(lines[3]).toBe('second line",APPROVED');
    });

    it('returns only the header when there are no matching entries', async () => {
      mocked.entryFindMany.mockResolvedValue([] as never);

      const csv = await exportReportCsv(filters());

      expect(csv).toBe(
        'employee_no,employee_name,date,project_code,project_name,task_name,hours,description,timesheet_status\n',
      );
    });

    it('neutralizes spreadsheet formula injection in user-controlled fields', async () => {
      mocked.entryFindMany.mockResolvedValue([
        detailEntryRow({ description: '=HYPERLINK("https://evil.example","click")' }),
        detailEntryRow({ id: 'entry-2', description: '@SUM(1+1)' }),
        detailEntryRow({ id: 'entry-3', description: '+2+2' }),
        detailEntryRow({ id: 'entry-4', description: '-2+2' }),
      ] as never);

      const csv = await exportReportCsv(filters());

      // Dangerous leading characters get a single-quote prefix so Excel/Sheets
      // treats the cell as text instead of a formula.
      expect(csv).toContain("'=HYPERLINK");
      expect(csv).toContain("'@SUM(1+1)");
      expect(csv).toContain("'+2+2");
      expect(csv).toContain("'-2+2");
      // Ordinary text without a dangerous prefix is untouched.
      expect(csv).not.toContain("';-2+2");
    });

    it('audit-logs every export with EXPORT / TIMESHEET', async () => {
      mocked.entryFindMany.mockResolvedValue([detailEntryRow()] as never);

      await exportReportCsv(filters({ projectId: 'proj-1' }));

      expect(mocked.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-hr',
          actorName: 'HR Manager',
          action: 'EXPORT',
          entity: 'TIMESHEET',
          newValue: expect.objectContaining({ projectId: 'proj-1', rowCount: 1 }),
        }),
      );
    });
  });
});
