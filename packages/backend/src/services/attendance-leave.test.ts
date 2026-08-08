import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaveRequestStatus } from '#prisma';

const txMock = vi.hoisted(() => ({
  leaveRequest: { create: vi.fn(), update: vi.fn() },
  leaveApproval: { create: vi.fn() },
  leaveBalance: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    employee: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    leaveType: { findFirst: vi.fn(), findMany: vi.fn() },
    leaveRequest: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    leaveEntitlement: { findFirst: vi.fn() },
    leaveBalance: { findFirst: vi.fn() },
  },
}));

vi.mock('../utils/audit-context.js', () => ({
  withAuditContext: vi.fn((_p: unknown, _id: string, _name: string, cb: (tx: unknown) => unknown) =>
    cb(txMock),
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
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('./email-service.js', () => ({ sendLeaveStatusEmail: vi.fn() }));

import { prisma } from '../config/prisma.js';
import { sendLeaveStatusEmail } from './email-service.js';
import {
  approveLeaveRequest,
  listLeaveRequests,
  rejectLeaveRequest,
  submitLeaveRequest,
} from './attendance-service.js';

const m = {
  empFindUnique: vi.mocked(prisma.employee.findUnique),
  empFindMany: vi.mocked(prisma.employee.findMany),
  empFindFirst: vi.mocked(prisma.employee.findFirst),
  leaveTypeFindFirst: vi.mocked(prisma.leaveType.findFirst),
  reqFindFirst: vi.mocked(prisma.leaveRequest.findFirst),
  reqFindMany: vi.mocked(prisma.leaveRequest.findMany),
  reqUpdate: vi.mocked(prisma.leaveRequest.update),
  reqAggregate: vi.mocked(prisma.leaveRequest.aggregate),
  entitlementFindFirst: vi.mocked(prisma.leaveEntitlement.findFirst),
};

const EMPLOYEE = {
  email: 'emp@test.com',
  first_name: 'Ann',
  last_name: 'Lee',
};

/** Build a leave request row with sensible defaults. */
function buildRequest(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'lr1',
    employee_id: 'e1',
    leave_type_id: 'lt1',
    days: 3,
    status: LeaveRequestStatus.PENDING_MANAGER_APPROVAL,
    employee: EMPLOYEE,
    leave_type: {
      id: 'lt1',
      name: 'Annual',
      approval_levels: 1,
      auto_approve_sick_days: 0,
    },
    ...overrides,
  };
}

async function expectHttpError(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect((err as { status: number }).status).toBe(status);
    return;
  }
  throw new Error(`Expected HTTP error ${status} but promise resolved`);
}

/** Give the employee plenty of entitlement so deductBalance succeeds. */
function allowBalance(): void {
  m.entitlementFindFirst.mockResolvedValue({ annual_entitlement: 30 } as never);
  m.reqAggregate.mockResolvedValue({ _sum: { days: 0 } } as never);
}

/**
 * Configure `isManagerOf`, which resolves the approver via `employee.findUnique`
 * and the target via `employee.findFirst`, then compares target.manager_id.
 */
function setManagerOf(isManager: boolean): void {
  m.empFindUnique.mockResolvedValue({ id: 'mgr-emp' } as never);
  m.empFindFirst.mockResolvedValue({
    id: 'e1',
    manager_id: isManager ? 'mgr-emp' : 'someone-else',
  } as never);
}

describe('attendance-service leave workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txMock.leaveRequest.create.mockResolvedValue({ id: 'lr-new' });
    txMock.leaveRequest.update.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: 'lr1',
      ...(data as object),
    }));
    txMock.leaveApproval.create.mockResolvedValue({ id: 'la1' });
    txMock.leaveBalance.findFirst.mockResolvedValue(null);
    txMock.leaveBalance.update.mockResolvedValue({ id: 'lb1' });
    txMock.leaveBalance.create.mockResolvedValue({ id: 'lb1' });
    allowBalance();
  });

  describe('submitLeaveRequest', () => {
    const base = {
      employeeId: 'e1',
      leaveTypeId: 'lt1',
      submittedBy: 'u1',
      actorId: 'u1',
      actorName: 'Ann',
    };

    it('rejects when the start date is after the end date', async () => {
      await expectHttpError(
        submitLeaveRequest({
          ...base,
          startDate: new Date('2026-03-10'),
          endDate: new Date('2026-03-01'),
        }),
        400,
      );
    });

    it('throws 404 when the leave type does not exist', async () => {
      m.leaveTypeFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        submitLeaveRequest({
          ...base,
          startDate: new Date('2026-03-01'),
          endDate: new Date('2026-03-03'),
        }),
        404,
      );
    });

    it('creates a request with computed days and no overlap warning', async () => {
      m.leaveTypeFindFirst.mockResolvedValue({ id: 'lt1' } as never);
      m.reqFindFirst.mockResolvedValue(null as never);

      const result = (await submitLeaveRequest({
        ...base,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-03-03'),
        reason: 'Vacation',
      })) as { overlapWarning: unknown };

      expect(result.overlapWarning).toBeNull();
      expect(txMock.leaveRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ days: 3, reason: 'Vacation', attachment_path: null }),
      });
    });

    it('returns an overlap warning when approved leave already covers the range', async () => {
      m.leaveTypeFindFirst.mockResolvedValue({ id: 'lt1' } as never);
      m.reqFindFirst.mockResolvedValue({ id: 'existing' } as never);

      const result = (await submitLeaveRequest({
        ...base,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-03-01'),
        attachmentPath: '/docs/note.pdf',
      })) as { overlapWarning: { overlapId: string } };

      expect(result.overlapWarning).toEqual({ overlapId: 'existing' });
      expect(txMock.leaveRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reason: null, attachment_path: '/docs/note.pdf' }),
      });
    });
  });

  describe('approveLeaveRequest', () => {
    it('throws 404 when the request is missing', async () => {
      m.reqFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        approveLeaveRequest({ leaveRequestId: 'x', approverId: 'u1', approverRole: 'ADMIN' }),
        404,
      );
    });

    it('blocks a non-manager from level 1 approval', async () => {
      m.reqFindFirst.mockResolvedValue(buildRequest() as never);
      setManagerOf(false);

      await expectHttpError(
        approveLeaveRequest({
          leaveRequestId: 'lr1',
          approverId: 'u9',
          approverRole: 'EMPLOYEE',
        }),
        403,
      );
    });

    it('approves at level 1 as the manager and deducts balance when single-level', async () => {
      m.reqFindFirst.mockResolvedValue(buildRequest() as never);
      setManagerOf(true);

      await approveLeaveRequest({
        leaveRequestId: 'lr1',
        approverId: 'mgr',
        approverRole: 'MANAGER',
        comment: 'ok',
      });

      expect(txMock.leaveRequest.update).toHaveBeenCalledWith({
        where: { id: 'lr1' },
        data: { status: LeaveRequestStatus.APPROVED },
      });
      expect(txMock.leaveBalance.create).toHaveBeenCalled();
      expect(vi.mocked(sendLeaveStatusEmail)).toHaveBeenCalled();
    });

    it('routes to HR when the leave type requires two approval levels', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({
          leave_type: {
            id: 'lt1',
            name: 'Annual',
            approval_levels: 2,
            auto_approve_sick_days: 0,
          },
        }) as never,
      );

      await approveLeaveRequest({
        leaveRequestId: 'lr1',
        approverId: 'admin',
        approverRole: 'ADMIN',
      });

      expect(txMock.leaveRequest.update).toHaveBeenCalledWith({
        where: { id: 'lr1' },
        data: { status: LeaveRequestStatus.PENDING_HR_APPROVAL },
      });
      // No deduction yet — HR must still approve.
      expect(txMock.leaveBalance.create).not.toHaveBeenCalled();
      expect(vi.mocked(sendLeaveStatusEmail)).not.toHaveBeenCalled();
    });

    it('auto-approves short urgent sick leave even without manager rights', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({
          days: 2,
          leave_type: {
            id: 'lt2',
            name: 'Sick',
            approval_levels: 1,
            auto_approve_sick_days: 2,
          },
        }) as never,
      );
      setManagerOf(false);

      await approveLeaveRequest({
        leaveRequestId: 'lr1',
        approverId: 'u9',
        approverRole: 'EMPLOYEE',
      });

      expect(txMock.leaveApproval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ comment: 'Auto-approved (urgent sick leave)' }),
      });
      expect(txMock.leaveRequest.update).toHaveBeenCalledWith({
        where: { id: 'lr1' },
        data: { status: LeaveRequestStatus.APPROVED },
      });
    });

    it('blocks a non-HR role from final approval', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({ status: LeaveRequestStatus.PENDING_HR_APPROVAL }) as never,
      );

      await expectHttpError(
        approveLeaveRequest({
          leaveRequestId: 'lr1',
          approverId: 'mgr',
          approverRole: 'MANAGER',
        }),
        403,
      );
    });

    it('completes HR final approval and increments an existing balance', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({ status: LeaveRequestStatus.PENDING_HR_APPROVAL }) as never,
      );
      txMock.leaveBalance.findFirst.mockResolvedValue({ id: 'lb1' });

      await approveLeaveRequest({
        leaveRequestId: 'lr1',
        approverId: 'hr',
        approverRole: 'HR_MANAGER',
      });

      expect(txMock.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: 'lb1' },
        data: { used_days: { increment: 3 } },
      });
      expect(vi.mocked(sendLeaveStatusEmail)).toHaveBeenCalled();
    });

    it('rejects final approval when the balance would go negative', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({ status: LeaveRequestStatus.PENDING_HR_APPROVAL }) as never,
      );
      m.entitlementFindFirst.mockResolvedValue({ annual_entitlement: 1 } as never);
      m.reqAggregate.mockResolvedValue({ _sum: { days: 0 } } as never);

      await expectHttpError(
        approveLeaveRequest({ leaveRequestId: 'lr1', approverId: 'hr', approverRole: 'ADMIN' }),
        400,
      );
    });

    it('treats a missing entitlement as zero available days', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({ status: LeaveRequestStatus.PENDING_HR_APPROVAL }) as never,
      );
      m.entitlementFindFirst.mockResolvedValue(null as never);
      m.reqAggregate.mockResolvedValue({ _sum: { days: null } } as never);

      await expectHttpError(
        approveLeaveRequest({ leaveRequestId: 'lr1', approverId: 'hr', approverRole: 'ADMIN' }),
        400,
      );
    });

    it('rejects approval from a terminal status', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({ status: LeaveRequestStatus.REJECTED }) as never,
      );

      await expectHttpError(
        approveLeaveRequest({ leaveRequestId: 'lr1', approverId: 'hr', approverRole: 'ADMIN' }),
        400,
      );
    });
  });

  describe('rejectLeaveRequest', () => {
    beforeEach(() => {
      m.reqUpdate.mockResolvedValue({ id: 'lr1', status: LeaveRequestStatus.REJECTED } as never);
    });

    it('throws 404 when the request is missing', async () => {
      m.reqFindFirst.mockResolvedValue(null as never);

      await expectHttpError(
        rejectLeaveRequest({ leaveRequestId: 'x', approverId: 'u1', approverRole: 'ADMIN' }),
        404,
      );
    });

    it('blocks a non-manager from rejecting a manager-pending request', async () => {
      m.reqFindFirst.mockResolvedValue(buildRequest() as never);
      setManagerOf(false);

      await expectHttpError(
        rejectLeaveRequest({
          leaveRequestId: 'lr1',
          approverId: 'u9',
          approverRole: 'EMPLOYEE',
        }),
        403,
      );
    });

    it('allows the direct manager to reject and notifies the employee', async () => {
      m.reqFindFirst.mockResolvedValue(buildRequest() as never);
      setManagerOf(true);

      await rejectLeaveRequest({
        leaveRequestId: 'lr1',
        approverId: 'mgr',
        approverRole: 'MANAGER',
      });

      expect(m.reqUpdate).toHaveBeenCalledWith({
        where: { id: 'lr1' },
        data: { status: LeaveRequestStatus.REJECTED },
      });
      expect(vi.mocked(sendLeaveStatusEmail)).toHaveBeenCalledWith(
        EMPLOYEE.email,
        'Ann Lee',
        'Rejected',
        'Annual',
      );
    });

    it('lets HR bypass the manager check', async () => {
      m.reqFindFirst.mockResolvedValue(buildRequest() as never);

      await rejectLeaveRequest({
        leaveRequestId: 'lr1',
        approverId: 'hr',
        approverRole: 'HR_MANAGER',
      });

      expect(m.empFindFirst).not.toHaveBeenCalled();
      expect(m.reqUpdate).toHaveBeenCalled();
    });

    it('blocks a manager from rejecting an HR-pending request', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({ status: LeaveRequestStatus.PENDING_HR_APPROVAL }) as never,
      );

      await expectHttpError(
        rejectLeaveRequest({
          leaveRequestId: 'lr1',
          approverId: 'mgr',
          approverRole: 'MANAGER',
        }),
        403,
      );
    });

    it('allows HR to reject an HR-pending request', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({ status: LeaveRequestStatus.PENDING_HR_APPROVAL }) as never,
      );

      await rejectLeaveRequest({
        leaveRequestId: 'lr1',
        approverId: 'hr',
        approverRole: 'ADMIN',
      });

      expect(m.reqUpdate).toHaveBeenCalled();
    });

    it('rejects a request already in a terminal status', async () => {
      m.reqFindFirst.mockResolvedValue(
        buildRequest({ status: LeaveRequestStatus.APPROVED }) as never,
      );

      await expectHttpError(
        rejectLeaveRequest({ leaveRequestId: 'lr1', approverId: 'hr', approverRole: 'ADMIN' }),
        400,
      );
    });
  });

  describe('listLeaveRequests', () => {
    beforeEach(() => {
      m.reqFindMany.mockResolvedValue([] as never);
    });

    it('returns an empty list when an EMPLOYEE has no employee record', async () => {
      m.empFindUnique.mockResolvedValue(null as never);

      expect(await listLeaveRequests({ role: 'EMPLOYEE', userId: 'u1' })).toEqual([]);
      expect(m.reqFindMany).not.toHaveBeenCalled();
    });

    it('scopes an EMPLOYEE to their own requests', async () => {
      m.empFindUnique.mockResolvedValue({ id: 'e1' } as never);

      await listLeaveRequests({ role: 'EMPLOYEE', userId: 'u1' });

      expect(m.reqFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null, employee_id: 'e1' } }),
      );
    });

    it('returns an empty list when a MANAGER has no employee record', async () => {
      m.empFindUnique.mockResolvedValue(null as never);

      expect(await listLeaveRequests({ role: 'MANAGER', userId: 'u1' })).toEqual([]);
    });

    it('includes direct reports and self for a MANAGER', async () => {
      m.empFindUnique.mockResolvedValue({ id: 'mgr' } as never);
      m.empFindMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }] as never);

      await listLeaveRequests({ role: 'MANAGER', userId: 'u1' });

      expect(m.reqFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null, employee_id: { in: ['e1', 'e2', 'mgr'] } },
        }),
      );
    });

    it('filters by employeeId and status for an admin role', async () => {
      await listLeaveRequests({
        role: 'HR_MANAGER',
        userId: 'u1',
        employeeId: 'e5',
        status: 'APPROVED',
      });

      expect(m.reqFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null, employee_id: 'e5', status: 'APPROVED' },
        }),
      );
    });

    it('applies no employee filter for an admin without employeeId', async () => {
      await listLeaveRequests({ role: 'ADMIN', userId: 'u1' });

      expect(m.reqFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null } }),
      );
    });
  });
});
