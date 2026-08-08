import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeType } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    employmentChange: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    employee: {
      update: vi.fn(),
    },
  },
}));

vi.mock('../utils/crypto.js', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => `dec:${v}`),
  maskValue: vi.fn((v: string) => `masked:${v}`),
}));

import { prisma } from '../config/prisma.js';
import { encrypt } from '../utils/crypto.js';
import {
  applyPendingChange,
  getAllowedChangeTypes,
  listChanges,
  recordChange,
} from './employment-change-service.js';

const mocked = {
  create: vi.mocked(prisma.employmentChange.create),
  findMany: vi.mocked(prisma.employmentChange.findMany),
  findUnique: vi.mocked(prisma.employmentChange.findUnique),
  update: vi.mocked(prisma.employmentChange.update),
  employeeUpdate: vi.mocked(prisma.employee.update),
  encrypt: vi.mocked(encrypt),
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

describe('employment-change-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAllowedChangeTypes', () => {
    it('returns all types for ADMIN and HR_MANAGER', () => {
      expect(getAllowedChangeTypes('ADMIN')).toEqual([
        ChangeType.PROMOTION,
        ChangeType.TRANSFER,
        ChangeType.MANAGER_CHANGE,
        ChangeType.SALARY_ADJUSTMENT,
        ChangeType.STATUS_CHANGE,
      ]);
      expect(getAllowedChangeTypes('HR_MANAGER')).toEqual([
        ChangeType.PROMOTION,
        ChangeType.TRANSFER,
        ChangeType.MANAGER_CHANGE,
        ChangeType.SALARY_ADJUSTMENT,
        ChangeType.STATUS_CHANGE,
      ]);
    });

    it('returns manager-allowed types for MANAGER', () => {
      expect(getAllowedChangeTypes('MANAGER')).toEqual([
        ChangeType.MANAGER_CHANGE,
        ChangeType.STATUS_CHANGE,
      ]);
    });

    it('returns an empty list for EMPLOYEE', () => {
      expect(getAllowedChangeTypes('EMPLOYEE')).toEqual([]);
    });
  });

  describe('recordChange', () => {
    it('throws 403 when the role is not allowed to record the type', async () => {
      await expectHttpError(
        recordChange({
          employeeId: 'emp-1',
          changeType: ChangeType.PROMOTION,
          effectiveDate: new Date(),
          recordedBy: 'u-1',
          role: 'MANAGER',
        }),
        403,
        'not allowed to record this change type',
      );
      expect(mocked.create).not.toHaveBeenCalled();
    });

    it('throws 403 when a manager records for a non-direct report', async () => {
      await expectHttpError(
        recordChange({
          employeeId: 'emp-1',
          changeType: ChangeType.MANAGER_CHANGE,
          effectiveDate: new Date(),
          recordedBy: 'u-1',
          role: 'MANAGER',
          isDirectReport: false,
        }),
        403,
        'direct reports',
      );
      expect(mocked.create).not.toHaveBeenCalled();
    });

    it('creates a PENDING change for a manager and does not apply immediately', async () => {
      mocked.create.mockResolvedValue({} as never);

      await recordChange({
        employeeId: 'emp-1',
        changeType: ChangeType.MANAGER_CHANGE,
        newValue: { managerId: 'emp-2' },
        effectiveDate: new Date(),
        recordedBy: 'u-1',
        role: 'MANAGER',
        isDirectReport: true,
      });

      expect(mocked.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'PENDING',
          change_type: ChangeType.MANAGER_CHANGE,
        }),
      });
      expect(mocked.employeeUpdate).not.toHaveBeenCalled();
    });

    it('applies immediately for HR/Admin and encrypts salary for salary adjustments', async () => {
      mocked.create.mockResolvedValue({} as never);
      mocked.employeeUpdate.mockResolvedValue({} as never);

      await recordChange({
        employeeId: 'emp-1',
        changeType: ChangeType.SALARY_ADJUSTMENT,
        newValue: { salary: 6000 },
        effectiveDate: new Date(),
        recordedBy: 'u-1',
        role: 'HR_MANAGER',
      });

      expect(mocked.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'APPLIED' }),
      });
      expect(mocked.encrypt).toHaveBeenCalledWith('6000');
      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { salary_encrypted: 'enc:6000' },
      });
    });
  });

  describe('listChanges', () => {
    it('queries changes ordered by effective date desc', async () => {
      mocked.findMany.mockResolvedValue([{ id: 'c1' }] as never);

      const result = await listChanges('emp-1');

      expect(result).toEqual([{ id: 'c1' }]);
      expect(mocked.findMany).toHaveBeenCalledWith({
        where: { employee_id: 'emp-1' },
        orderBy: [{ effective_date: 'desc' }, { created_at: 'desc' }],
      });
    });
  });

  describe('applyPendingChange', () => {
    it('throws 400 when the change is missing or not pending', async () => {
      mocked.findUnique.mockResolvedValue(null);

      await expectHttpError(applyPendingChange('c-x'), 400, 'not pending');
    });

    it('applies the change and marks it APPLIED', async () => {
      mocked.findUnique.mockResolvedValue({
        id: 'c1',
        employee_id: 'emp-1',
        change_type: ChangeType.STATUS_CHANGE,
        new_value: { status: 'ACTIVE' },
        status: 'PENDING',
      } as never);
      mocked.employeeUpdate.mockResolvedValue({} as never);
      mocked.update.mockResolvedValue({} as never);

      await applyPendingChange('c1');

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { status: 'ACTIVE' },
      });
      expect(mocked.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'APPLIED' },
      });
    });
  });
});
