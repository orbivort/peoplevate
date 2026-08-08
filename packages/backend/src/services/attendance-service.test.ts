import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceType, LeaveRequestStatus } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    leaveAccrual: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    employee: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    attendanceRecord: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    leaveType: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    leavePolicyGroup: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    leavePolicyGroupEntitlement: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    leavePolicyAssignment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    leaveEntitlement: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    leaveBalance: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    holiday: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    leaveRequest: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    leaveApproval: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../utils/audit-context.js', () => ({
  withAuditContext: vi.fn(
    (_prisma: unknown, _actorId: string, _actorName: string, cb: (tx: unknown) => unknown) =>
      cb(prisma),
  ),
}));

vi.mock('../config/env.js', () => ({
  env: {
    PROBATION_DEFAULT_MONTHS: 6,
    ATTENDANCE_GRACE_MINUTES: 5,
    ATTENDANCE_END_OF_BUSINESS: '17:00',
  },
}));

vi.mock('../config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./email-service.js', () => ({
  sendLeaveStatusEmail: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import { withAuditContext } from '../utils/audit-context.js';
import { sendLeaveStatusEmail } from './email-service.js';
import {
  approveLeaveRequest,
  clockInOut,
  createLeaveType,
  createPolicyGroup,
  deleteHoliday,
  deletePolicyGroup,
  getDailySummaries,
  listEmployeeAssignments,
  listHolidays,
  listLeaveRequests,
  listLeaveTypes,
  listPolicyGroups,
  rejectLeaveRequest,
  runLeaveAccrual,
  submitLeaveRequest,
  truncateIpAddress,
  updateLeaveType,
  upsertHoliday,
} from './attendance-service.js';

const mocked = {
  attendanceRecordFindFirst: vi.mocked(prisma.attendanceRecord.findFirst),
  attendanceRecordCreate: vi.mocked(prisma.attendanceRecord.create),
  attendanceRecordFindMany: vi.mocked(prisma.attendanceRecord.findMany),
  leaveTypeFindMany: vi.mocked(prisma.leaveType.findMany),
  leaveTypeFindFirst: vi.mocked(prisma.leaveType.findFirst),
  leaveTypeCreate: vi.mocked(prisma.leaveType.create),
  leaveTypeUpdate: vi.mocked(prisma.leaveType.update),
  leavePolicyGroupCreate: vi.mocked(prisma.leavePolicyGroup.create),
  leavePolicyGroupFindFirst: vi.mocked(prisma.leavePolicyGroup.findFirst),
  leavePolicyGroupFindMany: vi.mocked(prisma.leavePolicyGroup.findMany),
  leavePolicyGroupUpdate: vi.mocked(prisma.leavePolicyGroup.update),
  policyEntitlementUpdateMany: vi.mocked(prisma.leavePolicyGroupEntitlement.updateMany),
  policyAssignmentFindMany: vi.mocked(prisma.leavePolicyAssignment.findMany),
  holidayFindMany: vi.mocked(prisma.holiday.findMany),
  holidayFindFirst: vi.mocked(prisma.holiday.findFirst),
  holidayCreate: vi.mocked(prisma.holiday.create),
  holidayUpdate: vi.mocked(prisma.holiday.update),
  leaveRequestFindMany: vi.mocked(prisma.leaveRequest.findMany),
  leaveRequestFindFirst: vi.mocked(prisma.leaveRequest.findFirst),
  leaveRequestCount: vi.mocked(prisma.leaveRequest.count),
  leaveRequestCreate: vi.mocked(prisma.leaveRequest.create),
  leaveRequestUpdate: vi.mocked(prisma.leaveRequest.update),
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  employeeFindMany: vi.mocked(prisma.employee.findMany),
  leaveApprovalCreate: vi.mocked(prisma.leaveApproval.create),
  leaveBalanceFindFirst: vi.mocked(prisma.leaveBalance.findFirst),
  leaveBalanceCreate: vi.mocked(prisma.leaveBalance.create),
  leaveBalanceUpdate: vi.mocked(prisma.leaveBalance.update),
  withAuditContext: vi.mocked(withAuditContext),
  sendLeaveStatusEmail: vi.mocked(sendLeaveStatusEmail),
};

/** Build an attendance record at a specific wall-clock time on the given day. */
function recordAt(type: AttendanceType, hour: number, minute = 0, day = new Date()): unknown {
  const ts = new Date(day);
  ts.setHours(hour, minute, 0, 0);
  return { id: `rec-${type}-${hour}`, type, timestamp: ts };
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
    if (message) {
      expect((err as Error).message).toContain(message);
    }
    return;
  }
  throw new Error(`Expected HTTP error ${status} but promise resolved`);
}

describe('attendance-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('listLeaveTypes', () => {
    it('returns all non-deleted leave types', async () => {
      mocked.leaveTypeFindMany.mockResolvedValue([{ id: 'lt1' }] as never);

      await listLeaveTypes();

      expect(mocked.leaveTypeFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('createLeaveType', () => {
    it('creates a leave type with accrual config', async () => {
      mocked.leaveTypeCreate.mockResolvedValue({ id: 'lt-new' } as never);

      await createLeaveType({
        name: 'Annual',
        accrualRate: 1.5,
        carryForwardPolicy: 'NONE',
        approvalLevels: 1,
        autoApproveSickDays: 2,
        actorId: 'u-1',
        actorName: 'Jane',
      });

      expect(mocked.leaveTypeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Annual',
          accrual_rate: 1.5,
          approval_levels: 1,
        }),
      });
    });
  });

  describe('updateLeaveType', () => {
    it('sends only the provided fields', async () => {
      mocked.leaveTypeUpdate.mockResolvedValue({ id: 'lt1' } as never);

      await updateLeaveType('lt1', { name: 'Sick' });

      expect(mocked.leaveTypeUpdate).toHaveBeenCalledWith({
        where: { id: 'lt1' },
        data: { name: 'Sick' },
      });
    });

    it('maps every optional field when all are supplied', async () => {
      mocked.leaveTypeUpdate.mockResolvedValue({ id: 'lt1' } as never);

      await updateLeaveType('lt1', {
        name: 'Annual',
        accrualRate: 2,
        carryForwardPolicy: 'CAPPED',
        maxConsecutiveDays: 10,
        approvalLevels: 2,
        autoApproveSickDays: 1,
      });

      expect(mocked.leaveTypeUpdate).toHaveBeenCalledWith({
        where: { id: 'lt1' },
        data: {
          name: 'Annual',
          accrual_rate: 2,
          carry_forward_policy: 'CAPPED',
          max_consecutive_days: 10,
          approval_levels: 2,
          auto_approve_sick_days: 1,
        },
      });
    });

    it('issues an empty update when no fields change', async () => {
      mocked.leaveTypeUpdate.mockResolvedValue({ id: 'lt1' } as never);

      await updateLeaveType('lt1', {});

      expect(mocked.leaveTypeUpdate).toHaveBeenCalledWith({ where: { id: 'lt1' }, data: {} });
    });
  });

  describe('createPolicyGroup', () => {
    it('creates a policy group with nested entitlements', async () => {
      mocked.leavePolicyGroupCreate.mockResolvedValue({ id: 'pg-new' } as never);

      const result = (await createPolicyGroup({
        name: 'Standard',
        year: 2026,
        entitlements: [{ leaveTypeId: 'lt1', annualDays: 20, carryForwardDays: 5 }],
        actorId: 'u-1',
        actorName: 'Jane',
      })) as { id: string };

      expect(result.id).toBe('pg-new');
      expect(mocked.leavePolicyGroupCreate).toHaveBeenCalled();
      expect(mocked.leavePolicyGroupCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Standard', year: 2026 }),
        }),
      );
    });

    it('throws 409 when a group for the year already exists', async () => {
      mocked.leavePolicyGroupFindFirst.mockResolvedValue({ id: 'existing' } as never);

      await expectHttpError(
        createPolicyGroup({
          name: 'Standard',
          year: 2026,
          entitlements: [],
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        409,
        'already exists',
      );
    });
  });

  describe('listPolicyGroups', () => {
    it('filters by year and attaches a headcount excluding manual overrides', async () => {
      mocked.leavePolicyGroupFindMany.mockResolvedValue([
        { id: 'pg1', employment_type: 'FULL_TIME', grades: ['G1'], department_id: 'd1' },
      ] as never);
      mocked.policyAssignmentFindMany.mockResolvedValue([{ employee_id: 'e2' }] as never);
      mocked.employeeFindMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }] as never);

      const result = (await listPolicyGroups({ year: 2026 })) as { headcount: number }[];

      // e2 has a manual override, so only e1 counts.
      expect(result[0]?.headcount).toBe(1);
      expect(mocked.leavePolicyGroupFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null, year: 2026 } }),
      );
    });

    it('omits the year filter when no year is supplied', async () => {
      mocked.leavePolicyGroupFindMany.mockResolvedValue([] as never);

      await listPolicyGroups({ year: undefined });

      expect(mocked.leavePolicyGroupFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null } }),
      );
    });

    it('builds an eligibility filter without optional criteria', async () => {
      mocked.leavePolicyGroupFindMany.mockResolvedValue([
        { id: 'pg2', employment_type: null, grades: [], department_id: null },
      ] as never);
      mocked.policyAssignmentFindMany.mockResolvedValue([] as never);
      mocked.employeeFindMany.mockResolvedValue([{ id: 'e1' }] as never);

      const result = (await listPolicyGroups({ year: 2026 })) as { headcount: number }[];

      expect(result[0]?.headcount).toBe(1);
      expect(mocked.employeeFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null, status: { not: 'TERMINATED' } },
        select: { id: true },
      });
    });
  });

  describe('deletePolicyGroup', () => {
    it('throws 404 when the group does not exist', async () => {
      mocked.leavePolicyGroupFindFirst.mockResolvedValue(null as never);

      await expectHttpError(deletePolicyGroup('missing'), 404);
    });

    it('soft-deletes the group and its entitlements', async () => {
      mocked.leavePolicyGroupFindFirst.mockResolvedValue({ id: 'pg1' } as never);
      mocked.policyEntitlementUpdateMany.mockResolvedValue({ count: 2 } as never);
      mocked.leavePolicyGroupUpdate.mockResolvedValue({ id: 'pg1' } as never);

      await deletePolicyGroup('pg1');

      expect(mocked.policyEntitlementUpdateMany).toHaveBeenCalledWith({
        where: { policy_group_id: 'pg1', deleted_at: null },
        data: { deleted_at: expect.any(Date) },
      });
      expect(mocked.leavePolicyGroupUpdate).toHaveBeenCalledWith({
        where: { id: 'pg1' },
        data: { deleted_at: expect.any(Date) },
      });
    });
  });

  describe('listHolidays', () => {
    it('returns holidays ordered by date', async () => {
      mocked.holidayFindMany.mockResolvedValue([] as never);

      await listHolidays({});

      expect(mocked.holidayFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null },
        orderBy: { date: 'asc' },
      });
    });

    it('filters by year when provided', async () => {
      mocked.holidayFindMany.mockResolvedValue([] as never);

      await listHolidays({ year: 2026 });

      expect(mocked.holidayFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null, year: 2026 },
        orderBy: { date: 'asc' },
      });
    });
  });

  describe('createHoliday', () => {
    it('creates a holiday', async () => {
      mocked.holidayFindFirst.mockResolvedValue(null);
      mocked.holidayCreate.mockResolvedValue({ id: 'h1' } as never);

      await upsertHoliday({
        name: 'New Year',
        date: new Date('2026-01-01'),
        year: 2026,
        type: 'PUBLIC',
        recurring: false,
      });

      expect(mocked.holidayCreate).toHaveBeenCalledWith({
        data: {
          name: 'New Year',
          date: new Date('2026-01-01'),
          year: 2026,
          type: 'PUBLIC',
          recurring: false,
        },
      });
    });
  });

  describe('deleteHoliday', () => {
    it('throws 404 when missing', async () => {
      mocked.holidayFindFirst.mockResolvedValue(null);

      await expectHttpError(deleteHoliday('h-x'), 404, 'Holiday not found');
    });

    it('soft-deletes the holiday', async () => {
      mocked.holidayFindFirst.mockResolvedValue({ id: 'h1' } as never);
      mocked.holidayUpdate.mockResolvedValue({} as never);

      await deleteHoliday('h1');

      expect(mocked.holidayUpdate).toHaveBeenCalledWith({
        where: { id: 'h1' },
        data: { deleted_at: expect.any(Date) },
      });
    });
  });

  describe('getDailySummaries', () => {
    beforeEach(() => {
      // Sensible defaults: no holiday, no approved leave.
      mocked.holidayFindFirst.mockResolvedValue(null as never);
      mocked.leaveRequestFindFirst.mockResolvedValue(null as never);
    });

    it('returns an empty list when an EMPLOYEE has no employee record', async () => {
      mocked.employeeFindUnique.mockResolvedValue(null as never);

      const result = await getDailySummaries({ role: 'EMPLOYEE', userId: 'u1' });

      expect(result).toEqual([]);
    });

    it('scopes an EMPLOYEE to their own record', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'e1' } as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([] as never);

      const result = (await getDailySummaries({ role: 'EMPLOYEE', userId: 'u1' })) as {
        employeeId: string;
        status: string;
      }[];

      expect(result).toHaveLength(1);
      expect(result[0]?.employeeId).toBe('e1');
      expect(result[0]?.status).toBe('ABSENT');
    });

    it('marks everyone HOLIDAY when the date is a company holiday', async () => {
      mocked.holidayFindFirst.mockResolvedValue({ id: 'h1' } as never);
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'e1', first_name: 'Ann', last_name: 'Lee' },
      ] as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([] as never);

      const result = (await getDailySummaries({ role: 'HR', userId: 'u1' })) as {
        status: string;
        employeeName: string;
      }[];

      expect(result[0]?.status).toBe('HOLIDAY');
      expect(result[0]?.employeeName).toBe('Ann Lee');
    });

    it('marks ON_LEAVE when an approved leave covers the date', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'e1', first_name: 'Ann', last_name: 'Lee' },
      ] as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([] as never);
      mocked.leaveRequestFindFirst.mockResolvedValue({
        id: 'lr1',
        status: LeaveRequestStatus.APPROVED,
      } as never);

      const result = (await getDailySummaries({ role: 'HR', userId: 'u1' })) as {
        status: string;
      }[];

      expect(result[0]?.status).toBe('ON_LEAVE');
    });

    it('computes PRESENT with total hours for an on-time full day', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'e1', first_name: 'Ann', last_name: 'Lee' },
      ] as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([
        recordAt(AttendanceType.IN, 8, 30),
        recordAt(AttendanceType.OUT, 17, 30),
      ] as never);

      const result = (await getDailySummaries({ role: 'HR', userId: 'u1' })) as {
        status: string;
        totalHours: number;
      }[];

      expect(result[0]?.status).toBe('PRESENT');
      expect(result[0]?.totalHours).toBe(9);
    });

    it('flags LATE when clocking in after the grace window', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'e1', first_name: 'Ann', last_name: 'Lee' },
      ] as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([
        recordAt(AttendanceType.IN, 10, 0),
        recordAt(AttendanceType.OUT, 18, 0),
      ] as never);

      const result = (await getDailySummaries({ role: 'HR', userId: 'u1' })) as {
        status: string;
      }[];

      expect(result[0]?.status).toBe('LATE');
    });

    it('flags EARLY_DEPARTURE when leaving before end of business', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'e1', first_name: 'Ann', last_name: 'Lee' },
      ] as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([
        recordAt(AttendanceType.IN, 8, 0),
        recordAt(AttendanceType.OUT, 15, 0),
      ] as never);

      const result = (await getDailySummaries({ role: 'HR', userId: 'u1' })) as {
        status: string;
      }[];

      expect(result[0]?.status).toBe('EARLY_DEPARTURE');
    });

    it('flags LATE_EARLY_DEPARTURE when both conditions hold', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'e1', first_name: 'Ann', last_name: 'Lee' },
      ] as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([
        recordAt(AttendanceType.IN, 11, 0),
        recordAt(AttendanceType.OUT, 15, 0),
      ] as never);

      const result = (await getDailySummaries({ role: 'HR', userId: 'u1' })) as {
        status: string;
      }[];

      expect(result[0]?.status).toBe('LATE_EARLY_DEPARTURE');
    });

    it('returns an empty list when a MANAGER has no employee record', async () => {
      mocked.employeeFindUnique.mockResolvedValue(null as never);

      const result = await getDailySummaries({ role: 'MANAGER', userId: 'u1' });

      expect(result).toEqual([]);
    });

    it('lists direct reports for a MANAGER without an explicit employeeId', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-1' } as never);
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'e2', first_name: 'Bob', last_name: 'Ray' },
      ] as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([] as never);

      await getDailySummaries({ role: 'MANAGER', userId: 'u1' });

      expect(mocked.employeeFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { manager_id: 'mgr-1' } }),
      );
    });

    it('scopes a MANAGER to a specific employeeId when provided', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'e2', first_name: 'Bob', last_name: 'Ray' },
      ] as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([] as never);

      await getDailySummaries({ role: 'MANAGER', userId: 'u1', employeeId: 'e2' });

      expect(mocked.employeeFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'e2' } }),
      );
    });

    it('filters by employeeId for an admin role and honours an explicit date', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'e3', first_name: 'Cat', last_name: 'Poe' },
      ] as never);
      mocked.attendanceRecordFindMany.mockResolvedValue([] as never);

      await getDailySummaries({ role: 'HR', userId: 'u1', employeeId: 'e3', date: '2026-03-10' });

      expect(mocked.employeeFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'e3' } }),
      );
    });
  });

  describe('listEmployeeAssignments', () => {
    it('flattens employee entitlements and manual assignments', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'e1',
          employee_no: 'E-001',
          first_name: 'Ann',
          last_name: 'Lee',
          employment_type: 'FULL_TIME',
          department: { name: 'Eng' },
          position: { name: 'Dev', grade: 'G2' },
          hire_date: new Date('2025-01-01'),
          leave_entitlements: [
            {
              leave_type_id: 'lt1',
              leave_type: { name: 'Annual' },
              annual_entitlement: 20,
              source: 'POLICY_GROUP',
              policy_group: { name: 'Standard' },
            },
          ],
          leave_policy_assignments: [{ policy_group: { id: 'pg1', name: 'Standard' } }],
        },
      ] as never);

      const result = (await listEmployeeAssignments({ year: 2026 })) as {
        name: string;
        department: string;
        manual_assignment: { name: string } | null;
        entitlements: { policy_group: string | null }[];
      }[];

      expect(result[0]?.name).toBe('Ann Lee');
      expect(result[0]?.department).toBe('Eng');
      expect(result[0]?.manual_assignment).toEqual({ id: 'pg1', name: 'Standard' });
      expect(result[0]?.entitlements[0]?.policy_group).toBe('Standard');
    });

    it('handles employees with no department, position, or assignments', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'e2',
          employee_no: 'E-002',
          first_name: 'Bob',
          last_name: 'Ray',
          employment_type: 'PART_TIME',
          department: null,
          position: null,
          hire_date: new Date('2025-06-01'),
          leave_entitlements: [
            {
              leave_type_id: 'lt2',
              leave_type: { name: 'Sick' },
              annual_entitlement: 10,
              source: 'MANUAL',
              policy_group: null,
            },
          ],
          leave_policy_assignments: [],
        },
      ] as never);

      const result = (await listEmployeeAssignments({ year: 2026 })) as {
        department: string | undefined;
        position: string | undefined;
        manual_assignment: unknown;
        entitlements: { policy_group: string | null }[];
      }[];

      expect(result[0]?.department).toBeUndefined();
      expect(result[0]?.position).toBeUndefined();
      expect(result[0]?.manual_assignment).toBeNull();
      expect(result[0]?.entitlements[0]?.policy_group).toBeNull();
    });
  });

  describe('submitLeaveRequest', () => {
    it('throws 400 when start date is after end date', async () => {
      await expectHttpError(
        submitLeaveRequest({
          employeeId: 'emp-1',
          leaveTypeId: 'lt1',
          startDate: new Date('2026-06-10'),
          endDate: new Date('2026-06-01'),
          submittedBy: 'u-1',
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        400,
        'Start date must be before end date',
      );
    });

    it('throws 404 when the leave type is missing', async () => {
      mocked.leaveTypeFindFirst.mockResolvedValue(null);

      await expectHttpError(
        submitLeaveRequest({
          employeeId: 'emp-1',
          leaveTypeId: 'lt-x',
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-06-10'),
          submittedBy: 'u-1',
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        404,
        'Leave type not found',
      );
    });

    it('creates a PENDING_MANAGER_APPROVAL leave request', async () => {
      mocked.leaveTypeFindFirst.mockResolvedValue({
        id: 'lt1',
        approval_levels: 1,
        auto_approve_sick_days: 0,
        name: 'Annual',
      } as never);
      mocked.leaveRequestFindFirst.mockResolvedValue(null);
      mocked.leaveRequestCreate.mockResolvedValue({ id: 'lr1' } as never);

      const result = (await submitLeaveRequest({
        employeeId: 'emp-1',
        leaveTypeId: 'lt1',
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-05'),
        reason: 'r',
        submittedBy: 'u-1',
        actorId: 'u-1',
        actorName: 'Jane',
      })) as { request: { id: string } };

      expect(result.request.id).toBe('lr1');
      expect(mocked.leaveRequestCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employee_id: 'emp-1',
          leave_type_id: 'lt1',
          status: LeaveRequestStatus.PENDING_MANAGER_APPROVAL,
        }),
      });
    });
  });

  describe('approveLeaveRequest', () => {
    it('throws 404 when the request is missing', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue(null);

      await expectHttpError(
        approveLeaveRequest({ leaveRequestId: 'lr-x', approverId: 'u-1', approverRole: 'ADMIN' }),
        404,
        'Leave request not found',
      );
    });

    it('throws 400 when already in a non-approvable status', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue({
        id: 'lr1',
        status: LeaveRequestStatus.REJECTED,
        leave_type: { approval_levels: 1 },
        employee: { email: 'e@x.com', first_name: 'J', last_name: 'D' },
      } as never);

      await expectHttpError(
        approveLeaveRequest({ leaveRequestId: 'lr1', approverId: 'u-1', approverRole: 'ADMIN' }),
        400,
        'Cannot approve',
      );
    });

    it('advances to HR approval for two-level policies without balance deduction', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue({
        id: 'lr1',
        status: LeaveRequestStatus.PENDING_MANAGER_APPROVAL,
        employee_id: 'emp-1',
        leave_type_id: 'lt1',
        days: 3,
        leave_type: { approval_levels: 2, name: 'Annual' },
        employee: { email: 'e@x.com', first_name: 'J', last_name: 'D' },
      } as never);
      mocked.leaveApprovalCreate.mockResolvedValue({} as never);
      mocked.leaveRequestUpdate.mockResolvedValue({} as never);

      await approveLeaveRequest({
        leaveRequestId: 'lr1',
        approverId: 'u-1',
        approverRole: 'HR_MANAGER',
      });

      expect(mocked.leaveRequestUpdate).toHaveBeenCalledWith({
        where: { id: 'lr1' },
        data: { status: LeaveRequestStatus.PENDING_HR_APPROVAL },
      });
      expect(mocked.sendLeaveStatusEmail).not.toHaveBeenCalled();
    });
  });

  describe('rejectLeaveRequest', () => {
    it('throws 404 when the request is missing', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue(null);

      await expectHttpError(
        rejectLeaveRequest({ leaveRequestId: 'lr-x', approverId: 'u-1', approverRole: 'ADMIN' }),
        404,
        'Leave request not found',
      );
    });

    it('rejects the request and notifies the employee', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue({
        id: 'lr1',
        status: LeaveRequestStatus.PENDING_MANAGER_APPROVAL,
        leave_type: { name: 'Annual' },
        employee: { email: 'e@x.com', first_name: 'J', last_name: 'D' },
      } as never);
      mocked.leaveRequestUpdate.mockResolvedValue({} as never);

      await rejectLeaveRequest({ leaveRequestId: 'lr1', approverId: 'u-1', approverRole: 'ADMIN' });

      expect(mocked.leaveRequestUpdate).toHaveBeenCalledWith({
        where: { id: 'lr1' },
        data: { status: LeaveRequestStatus.REJECTED },
      });
      expect(mocked.sendLeaveStatusEmail).toHaveBeenCalledWith(
        'e@x.com',
        'J D',
        'Rejected',
        'Annual',
      );
    });
  });

  describe('listLeaveRequests', () => {
    it('scopes to the employee for EMPLOYEE role', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-1' } as never);
      mocked.leaveRequestFindMany.mockResolvedValue([] as never);

      await listLeaveRequests({ role: 'EMPLOYEE', userId: 'u-1' });

      const where = mocked.leaveRequestFindMany.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.employee_id).toBe('emp-1');
    });

    it('scopes to direct reports for MANAGER role', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-mgr' } as never);
      mocked.employeeFindMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }] as never);
      mocked.leaveRequestFindMany.mockResolvedValue([] as never);

      await listLeaveRequests({
        role: 'MANAGER',
        userId: 'u-1',
        status: LeaveRequestStatus.PENDING_MANAGER_APPROVAL,
      });

      const where = mocked.leaveRequestFindMany.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.employee_id).toEqual({ in: ['emp-1', 'emp-2', 'emp-mgr'] });
      expect(where.status).toBe(LeaveRequestStatus.PENDING_MANAGER_APPROVAL);
    });
  });

  describe('clockInOut', () => {
    it('throws 400 when already clocked in that day', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue(null);
      mocked.attendanceRecordFindFirst.mockResolvedValue({ id: 'ar1' } as never);

      await expectHttpError(
        clockInOut({
          employeeId: 'emp-1',
          type: AttendanceType.IN,
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        400,
        'Already clocked in',
      );
    });

    it('rejects clock-in while on approved leave', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue({ id: 'lr-1' } as never);

      await expectHttpError(
        clockInOut({
          employeeId: 'e1',
          type: AttendanceType.IN,
          actorId: 'u1',
          actorName: 'Jane',
        }),
        400,
      );
      expect(mocked.attendanceRecordCreate).not.toHaveBeenCalled();
    });

    it('creates a clock-in attendance record', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue(null);
      mocked.attendanceRecordFindFirst.mockResolvedValue(null);
      mocked.attendanceRecordCreate.mockResolvedValue({ id: 'ar-new' } as never);

      const result = (await clockInOut({
        employeeId: 'emp-1',
        type: AttendanceType.IN,
        actorId: 'u-1',
        actorName: 'Jane',
      })) as {
        record: { id: string };
        duplicateWarning: boolean;
      };

      expect(result.record.id).toBe('ar-new');
      expect(result.duplicateWarning).toBe(false);
      expect(mocked.attendanceRecordCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ employee_id: 'emp-1', type: AttendanceType.IN }),
      });
    });

    it('creates a clock-in record and stores the ip address', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue(null);
      mocked.attendanceRecordFindFirst.mockResolvedValue(null as never);
      mocked.attendanceRecordCreate.mockResolvedValue({ id: 'rec-1' } as never);

      const result = (await clockInOut({
        employeeId: 'e1',
        type: AttendanceType.IN,
        ipAddress: '10.0.0.5',
        actorId: 'u1',
        actorName: 'Jane',
      })) as { duplicateWarning: boolean; missingClockInFlag: boolean };

      expect(result.duplicateWarning).toBe(false);
      expect(result.missingClockInFlag).toBe(false);
      expect(mocked.attendanceRecordCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employee_id: 'e1',
          // IP is truncated for data minimization (GDPR) before storage.
          ip_address: '10.0.0.0',
        }),
      });
    });

    it('auto-creates a missing clock-in when clocking out', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue(null);
      mocked.attendanceRecordFindFirst.mockResolvedValue(null);
      mocked.attendanceRecordCreate.mockResolvedValue({ id: 'ar-out' } as never);

      const result = (await clockInOut({
        employeeId: 'emp-1',
        type: AttendanceType.OUT,
        actorId: 'u-1',
        actorName: 'Jane',
      })) as {
        missingClockInFlag: boolean;
      };

      expect(result.missingClockInFlag).toBe(true);
      expect(mocked.attendanceRecordCreate).toHaveBeenCalledTimes(2);
    });

    it('does not back-fill when a clock-in already exists for the day', async () => {
      mocked.leaveRequestFindFirst.mockResolvedValue(null);
      mocked.attendanceRecordFindFirst.mockResolvedValue({ id: 'rec-in' } as never);
      mocked.attendanceRecordCreate.mockResolvedValue({ id: 'rec-out' } as never);

      const result = (await clockInOut({
        employeeId: 'e1',
        type: AttendanceType.OUT,
        actorId: 'u1',
        actorName: 'Jane',
      })) as { missingClockInFlag: boolean };

      expect(result.missingClockInFlag).toBe(false);
      expect(mocked.attendanceRecordCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('runLeaveAccrual', () => {
    it('increments an existing balance for each employee', async () => {
      mocked.leaveTypeFindMany.mockResolvedValue([{ id: 'lt1', accrual_rate: 1.5 }] as never);
      mocked.employeeFindMany.mockResolvedValue([{ id: 'e1' }] as never);
      mocked.leaveBalanceFindFirst.mockResolvedValue({ id: 'lb1' } as never);
      mocked.leaveBalanceUpdate.mockResolvedValue({ id: 'lb1' } as never);

      await runLeaveAccrual();

      expect(mocked.leaveBalanceUpdate).toHaveBeenCalledWith({
        where: { id: 'lb1' },
        data: { accrued_days: { increment: 1.5 } },
      });
      expect(mocked.leaveBalanceCreate).not.toHaveBeenCalled();
    });

    it('creates a balance when none exists yet', async () => {
      mocked.leaveTypeFindMany.mockResolvedValue([{ id: 'lt1', accrual_rate: 2 }] as never);
      mocked.employeeFindMany.mockResolvedValue([{ id: 'e1' }] as never);
      mocked.leaveBalanceFindFirst.mockResolvedValue(null as never);
      mocked.leaveBalanceCreate.mockResolvedValue({ id: 'lb-new' } as never);

      await runLeaveAccrual();

      expect(mocked.leaveBalanceCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employee_id: 'e1',
          leave_type_id: 'lt1',
          accrued_days: 2,
        }),
      });
    });

    it('does nothing when no accruing leave types exist', async () => {
      mocked.leaveTypeFindMany.mockResolvedValue([] as never);
      mocked.employeeFindMany.mockResolvedValue([{ id: 'e1' }] as never);

      await runLeaveAccrual();

      expect(mocked.leaveBalanceFindFirst).not.toHaveBeenCalled();
      expect(mocked.leaveBalanceCreate).not.toHaveBeenCalled();
    });
  });

  describe('truncateIpAddress', () => {
    it('returns null for missing values', () => {
      expect(truncateIpAddress(undefined)).toBeNull();
      expect(truncateIpAddress('')).toBeNull();
    });

    it('zeroes the last octet of an IPv4 address', () => {
      expect(truncateIpAddress('192.168.1.100')).toBe('192.168.1.0');
      expect(truncateIpAddress('10.0.0.5')).toBe('10.0.0.0');
    });

    it('truncates an IPv6 address to the first four groups', () => {
      const truncated = truncateIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
      expect(truncated?.startsWith('2001:0db8:85a3:')).toBe(true);
      expect(truncated?.includes('8a2e')).toBe(false);
    });

    it('returns the value unchanged for short or non-IP input', () => {
      expect(truncateIpAddress('10.0.0')).toBe('10.0.0');
    });
  });
});
