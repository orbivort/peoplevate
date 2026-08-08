import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmploymentStatus, SeparationType, OffboardingStatus, ClearanceItemStatus } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    offboardingRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    clearanceItem: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    employee: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    exitInterview: {
      create: vi.fn(),
    },
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
    NOTICE_PERIOD_MIN_DAYS: 14,
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
  sendResignationAck: vi.fn(),
  sendDeactivationNotice: vi.fn(),
  sendClearanceReminderEmail: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import { withAuditContext } from '../utils/audit-context.js';
import {
  sendClearanceReminderEmail,
  sendDeactivationNotice,
  sendResignationAck,
} from './email-service.js';
import {
  closeOffboarding,
  conductExitInterview,
  getOffboardingRecord,
  initiateTermination,
  listOffboardingRecords,
  runDeactivationCheck,
  submitResignation,
  updateClearanceItem,
} from './offboarding-service.js';

const mocked = {
  offboardingFindFirst: vi.mocked(prisma.offboardingRecord.findFirst),
  offboardingFindMany: vi.mocked(prisma.offboardingRecord.findMany),
  offboardingCreate: vi.mocked(prisma.offboardingRecord.create),
  offboardingUpdate: vi.mocked(prisma.offboardingRecord.update),
  clearanceCreate: vi.mocked(prisma.clearanceItem.create),
  clearanceFindFirst: vi.mocked(prisma.clearanceItem.findFirst),
  clearanceFindMany: vi.mocked(prisma.clearanceItem.findMany),
  clearanceUpdate: vi.mocked(prisma.clearanceItem.update),
  employeeFindFirst: vi.mocked(prisma.employee.findFirst),
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  employeeUpdate: vi.mocked(prisma.employee.update),
  userFindFirst: vi.mocked(prisma.user.findFirst),
  userUpdate: vi.mocked(prisma.user.update),
  exitInterviewCreate: vi.mocked(prisma.exitInterview.create),
  withAuditContext: vi.mocked(withAuditContext),
  sendResignationAck: vi.mocked(sendResignationAck),
  sendDeactivationNotice: vi.mocked(sendDeactivationNotice),
  sendClearanceReminderEmail: vi.mocked(sendClearanceReminderEmail),
};

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

describe('offboarding-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.clearanceCreate.mockResolvedValue({} as never);
  });

  describe('submitResignation', () => {
    it('flags a notice-period warning when the last working day is too soon', async () => {
      const lastDay = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'emp-1',
        email: 'emp@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
      } as never);
      mocked.offboardingCreate.mockResolvedValue({ id: 'ob-1' } as never);

      const result = (await submitResignation({
        employeeId: 'emp-1',
        lastWorkingDay: lastDay,
        reason: 'Better offer',
        actorId: 'u-1',
        actorName: 'Jane Doe',
      })) as { noticeWarning: boolean };

      expect(result.noticeWarning).toBe(true);
      expect(mocked.offboardingCreate).toHaveBeenCalled();
    });

    it('creates an offboarding record and sends acknowledgement email', async () => {
      const lastDay = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'emp-1',
        email: 'emp@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
      } as never);
      mocked.offboardingCreate.mockResolvedValue({ id: 'ob-1' } as never);

      const result = (await submitResignation({
        employeeId: 'emp-1',
        lastWorkingDay: lastDay,
        reason: 'Better offer',
        actorId: 'u-1',
        actorName: 'Jane Doe',
      })) as { noticeWarning: boolean };

      expect(result.noticeWarning).toBe(false);
      expect(mocked.offboardingCreate).toHaveBeenCalledWith({
        data: {
          employee_id: 'emp-1',
          separation_type: SeparationType.RESIGNATION,
          reason: 'Better offer',
          last_working_day: lastDay,
          deactivation_date: lastDay,
          status: OffboardingStatus.INITIATED,
          initiated_by: 'u-1',
        },
      });
      expect(mocked.clearanceCreate).toHaveBeenCalledTimes(4);
      expect(mocked.sendResignationAck).toHaveBeenCalledWith('emp@example.com', 'Jane Doe');
    });
  });

  describe('initiateTermination', () => {
    it('throws 400 when an offboarding record already exists', async () => {
      mocked.offboardingFindFirst.mockResolvedValue({ id: 'ob-existing' } as never);

      await expectHttpError(
        initiateTermination({
          employeeId: 'emp-1',
          separationType: SeparationType.TERMINATION,
          reason: 'Performance',
          effectiveDate: new Date(Date.now() + 5 * 86400000),
          initiatedBy: 'u-1',
        }),
        400,
        'already has an offboarding record',
      );
    });

    it('creates a termination record with a reason', async () => {
      mocked.offboardingFindFirst.mockResolvedValue(null);
      mocked.employeeFindFirst.mockResolvedValue({ id: 'emp-1' } as never);
      mocked.offboardingCreate.mockResolvedValue({ id: 'ob-2' } as never);

      await initiateTermination({
        employeeId: 'emp-1',
        separationType: SeparationType.TERMINATION,
        reason: 'Performance',
        effectiveDate: new Date(Date.now() + 5 * 86400000),
        initiatedBy: 'u-1',
      });

      expect(mocked.offboardingCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          separation_type: SeparationType.TERMINATION,
          reason: 'Performance',
          status: OffboardingStatus.INITIATED,
          initiated_by: 'u-1',
        }),
      });
    });
  });

  describe('listOffboardingRecords', () => {
    it('returns records filtered by status when provided', async () => {
      mocked.offboardingFindMany.mockResolvedValue([{ id: 'ob-1' }] as never);

      await listOffboardingRecords({
        role: 'HR_MANAGER',
        userId: 'u-1',
        status: OffboardingStatus.INITIATED,
      });

      expect(mocked.offboardingFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: OffboardingStatus.INITIATED }),
        }),
      );
    });

    it('returns all records when no status is provided', async () => {
      mocked.offboardingFindMany.mockResolvedValue([] as never);

      await listOffboardingRecords({ role: 'ADMIN', userId: 'u-1' });

      const where = mocked.offboardingFindMany.mock.calls[0][0].where as Record<string, unknown>;
      expect((where as { deleted_at?: unknown }).deleted_at).toBe(null);
      expect('status' in where).toBe(false);
    });

    it('returns only self records for EMPLOYEE role', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-1' } as never);
      mocked.offboardingFindMany.mockResolvedValue([] as never);

      await listOffboardingRecords({ role: 'EMPLOYEE', userId: 'u-1' });

      expect(mocked.employeeFindUnique).toHaveBeenCalledWith({
        where: { user_id: 'u-1' },
        select: { id: true },
      });
      expect(mocked.offboardingFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ employee_id: 'emp-1' }) }),
      );
    });
  });

  describe('getOffboardingRecord', () => {
    it('throws 404 when the record does not exist', async () => {
      mocked.offboardingFindFirst.mockResolvedValue(null);

      await expectHttpError(getOffboardingRecord('ob-x'), 404, 'Offboarding record not found');
    });

    it('returns the record when found', async () => {
      mocked.offboardingFindFirst.mockResolvedValue({ id: 'ob-1' } as never);

      const result = await getOffboardingRecord('ob-1');

      expect(result).toEqual({ id: 'ob-1' });
      expect(mocked.offboardingFindFirst).toHaveBeenCalledWith({
        where: { id: 'ob-1', deleted_at: null },
        include: expect.any(Object),
      });
    });
  });

  describe('updateClearanceItem', () => {
    it('throws 404 when the item is missing', async () => {
      mocked.clearanceFindFirst.mockResolvedValue(null);

      await expectHttpError(
        updateClearanceItem({
          id: 'item-x',
          status: ClearanceItemStatus.COMPLETE,
          actorId: 'u-1',
          actorRole: 'HR_MANAGER',
        }),
        404,
        'Clearance item not found',
      );
    });

    it('updates the clearance item when present', async () => {
      mocked.clearanceFindFirst.mockResolvedValue({
        id: 'item-1',
        status: ClearanceItemStatus.PENDING,
      } as never);
      mocked.clearanceUpdate.mockResolvedValue({} as never);

      await updateClearanceItem({
        id: 'item-1',
        status: ClearanceItemStatus.COMPLETE,
        actorId: 'u-1',
        actorRole: 'HR_MANAGER',
      });

      expect(mocked.clearanceUpdate).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: {
          status: ClearanceItemStatus.COMPLETE,
          completed_at: expect.any(Date),
          sign_off_by: 'u-1',
        },
      });
    });
  });

  describe('closeOffboarding', () => {
    it('throws 400 when clearance items remain pending', async () => {
      mocked.offboardingFindFirst.mockResolvedValue({
        id: 'ob-1',
        employee_id: 'emp-1',
        status: OffboardingStatus.INITIATED,
      } as never);
      mocked.clearanceFindMany.mockResolvedValue([
        { status: ClearanceItemStatus.COMPLETE },
        { status: ClearanceItemStatus.PENDING },
      ] as never);

      await expectHttpError(closeOffboarding('ob-1', 'u-1', 'HR_MANAGER'), 400, 'pending');
    });

    it('closes the record and terminates the employee when all items are complete', async () => {
      mocked.offboardingFindFirst.mockResolvedValue({
        id: 'ob-1',
        employee_id: 'emp-1',
        deactivation_date: new Date(),
        status: OffboardingStatus.INITIATED,
      } as never);
      mocked.clearanceFindMany.mockResolvedValue([
        { status: ClearanceItemStatus.COMPLETE },
      ] as never);
      mocked.employeeUpdate.mockResolvedValue({} as never);
      mocked.offboardingUpdate.mockResolvedValue({} as never);

      await closeOffboarding('ob-1', 'u-1', 'HR_MANAGER');

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { status: EmploymentStatus.TERMINATED, deactivation_date: expect.any(Date) },
      });
      expect(mocked.offboardingUpdate).toHaveBeenCalledWith({
        where: { id: 'ob-1' },
        data: { status: OffboardingStatus.CLOSED },
      });
    });
  });

  describe('conductExitInterview', () => {
    it('throws 404 when the offboarding record is missing', async () => {
      mocked.offboardingFindFirst.mockResolvedValue(null);

      await expectHttpError(
        conductExitInterview({ offboardingId: 'ob-x', responses: {}, conductedBy: 'u-1' }),
        404,
        'Offboarding record not found',
      );
    });

    it('creates an exit interview record', async () => {
      mocked.offboardingFindFirst.mockResolvedValue({ id: 'ob-1' } as never);
      mocked.exitInterviewCreate.mockResolvedValue({ id: 'ei-1' } as never);

      await conductExitInterview({
        offboardingId: 'ob-1',
        responses: { q1: 'ok' },
        conductedBy: 'u-1',
      });

      expect(mocked.exitInterviewCreate).toHaveBeenCalledWith({
        data: {
          offboarding_id: 'ob-1',
          conducted_by: 'u-1',
          conducted_at: expect.any(Date),
          declined: false,
          responses: { q1: 'ok' },
        },
      });
    });
  });

  describe('runDeactivationCheck', () => {
    it('deactivates users past their deactivation date and sends a notice', async () => {
      const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      mocked.offboardingFindMany.mockResolvedValue([
        {
          id: 'ob-1',
          employee_id: 'emp-1',
          deactivation_date: past,
          employee: {
            id: 'emp-1',
            email: 'emp@example.com',
            first_name: 'Jane',
            last_name: 'Doe',
            user: { id: 'u-1', status: 'ACTIVE' },
          },
        },
      ] as never);
      mocked.userUpdate.mockResolvedValue({} as never);
      mocked.employeeUpdate.mockResolvedValue({} as never);

      await runDeactivationCheck();

      expect(mocked.userUpdate).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { status: 'DEACTIVATED' },
      });
      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { status: EmploymentStatus.TERMINATED },
      });
      expect(mocked.sendDeactivationNotice).toHaveBeenCalledWith('emp@example.com', 'Jane Doe');
    });

    it('skips users already deactivated', async () => {
      const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      mocked.offboardingFindMany.mockResolvedValue([
        {
          id: 'ob-1',
          employee_id: 'emp-1',
          deactivation_date: past,
          employee: {
            id: 'emp-1',
            email: 'e@x.com',
            first_name: 'A',
            last_name: 'B',
            user: { id: 'u-1', status: 'DEACTIVATED' },
          },
        },
      ] as never);

      await runDeactivationCheck();

      expect(mocked.userUpdate).not.toHaveBeenCalled();
      expect(mocked.sendDeactivationNotice).not.toHaveBeenCalled();
    });
  });
});
