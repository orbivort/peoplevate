import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimesheetStatus } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    projectTask: { findFirst: vi.fn() },
    timesheet: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    timesheetEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    timesheetApproval: { create: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../utils/audit-context.js', () => ({
  withAuditContext: vi.fn(
    (_prisma: unknown, _actorId: string, _actorName: string, cb: (tx: unknown) => unknown) =>
      cb(prisma),
  ),
}));

vi.mock('./email-service.js', () => ({
  sendTimesheetStatusEmail: vi.fn(),
}));

vi.mock('./audit-service.js', () => ({
  logAuditEvent: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import { sendTimesheetStatusEmail } from './email-service.js';
import { logAuditEvent } from './audit-service.js';
import {
  approveTimesheet,
  createTimesheetEntry,
  deleteTimesheetEntry,
  getCurrentTimesheet,
  getTimesheetById,
  getWeekPeriod,
  listPendingTimesheets,
  listTimesheets,
  rejectTimesheet,
  submitTimesheet,
  updateTimesheetEntry,
} from './timesheet-service.js';

const mocked = {
  projectFindFirst: vi.mocked(prisma.project.findFirst),
  taskFindFirst: vi.mocked(prisma.projectTask.findFirst),
  timesheetFindFirst: vi.mocked(prisma.timesheet.findFirst),
  timesheetFindMany: vi.mocked(prisma.timesheet.findMany),
  timesheetCreate: vi.mocked(prisma.timesheet.create),
  timesheetUpdate: vi.mocked(prisma.timesheet.update),
  timesheetCount: vi.mocked(prisma.timesheet.count),
  entryFindFirst: vi.mocked(prisma.timesheetEntry.findFirst),
  entryCreate: vi.mocked(prisma.timesheetEntry.create),
  entryUpdate: vi.mocked(prisma.timesheetEntry.update),
  entryAggregate: vi.mocked(prisma.timesheetEntry.aggregate),
  entryGroupBy: vi.mocked(prisma.timesheetEntry.groupBy),
  approvalCreate: vi.mocked(prisma.timesheetApproval.create),
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  userFindMany: vi.mocked(prisma.user.findMany),
  sendTimesheetStatusEmail: vi.mocked(sendTimesheetStatusEmail),
  logAuditEvent: vi.mocked(logAuditEvent),
};

const EMP = 'emp-1';
// Wednesday, 2026-09-16 — the current week is Mon 2026-09-14 → Sun 2026-09-20.
const NOW = new Date('2026-09-16T12:00:00.000Z');
const PERIOD_START = new Date('2026-09-14T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-20T23:59:59.999Z');

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    timesheet_id: 'ts-1',
    employee_id: EMP,
    entry_date: new Date('2026-09-15T00:00:00.000Z'),
    project_id: 'proj-1',
    project: { id: 'proj-1', code: 'ERP-001', name: 'ERP Migration', is_billable: true },
    task_id: null,
    task: null,
    hours: 7.5,
    description: 'API contract review',
    created_at: new Date('2026-09-15T08:00:00Z'),
    updated_at: new Date('2026-09-15T08:00:00Z'),
    ...overrides,
  };
}

function detailFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ts-1',
    employee_id: EMP,
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    status: TimesheetStatus.DRAFT,
    submitted_at: null,
    created_at: new Date('2026-09-15T08:00:00Z'),
    updated_at: new Date('2026-09-15T08:00:00Z'),
    employee: { id: EMP, employee_no: 'EMP-0001', first_name: 'Emma', last_name: 'Employee' },
    entries: [entryRow()],
    approvals: [],
    ...overrides,
  };
}

/** A DRAFT timesheet row as loaded for entry CRUD (with its timesheet include). */
function ownedEntry(overrides: Record<string, unknown> = {}) {
  return {
    ...entryRow(),
    timesheet: {
      id: 'ts-1',
      employee_id: EMP,
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      status: TimesheetStatus.DRAFT,
    },
    ...overrides,
  };
}

/** A timesheet as loaded for a submit/approve/reject decision. */
function decisionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ts-1',
    employee_id: EMP,
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    status: TimesheetStatus.SUBMITTED,
    employee: {
      id: EMP,
      manager_id: 'mgr-1',
      email: 'emma@example.com',
      first_name: 'Emma',
      last_name: 'Employee',
    },
    ...overrides,
  };
}

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  message?: string,
  code?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect((err as { status: number }).status).toBe(status);
    if (message) expect((err as Error).message).toContain(message);
    if (code) expect((err as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`Expected HTTP error ${status} but promise resolved`);
}

describe('timesheet-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getWeekPeriod', () => {
    it('returns Monday 00:00:00.000 to Sunday 23:59:59.999 UTC', () => {
      const { periodStart, periodEnd } = getWeekPeriod(new Date('2026-09-16T15:30:00Z'));
      expect(periodStart).toEqual(new Date('2026-09-14T00:00:00.000Z'));
      expect(periodEnd).toEqual(new Date('2026-09-20T23:59:59.999Z'));
    });

    it('treats Sunday as the last day of the same week', () => {
      const { periodStart, periodEnd } = getWeekPeriod(new Date('2026-09-20T23:00:00Z'));
      expect(periodStart).toEqual(new Date('2026-09-14T00:00:00.000Z'));
      expect(periodEnd).toEqual(new Date('2026-09-20T23:59:59.999Z'));
    });

    it('starts a new week on Monday', () => {
      const { periodStart } = getWeekPeriod(new Date('2026-09-21T01:00:00Z'));
      expect(periodStart).toEqual(new Date('2026-09-21T00:00:00.000Z'));
    });
  });

  describe('createTimesheetEntry', () => {
    it('creates an entry and returns the owning timesheet detail', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.timesheetFindFirst
        .mockResolvedValueOnce(null as never) // get-or-create lookup
        .mockResolvedValueOnce(detailFixture({ entries: [] }) as never); // detail fetch
      mocked.timesheetCreate.mockResolvedValue({
        id: 'ts-1',
        status: TimesheetStatus.DRAFT,
      } as never);
      mocked.entryAggregate.mockResolvedValue({ _sum: { hours: null } } as never);
      mocked.entryFindFirst.mockResolvedValue(null as never);
      mocked.entryCreate.mockResolvedValue(entryRow() as never);

      const result = await createTimesheetEntry({
        employeeId: EMP,
        entryDate: new Date('2026-09-15T10:00:00Z'),
        projectId: 'proj-1',
        hours: 7.5,
        description: 'API contract review',
        actorId: 'user-1',
        actorName: 'Emma Employee',
      });

      expect(mocked.timesheetCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employee_id: EMP,
          period_start: PERIOD_START,
          period_end: PERIOD_END,
          status: TimesheetStatus.DRAFT,
        }),
        select: { id: true, status: true },
      });
      expect(mocked.entryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          timesheet_id: 'ts-1',
          employee_id: EMP,
          entry_date: new Date('2026-09-15T00:00:00.000Z'),
          project_id: 'proj-1',
          hours: 7.5,
        }),
      });
      expect(result.id).toBe('ts-1');
      expect(result.weeklyTotalHours).toBe(0);
    });

    it('computes totals, per-day and per-project breakdowns on the detail DTO', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.timesheetFindFirst
        .mockResolvedValueOnce({ id: 'ts-1', status: TimesheetStatus.DRAFT } as never)
        .mockResolvedValueOnce(
          detailFixture({
            entries: [
              entryRow({ id: 'e1', entry_date: new Date('2026-09-15T00:00:00Z'), hours: 7.5 }),
              entryRow({
                id: 'e2',
                entry_date: new Date('2026-09-16T00:00:00Z'),
                hours: 8,
                project: {
                  id: 'proj-2',
                  code: 'WEB-002',
                  name: 'Website Redesign',
                  is_billable: false,
                },
                project_id: 'proj-2',
              }),
            ],
          }) as never,
        );
      mocked.entryAggregate.mockResolvedValue({ _sum: { hours: null } } as never);
      mocked.entryFindFirst.mockResolvedValue(null as never);
      mocked.entryCreate.mockResolvedValue(entryRow() as never);

      const result = await createTimesheetEntry({
        employeeId: EMP,
        entryDate: new Date('2026-09-15'),
        projectId: 'proj-1',
        hours: 0.25,
        actorId: 'user-1',
        actorName: 'Emma',
      });

      expect(result.weeklyTotalHours).toBe(15.5);
      expect(result.perDayTotals).toHaveLength(7);
      expect(result.perDayTotals[1]).toEqual({ date: '2026-09-15', hours: 7.5 });
      expect(result.perDayTotals[2]).toEqual({ date: '2026-09-16', hours: 8 });
      expect(result.perDayTotals[0]).toEqual({ date: '2026-09-14', hours: 0 });
      expect(result.perProjectTotals).toEqual([
        { projectId: 'proj-1', projectCode: 'ERP-001', projectName: 'ERP Migration', hours: 7.5 },
        {
          projectId: 'proj-2',
          projectCode: 'WEB-002',
          projectName: 'Website Redesign',
          hours: 8,
        },
      ]);
    });

    it('rejects hours that are not positive', async () => {
      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-15'),
          projectId: 'proj-1',
          hours: 0,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'greater than 0',
      );
      expect(mocked.entryCreate).not.toHaveBeenCalled();
    });

    it('rejects hours above 24', async () => {
      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-15'),
          projectId: 'proj-1',
          hours: 24.5,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'cannot exceed 24',
      );
    });

    it('rejects hours that are not a multiple of 0.25', async () => {
      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-15'),
          projectId: 'proj-1',
          hours: 7.55,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'multiple of 0.25',
      );
    });

    it('accepts exactly 24 hours', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.timesheetFindFirst
        .mockResolvedValueOnce({ id: 'ts-1', status: TimesheetStatus.DRAFT } as never)
        .mockResolvedValueOnce(detailFixture() as never);
      mocked.entryAggregate.mockResolvedValue({ _sum: { hours: null } } as never);
      mocked.entryFindFirst.mockResolvedValue(null as never);
      mocked.entryCreate.mockResolvedValue(entryRow() as never);

      await createTimesheetEntry({
        employeeId: EMP,
        entryDate: new Date('2026-09-15'),
        projectId: 'proj-1',
        hours: 24,
        actorId: 'user-1',
        actorName: 'Emma',
      });

      expect(mocked.entryCreate).toHaveBeenCalled();
    });

    it('rejects dates before the previous week', async () => {
      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-06'),
          projectId: 'proj-1',
          hours: 1,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'current or previous week',
      );
      expect(mocked.entryCreate).not.toHaveBeenCalled();
    });

    it('rejects dates in a future week', async () => {
      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-21'),
          projectId: 'proj-1',
          hours: 1,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'current or previous week',
      );
    });

    it('accepts a date in the previous week and files it in that week', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.timesheetFindFirst
        .mockResolvedValueOnce(null as never) // get-or-create for previous week
        .mockResolvedValueOnce(detailFixture({ entries: [] }) as never);
      mocked.timesheetCreate.mockResolvedValue({
        id: 'ts-prev',
        status: TimesheetStatus.DRAFT,
      } as never);
      mocked.entryAggregate.mockResolvedValue({ _sum: { hours: null } } as never);
      mocked.entryFindFirst.mockResolvedValue(null as never);
      mocked.entryCreate.mockResolvedValue(entryRow() as never);

      await createTimesheetEntry({
        employeeId: EMP,
        entryDate: new Date('2026-09-08'),
        projectId: 'proj-1',
        hours: 2,
        actorId: 'user-1',
        actorName: 'Emma',
      });

      expect(mocked.timesheetCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          period_start: new Date('2026-09-07T00:00:00.000Z'),
          period_end: new Date('2026-09-13T23:59:59.999Z'),
        }),
        select: { id: true, status: true },
      });
    });

    it('rejects an inactive or missing project', async () => {
      mocked.projectFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-15'),
          projectId: 'proj-x',
          hours: 1,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'Project not found or inactive',
      );
    });

    it('rejects a task that does not belong to the project', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.taskFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-15'),
          projectId: 'proj-1',
          taskId: 'task-x',
          hours: 1,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'not part of the project',
      );
    });

    it('rejects a description longer than 500 characters', async () => {
      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-15'),
          projectId: 'proj-1',
          hours: 1,
          description: 'x'.repeat(501),
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'description',
      );
    });

    it('throws 409 TIMESHEET_LOCKED when the week timesheet is SUBMITTED', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.timesheetFindFirst.mockResolvedValue({
        id: 'ts-1',
        status: TimesheetStatus.SUBMITTED,
      } as never);

      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-15'),
          projectId: 'proj-1',
          hours: 1,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        409,
        'locked',
        'TIMESHEET_LOCKED',
      );
      expect(mocked.entryCreate).not.toHaveBeenCalled();
    });

    it('throws 409 DAY_TOTAL_EXCEEDED when the day cap would be exceeded', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.timesheetFindFirst.mockResolvedValue({
        id: 'ts-1',
        status: TimesheetStatus.DRAFT,
      } as never);
      mocked.entryAggregate.mockResolvedValue({ _sum: { hours: 20 } } as never);

      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-15'),
          projectId: 'proj-1',
          hours: 5,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        409,
        'exceed 24',
        'DAY_TOTAL_EXCEEDED',
      );
      expect(mocked.entryCreate).not.toHaveBeenCalled();
    });

    it('throws 409 ENTRY_OVERLAP for a duplicate employee/date/project/task entry', async () => {
      mocked.projectFindFirst.mockResolvedValue({ id: 'proj-1' } as never);
      mocked.timesheetFindFirst.mockResolvedValue({
        id: 'ts-1',
        status: TimesheetStatus.DRAFT,
      } as never);
      mocked.entryAggregate.mockResolvedValue({ _sum: { hours: null } } as never);
      mocked.entryFindFirst.mockResolvedValue(entryRow() as never);

      await expectHttpError(
        createTimesheetEntry({
          employeeId: EMP,
          entryDate: new Date('2026-09-15'),
          projectId: 'proj-1',
          hours: 1,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        409,
        'already exists',
        'ENTRY_OVERLAP',
      );
      expect(mocked.entryCreate).not.toHaveBeenCalled();
    });
  });

  describe('updateTimesheetEntry', () => {
    it('throws 404 when the entry does not exist', async () => {
      mocked.entryFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        updateTimesheetEntry({
          entryId: 'entry-x',
          employeeId: EMP,
          hours: 2,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        404,
        'not found',
      );
    });

    it('throws 404 when the caller is not the owner', async () => {
      mocked.entryFindFirst.mockResolvedValue(ownedEntry({ employee_id: 'emp-2' }) as never);

      await expectHttpError(
        updateTimesheetEntry({
          entryId: 'entry-1',
          employeeId: EMP,
          hours: 2,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        404,
      );
    });

    it('throws 409 TIMESHEET_LOCKED when the timesheet is SUBMITTED', async () => {
      mocked.entryFindFirst.mockResolvedValue(
        ownedEntry({
          timesheet: {
            id: 'ts-1',
            employee_id: EMP,
            period_start: PERIOD_START,
            period_end: PERIOD_END,
            status: TimesheetStatus.SUBMITTED,
          },
        }) as never,
      );

      await expectHttpError(
        updateTimesheetEntry({
          entryId: 'entry-1',
          employeeId: EMP,
          hours: 2,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        409,
        'locked',
        'TIMESHEET_LOCKED',
      );
    });

    it('updates fields and re-validates the day total excluding this entry', async () => {
      mocked.entryFindFirst
        .mockResolvedValueOnce(ownedEntry() as never) // load
        .mockResolvedValueOnce(null as never); // overlap check
      mocked.entryAggregate.mockResolvedValue({ _sum: { hours: 20 } } as never);
      mocked.entryUpdate.mockResolvedValue(entryRow() as never);
      mocked.timesheetFindFirst.mockResolvedValueOnce(detailFixture() as never);

      const result = await updateTimesheetEntry({
        entryId: 'entry-1',
        employeeId: EMP,
        hours: 4,
        description: 'Updated',
        actorId: 'user-1',
        actorName: 'Emma',
      });

      expect(mocked.entryAggregate).toHaveBeenCalledWith({
        where: expect.objectContaining({
          employee_id: EMP,
          entry_date: new Date('2026-09-15T00:00:00.000Z'),
          id: { not: 'entry-1' },
        }),
        _sum: { hours: true },
      });
      expect(mocked.entryUpdate).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: { hours: 4, description: 'Updated' },
      });
      expect(result.id).toBe('ts-1');
    });

    it('throws 409 when the new hours would break the day cap', async () => {
      mocked.entryFindFirst.mockResolvedValueOnce(ownedEntry() as never);
      mocked.entryAggregate.mockResolvedValue({ _sum: { hours: 20 } } as never);

      await expectHttpError(
        updateTimesheetEntry({
          entryId: 'entry-1',
          employeeId: EMP,
          hours: 5,
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        409,
        'exceed 24',
        'DAY_TOTAL_EXCEEDED',
      );
      expect(mocked.entryUpdate).not.toHaveBeenCalled();
    });

    it('re-validates the project/task when the project changes', async () => {
      mocked.entryFindFirst.mockResolvedValueOnce(ownedEntry() as never);
      mocked.projectFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        updateTimesheetEntry({
          entryId: 'entry-1',
          employeeId: EMP,
          projectId: 'proj-9',
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'Project not found or inactive',
      );
    });

    it('moves the entry to another week timesheet when entryDate changes week', async () => {
      mocked.entryFindFirst
        .mockResolvedValueOnce(ownedEntry() as never) // load
        .mockResolvedValueOnce(null as never); // overlap check
      mocked.timesheetFindFirst
        .mockResolvedValueOnce(null as never) // get-or-create for the new week
        .mockResolvedValueOnce(detailFixture({ id: 'ts-prev', entries: [] }) as never);
      mocked.timesheetCreate.mockResolvedValue({
        id: 'ts-prev',
        status: TimesheetStatus.DRAFT,
      } as never);
      mocked.entryAggregate.mockResolvedValue({ _sum: { hours: null } } as never);
      mocked.entryUpdate.mockResolvedValue(entryRow() as never);

      await updateTimesheetEntry({
        entryId: 'entry-1',
        employeeId: EMP,
        entryDate: new Date('2026-09-09'),
        actorId: 'user-1',
        actorName: 'Emma',
      });

      expect(mocked.entryUpdate).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: {
          entry_date: new Date('2026-09-09T00:00:00.000Z'),
          timesheet_id: 'ts-prev',
        },
      });
    });
  });

  describe('deleteTimesheetEntry', () => {
    it('soft-deletes an owned entry in an unlocked timesheet', async () => {
      mocked.entryFindFirst.mockResolvedValueOnce(ownedEntry() as never);
      mocked.entryUpdate.mockResolvedValue(entryRow() as never);
      mocked.timesheetFindFirst.mockResolvedValueOnce(detailFixture({ entries: [] }) as never);

      const result = await deleteTimesheetEntry({
        entryId: 'entry-1',
        employeeId: EMP,
        actorId: 'user-1',
        actorName: 'Emma',
      });

      expect(mocked.entryUpdate).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: { deleted_at: expect.any(Date) },
      });
      expect(result.entries).toHaveLength(0);
    });

    it('throws 404 when the caller is not the owner', async () => {
      mocked.entryFindFirst.mockResolvedValueOnce(ownedEntry({ employee_id: 'emp-2' }) as never);

      await expectHttpError(
        deleteTimesheetEntry({ entryId: 'entry-1', employeeId: EMP, actorId: 'u', actorName: 'n' }),
        404,
      );
    });

    it('throws 409 TIMESHEET_LOCKED for a locked timesheet', async () => {
      mocked.entryFindFirst.mockResolvedValueOnce(
        ownedEntry({
          timesheet: {
            id: 'ts-1',
            employee_id: EMP,
            period_start: PERIOD_START,
            period_end: PERIOD_END,
            status: TimesheetStatus.APPROVED,
          },
        }) as never,
      );

      await expectHttpError(
        deleteTimesheetEntry({ entryId: 'entry-1', employeeId: EMP, actorId: 'u', actorName: 'n' }),
        409,
        'locked',
        'TIMESHEET_LOCKED',
      );
      expect(mocked.entryUpdate).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentTimesheet', () => {
    it('get-or-creates the current week DRAFT timesheet', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(detailFixture({ entries: [] }) as never);
      mocked.timesheetCreate.mockResolvedValue({
        id: 'ts-1',
        status: TimesheetStatus.DRAFT,
      } as never);

      const result = await getCurrentTimesheet({
        employeeId: EMP,
        actorId: 'user-1',
        actorName: 'Emma',
      });

      expect(mocked.timesheetCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          period_start: PERIOD_START,
          period_end: PERIOD_END,
          status: TimesheetStatus.DRAFT,
        }),
        select: { id: true, status: true },
      });
      expect(result.status).toBe(TimesheetStatus.DRAFT);
    });

    it('rejects a date outside the current or previous week', async () => {
      await expectHttpError(
        getCurrentTimesheet({
          employeeId: EMP,
          date: new Date('2026-10-01'),
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        400,
        'current or previous week',
      );
    });
  });

  describe('listTimesheets', () => {
    it('maps rows with computed totals from a grouped aggregation', async () => {
      mocked.timesheetCount.mockResolvedValue(1 as never);
      mocked.timesheetFindMany.mockResolvedValue([
        {
          id: 'ts-1',
          employee_id: EMP,
          period_start: PERIOD_START,
          period_end: PERIOD_END,
          status: TimesheetStatus.SUBMITTED,
          submitted_at: new Date('2026-09-16T08:00:00Z'),
          employee: { id: EMP, employee_no: 'EMP-0001', first_name: 'Emma', last_name: 'E' },
        },
      ] as never);
      mocked.entryGroupBy.mockResolvedValue([
        { timesheet_id: 'ts-1', _sum: { hours: 38.5 }, _count: 9 },
      ] as never);

      const result = await listTimesheets({ employeeId: EMP });

      expect(result.total).toBe(1);
      expect(result.timesheets[0]).toEqual(
        expect.objectContaining({
          id: 'ts-1',
          status: TimesheetStatus.SUBMITTED,
          weeklyTotalHours: 38.5,
          entryCount: 9,
        }),
      );
    });

    it('filters by status and period week', async () => {
      mocked.timesheetCount.mockResolvedValue(0 as never);
      mocked.timesheetFindMany.mockResolvedValue([] as never);

      await listTimesheets({
        employeeId: EMP,
        status: TimesheetStatus.DRAFT,
        periodStart: new Date('2026-09-14'),
      });

      const where = mocked.timesheetFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where.status).toBe(TimesheetStatus.DRAFT);
      expect(where.period_start).toEqual({
        gte: new Date('2026-09-14T00:00:00.000Z'),
        lt: new Date('2026-09-21T00:00:00.000Z'),
      });
    });
  });

  describe('getTimesheetById', () => {
    it('returns the detail for the owner', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce({
          id: 'ts-1',
          employee: { id: EMP, manager_id: 'mgr-1', user_id: 'user-1' },
        } as never)
        .mockResolvedValueOnce(detailFixture() as never);

      const result = await getTimesheetById({
        timesheetId: 'ts-1',
        requestingUser: { userId: 'user-1', role: 'EMPLOYEE' },
      });

      expect(result.id).toBe('ts-1');
    });

    it('throws 404 when the timesheet does not exist', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(null as never);

      await expectHttpError(
        getTimesheetById({ timesheetId: 'ts-x', requestingUser: { userId: 'u', role: 'ADMIN' } }),
        404,
      );
    });

    it('throws 403 for an unrelated employee', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce({
        id: 'ts-1',
        employee: { id: EMP, manager_id: 'mgr-1', user_id: 'user-1' },
      } as never);

      await expectHttpError(
        getTimesheetById({
          timesheetId: 'ts-1',
          requestingUser: { userId: 'user-9', role: 'EMPLOYEE', employeeId: 'emp-9' },
        }),
        403,
        'Insufficient permissions',
      );
    });

    it('allows the direct manager', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce({
          id: 'ts-1',
          employee: { id: EMP, manager_id: 'mgr-1', user_id: 'user-1' },
        } as never)
        .mockResolvedValueOnce(detailFixture() as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-1' } as never);

      const result = await getTimesheetById({
        timesheetId: 'ts-1',
        requestingUser: { userId: 'user-mgr', role: 'MANAGER' },
      });

      expect(result.id).toBe('ts-1');
    });

    it('allows HR_MANAGER without a manager relation', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce({
          id: 'ts-1',
          employee: { id: EMP, manager_id: 'mgr-1', user_id: 'user-1' },
        } as never)
        .mockResolvedValueOnce(detailFixture() as never);

      await getTimesheetById({
        timesheetId: 'ts-1',
        requestingUser: { userId: 'user-hr', role: 'HR_MANAGER' },
      });

      expect(mocked.employeeFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('submitTimesheet', () => {
    const submitLoad = {
      id: 'ts-1',
      employee_id: EMP,
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      status: TimesheetStatus.DRAFT,
      employee: { id: EMP, manager_id: 'mgr-1', first_name: 'Emma', last_name: 'Employee' },
      entries: [{ id: 'entry-1' }],
    };

    it('throws 404 when the timesheet is missing', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(null as never);

      await expectHttpError(
        submitTimesheet({ timesheetId: 'ts-x', employeeId: EMP, actorId: 'u', actorName: 'n' }),
        404,
      );
    });

    it('throws 404 when the caller is not the owner', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(
        decisionFixture({ employee_id: 'emp-2' }) as never,
      );

      await expectHttpError(
        submitTimesheet({ timesheetId: 'ts-1', employeeId: EMP, actorId: 'u', actorName: 'n' }),
        404,
      );
    });

    it('throws 409 when already SUBMITTED or APPROVED', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(
        decisionFixture({ status: TimesheetStatus.APPROVED }) as never,
      );

      await expectHttpError(
        submitTimesheet({ timesheetId: 'ts-1', employeeId: EMP, actorId: 'u', actorName: 'n' }),
        409,
        'Cannot submit',
      );
    });

    it('throws 400 when the timesheet has no entries', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(
        decisionFixture({ status: TimesheetStatus.DRAFT, entries: [] }) as never,
      );

      await expectHttpError(
        submitTimesheet({ timesheetId: 'ts-1', employeeId: EMP, actorId: 'u', actorName: 'n' }),
        400,
        'no entries',
      );
    });

    it('throws 400 with HR guidance when no manager is assigned', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(
        decisionFixture({
          status: TimesheetStatus.DRAFT,
          entries: [{ id: 'entry-1' }],
          employee: { id: EMP, manager_id: null, first_name: 'Emma', last_name: 'E' },
        }) as never,
      );

      await expectHttpError(
        submitTimesheet({ timesheetId: 'ts-1', employeeId: EMP, actorId: 'u', actorName: 'n' }),
        400,
        'contact HR',
      );
    });

    it('submits and emails the manager', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce(submitLoad as never)
        .mockResolvedValueOnce(detailFixture({ status: TimesheetStatus.SUBMITTED }) as never);
      mocked.timesheetUpdate.mockResolvedValue({} as never);
      mocked.employeeFindUnique.mockResolvedValue({
        first_name: 'Marcus',
        last_name: 'Manager',
        user: { email: 'marcus@example.com' },
      } as never);

      const result = await submitTimesheet({
        timesheetId: 'ts-1',
        employeeId: EMP,
        actorId: 'user-1',
        actorName: 'Emma Employee',
      });

      expect(mocked.timesheetUpdate).toHaveBeenCalledWith({
        where: { id: 'ts-1' },
        data: expect.objectContaining({
          status: TimesheetStatus.SUBMITTED,
          submitted_by: 'user-1',
          submitted_at: expect.any(Date),
        }),
      });
      expect(mocked.sendTimesheetStatusEmail).toHaveBeenCalledWith(
        'marcus@example.com',
        'Marcus Manager',
        'Emma Employee',
        '2026-09-14 to 2026-09-20',
        'submitted',
      );
      expect(result.status).toBe(TimesheetStatus.SUBMITTED);
    });

    it('skips the email silently when the manager has no user account', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce(submitLoad as never)
        .mockResolvedValueOnce(detailFixture({ status: TimesheetStatus.SUBMITTED }) as never);
      mocked.timesheetUpdate.mockResolvedValue({} as never);
      mocked.employeeFindUnique.mockResolvedValue({
        first_name: 'Marcus',
        last_name: 'Manager',
        user: null,
      } as never);

      await submitTimesheet({ timesheetId: 'ts-1', employeeId: EMP, actorId: 'u', actorName: 'n' });

      expect(mocked.sendTimesheetStatusEmail).not.toHaveBeenCalled();
    });

    it('allows resubmitting a REJECTED timesheet and preserves approval history', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce({ ...submitLoad, status: TimesheetStatus.REJECTED } as never)
        .mockResolvedValueOnce(
          detailFixture({
            status: TimesheetStatus.SUBMITTED,
            approvals: [
              {
                id: 'ap-1',
                action: 'REJECT',
                comment: 'Fix Tuesday',
                approver_id: 'user-mgr',
                created_at: new Date('2026-09-18T09:00:00Z'),
              },
            ],
          }) as never,
        );
      mocked.timesheetUpdate.mockResolvedValue({} as never);
      mocked.employeeFindUnique.mockResolvedValue({
        first_name: 'Marcus',
        last_name: 'Manager',
        user: { email: 'marcus@example.com' },
      } as never);
      mocked.userFindMany.mockResolvedValue([
        { id: 'user-mgr', email: 'marcus@example.com' },
      ] as never);

      const result = await submitTimesheet({
        timesheetId: 'ts-1',
        employeeId: EMP,
        actorId: 'user-1',
        actorName: 'Emma',
      });

      expect(mocked.timesheetUpdate).toHaveBeenCalledWith({
        where: { id: 'ts-1' },
        data: expect.objectContaining({ status: TimesheetStatus.SUBMITTED }),
      });
      expect(result.approvals).toHaveLength(1);
      expect(result.approvals[0]).toEqual(
        expect.objectContaining({
          action: 'REJECT',
          comment: 'Fix Tuesday',
          approverEmail: 'marcus@example.com',
        }),
      );
    });
  });

  describe('listPendingTimesheets', () => {
    it('scopes MANAGER to direct reports and sorts oldest first', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-1' } as never);
      mocked.timesheetFindMany.mockResolvedValue([
        {
          id: 'ts-1',
          employee_id: EMP,
          period_start: PERIOD_START,
          period_end: PERIOD_END,
          status: TimesheetStatus.SUBMITTED,
          submitted_at: new Date('2026-09-16T08:00:00Z'),
          employee: { id: EMP, employee_no: 'EMP-0001', first_name: 'Emma', last_name: 'E' },
        },
      ] as never);
      mocked.entryGroupBy.mockResolvedValue([
        { timesheet_id: 'ts-1', _sum: { hours: 40 }, _count: 5 },
      ] as never);

      const result = await listPendingTimesheets({
        role: 'MANAGER',
        userId: 'user-mgr',
      });

      expect(mocked.timesheetFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: TimesheetStatus.SUBMITTED,
            deleted_at: null,
            employee: { manager_id: 'mgr-1' },
          },
          orderBy: { submitted_at: 'asc' },
        }),
      );
      expect(result[0]).toEqual(expect.objectContaining({ weeklyTotalHours: 40, entryCount: 5 }));
    });

    it('shows all SUBMITTED timesheets to HR_MANAGER', async () => {
      mocked.timesheetFindMany.mockResolvedValue([] as never);

      await listPendingTimesheets({ role: 'HR_MANAGER', userId: 'user-hr' });

      const where = mocked.timesheetFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where).toEqual({ status: TimesheetStatus.SUBMITTED, deleted_at: null });
      expect(mocked.employeeFindUnique).not.toHaveBeenCalled();
    });

    it('returns an empty list for a MANAGER without an employee record', async () => {
      mocked.employeeFindUnique.mockResolvedValue(null as never);

      const result = await listPendingTimesheets({ role: 'MANAGER', userId: 'user-x' });

      expect(result).toEqual([]);
      expect(mocked.timesheetFindMany).not.toHaveBeenCalled();
    });
  });

  describe('approveTimesheet', () => {
    it('throws 409 when the timesheet is not SUBMITTED', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(
        decisionFixture({ status: TimesheetStatus.DRAFT }) as never,
      );

      await expectHttpError(
        approveTimesheet({
          timesheetId: 'ts-1',
          approverId: 'user-mgr',
          approverRole: 'MANAGER',
          actorId: 'user-mgr',
          actorName: 'Marcus',
        }),
        409,
        'Cannot approve',
      );
    });

    it('blocks self-approval with 403', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(decisionFixture() as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: EMP } as never);

      await expectHttpError(
        approveTimesheet({
          timesheetId: 'ts-1',
          approverId: 'user-1',
          approverRole: 'MANAGER',
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        403,
        'own timesheet',
      );
      expect(mocked.approvalCreate).not.toHaveBeenCalled();
    });

    it('throws 403 for a manager who is not the employee manager', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(decisionFixture() as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-other' } as never);

      await expectHttpError(
        approveTimesheet({
          timesheetId: 'ts-1',
          approverId: 'user-mgr',
          approverRole: 'MANAGER',
          actorId: 'user-mgr',
          actorName: 'Marcus',
        }),
        403,
      );
    });

    it('approves as the direct manager, logs the decision and emails the employee', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce(decisionFixture() as never)
        .mockResolvedValueOnce(detailFixture({ status: TimesheetStatus.APPROVED }) as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-1' } as never);
      mocked.approvalCreate.mockResolvedValue({} as never);
      mocked.timesheetUpdate.mockResolvedValue({} as never);

      const result = await approveTimesheet({
        timesheetId: 'ts-1',
        approverId: 'user-mgr',
        approverRole: 'MANAGER',
        comment: 'Looks good',
        actorId: 'user-mgr',
        actorName: 'Marcus Manager',
      });

      expect(mocked.approvalCreate).toHaveBeenCalledWith({
        data: {
          timesheet_id: 'ts-1',
          approver_id: 'user-mgr',
          action: 'APPROVE',
          comment: 'Looks good',
        },
      });
      expect(mocked.timesheetUpdate).toHaveBeenCalledWith({
        where: { id: 'ts-1' },
        data: { status: TimesheetStatus.APPROVED },
      });
      expect(mocked.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPROVE', entity: 'TIMESHEET', entityId: 'ts-1' }),
      );
      expect(mocked.sendTimesheetStatusEmail).toHaveBeenCalledWith(
        'emma@example.com',
        'Emma Employee',
        'Emma Employee',
        '2026-09-14 to 2026-09-20',
        'approved',
        'Looks good',
      );
      expect(result.status).toBe(TimesheetStatus.APPROVED);
    });

    it('allows HR_MANAGER without being the manager', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce(decisionFixture() as never)
        .mockResolvedValueOnce(detailFixture({ status: TimesheetStatus.APPROVED }) as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-hr' } as never);
      mocked.approvalCreate.mockResolvedValue({} as never);
      mocked.timesheetUpdate.mockResolvedValue({} as never);

      await approveTimesheet({
        timesheetId: 'ts-1',
        approverId: 'user-hr',
        approverRole: 'HR_MANAGER',
        actorId: 'user-hr',
        actorName: 'HR',
      });

      expect(mocked.timesheetUpdate).toHaveBeenCalled();
    });

    it('rejects a comment longer than 500 characters', async () => {
      await expectHttpError(
        approveTimesheet({
          timesheetId: 'ts-1',
          approverId: 'user-mgr',
          approverRole: 'MANAGER',
          comment: 'x'.repeat(501),
          actorId: 'user-mgr',
          actorName: 'Marcus',
        }),
        400,
        'comment',
      );
    });
  });

  describe('rejectTimesheet', () => {
    it('requires a non-empty comment', async () => {
      await expectHttpError(
        rejectTimesheet({
          timesheetId: 'ts-1',
          approverId: 'user-mgr',
          approverRole: 'MANAGER',
          comment: '   ',
          actorId: 'user-mgr',
          actorName: 'Marcus',
        }),
        400,
        'comment',
      );
      expect(mocked.timesheetFindFirst).not.toHaveBeenCalled();
    });

    it('rejects a comment longer than 500 characters', async () => {
      await expectHttpError(
        rejectTimesheet({
          timesheetId: 'ts-1',
          approverId: 'user-mgr',
          approverRole: 'MANAGER',
          comment: 'x'.repeat(501),
          actorId: 'user-mgr',
          actorName: 'Marcus',
        }),
        400,
      );
    });

    it('throws 409 when the timesheet is not SUBMITTED', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(
        decisionFixture({ status: TimesheetStatus.APPROVED }) as never,
      );

      await expectHttpError(
        rejectTimesheet({
          timesheetId: 'ts-1',
          approverId: 'user-mgr',
          approverRole: 'MANAGER',
          comment: 'Nope',
          actorId: 'user-mgr',
          actorName: 'Marcus',
        }),
        409,
        'Cannot reject',
      );
    });

    it('blocks self-rejection with 403', async () => {
      mocked.timesheetFindFirst.mockResolvedValueOnce(decisionFixture() as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: EMP } as never);

      await expectHttpError(
        rejectTimesheet({
          timesheetId: 'ts-1',
          approverId: 'user-1',
          approverRole: 'MANAGER',
          comment: 'Nope',
          actorId: 'user-1',
          actorName: 'Emma',
        }),
        403,
        'own timesheet',
      );
    });

    it('rejects, unlocks editing, logs the decision and emails the comment', async () => {
      mocked.timesheetFindFirst
        .mockResolvedValueOnce(decisionFixture() as never)
        .mockResolvedValueOnce(detailFixture({ status: TimesheetStatus.REJECTED }) as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-1' } as never);
      mocked.approvalCreate.mockResolvedValue({} as never);
      mocked.timesheetUpdate.mockResolvedValue({} as never);

      const result = await rejectTimesheet({
        timesheetId: 'ts-1',
        approverId: 'user-mgr',
        approverRole: 'MANAGER',
        comment: 'Missing Tuesday hours',
        actorId: 'user-mgr',
        actorName: 'Marcus Manager',
      });

      expect(mocked.approvalCreate).toHaveBeenCalledWith({
        data: {
          timesheet_id: 'ts-1',
          approver_id: 'user-mgr',
          action: 'REJECT',
          comment: 'Missing Tuesday hours',
        },
      });
      expect(mocked.timesheetUpdate).toHaveBeenCalledWith({
        where: { id: 'ts-1' },
        data: { status: TimesheetStatus.REJECTED },
      });
      expect(mocked.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REJECT', entity: 'TIMESHEET', entityId: 'ts-1' }),
      );
      expect(mocked.sendTimesheetStatusEmail).toHaveBeenCalledWith(
        'emma@example.com',
        'Emma Employee',
        'Emma Employee',
        '2026-09-14 to 2026-09-20',
        'rejected',
        'Missing Tuesday hours',
      );
      expect(result.status).toBe(TimesheetStatus.REJECTED);
    });
  });
});
