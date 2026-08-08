import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmploymentStatus } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    leaveType: { findMany: vi.fn() },
    leaveEntitlement: { findFirst: vi.fn() },
    leaveRequest: { aggregate: vi.fn() },
    leavePolicyGroup: { findMany: vi.fn() },
  },
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

vi.mock('../utils/audit-context.js', () => ({ withAuditContext: vi.fn() }));
vi.mock('./email-service.js', () => ({ sendLeaveStatusEmail: vi.fn() }));

import { prisma } from '../config/prisma.js';
import { getLeaveBalance } from './attendance-service.js';

const m = {
  empFindUnique: vi.mocked(prisma.employee.findUnique),
  empFindMany: vi.mocked(prisma.employee.findMany),
  leaveTypeFindMany: vi.mocked(prisma.leaveType.findMany),
  entitlementFindFirst: vi.mocked(prisma.leaveEntitlement.findFirst),
  reqAggregate: vi.mocked(prisma.leaveRequest.aggregate),
  policyGroupFindMany: vi.mocked(prisma.leavePolicyGroup.findMany),
};

const YEAR = new Date().getFullYear();

type Balance = {
  entitlement: number;
  used: number;
  available: number;
  pending: number;
  source: string | null;
  policyGroupName: string | null;
  prorated: boolean;
  proration: { proratedEntitlement: number; fraction: number } | null;
  probation: { underProbation: boolean; remainingDays: number } | null;
};

/** Read the first balance row of the first employee in the result. */
function firstBalance(result: unknown): Balance {
  return (result as { balances: Balance[] }[])[0]!.balances[0]!;
}

/** Employee attribute record returned by the per-employee lookup. */
function empInfo(overrides: Record<string, unknown> = {}): unknown {
  return {
    hire_date: new Date(Date.UTC(YEAR - 5, 0, 1)),
    employment_type: 'FULL_TIME',
    department_id: 'd1',
    status: EmploymentStatus.ACTIVE,
    position: { grade: 'G2' },
    ...overrides,
  };
}

describe('getLeaveBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.leaveTypeFindMany.mockResolvedValue([{ id: 'lt1', name: 'Annual' }] as never);
    m.reqAggregate.mockResolvedValue({ _sum: { days: 0 } } as never);
    m.entitlementFindFirst.mockResolvedValue(null as never);
    m.policyGroupFindMany.mockResolvedValue([] as never);
  });

  describe('scoping by role', () => {
    it('returns an empty list when an EMPLOYEE has no employee record', async () => {
      m.empFindUnique.mockResolvedValue(null as never);

      expect(await getLeaveBalance({ role: 'EMPLOYEE', userId: 'u1' })).toEqual([]);
    });

    it('returns an empty list when a MANAGER has no employee record', async () => {
      m.empFindUnique.mockResolvedValue(null as never);

      expect(await getLeaveBalance({ role: 'MANAGER', userId: 'u1' })).toEqual([]);
    });

    it('includes reports and self for a MANAGER', async () => {
      m.empFindUnique
        .mockResolvedValueOnce({ id: 'mgr' } as never)
        .mockResolvedValue(empInfo() as never);
      m.empFindMany.mockResolvedValue([{ id: 'e1' }] as never);

      const result = (await getLeaveBalance({ role: 'MANAGER', userId: 'u1' })) as {
        employeeId: string;
      }[];

      expect(result.map((r) => r.employeeId)).toEqual(['e1', 'mgr']);
    });

    it('scopes to a single employee when employeeId is supplied', async () => {
      m.empFindUnique.mockResolvedValue(empInfo() as never);

      const result = (await getLeaveBalance({
        role: 'HR_MANAGER',
        userId: 'u1',
        employeeId: 'e9',
      })) as { employeeId: string }[];

      expect(result).toHaveLength(1);
      expect(result[0]?.employeeId).toBe('e9');
      expect(m.empFindMany).not.toHaveBeenCalled();
    });

    it('falls back to all employees for an admin with no employeeId', async () => {
      m.empFindMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }] as never);
      m.empFindUnique.mockResolvedValue(empInfo() as never);

      const result = (await getLeaveBalance({ role: 'ADMIN', userId: 'u1' })) as unknown[];

      expect(result).toHaveLength(2);
    });
  });

  describe('probation handling', () => {
    it('zeroes the entitlement for a NEW_HIRE still within probation', async () => {
      m.empFindUnique.mockResolvedValue(
        empInfo({ hire_date: new Date(), status: EmploymentStatus.NEW_HIRE }) as never,
      );

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.entitlement).toBe(0);
      expect(balance.available).toBe(0);
      expect(balance.probation?.underProbation).toBe(true);
      expect(balance.probation?.remainingDays).toBeGreaterThan(0);
    });

    it('grants entitlement once the probation period has elapsed', async () => {
      // Hired two years ago but still flagged PROBATION: the date check clears it.
      m.empFindUnique.mockResolvedValue(
        empInfo({
          hire_date: new Date(Date.UTC(YEAR - 2, 0, 1)),
          status: EmploymentStatus.PROBATION,
        }) as never,
      );
      m.entitlementFindFirst.mockResolvedValue({
        annual_entitlement: 15,
        source: 'OVERRIDE',
        policy_group: { name: 'Standard', entitlements: [{ annual_days: 15 }] },
      } as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.probation).toBeNull();
      expect(balance.entitlement).toBe(15);
    });

    it('ignores probation status when the hire date is missing', async () => {
      m.empFindUnique.mockResolvedValue(
        empInfo({ hire_date: null, status: EmploymentStatus.NEW_HIRE }) as never,
      );

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.probation).toBeNull();
    });
  });

  describe('materialised entitlements', () => {
    it('uses a provisioned OVERRIDE entitlement and its policy group name', async () => {
      m.empFindUnique.mockResolvedValue(empInfo() as never);
      m.entitlementFindFirst.mockResolvedValue({
        annual_entitlement: 18,
        source: 'OVERRIDE',
        policy_group: { name: 'Senior', entitlements: [{ annual_days: 18 }] },
      } as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.entitlement).toBe(18);
      expect(balance.source).toBe('OVERRIDE');
      expect(balance.policyGroupName).toBe('Senior');
      expect(balance.prorated).toBe(false);
    });

    it('skips a MIGRATED entitlement and falls back to policy matching', async () => {
      m.empFindUnique.mockResolvedValue(empInfo() as never);
      m.entitlementFindFirst.mockResolvedValue({
        annual_entitlement: 99,
        source: 'MIGRATED',
        policy_group: null,
      } as never);
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'Standard',
          employment_type: 'FULL_TIME',
          grades: [],
          department_id: null,
          proration_enabled: false,
          entitlements: [{ annual_days: 20 }],
        },
      ] as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.entitlement).toBe(20);
      expect(balance.source).toBe('POLICY');
      expect(balance.policyGroupName).toBe('Standard');
    });

    it('reports proration when a mid-year hire has a prorated entitlement', async () => {
      m.empFindUnique.mockResolvedValue(
        empInfo({ hire_date: new Date(Date.UTC(YEAR, 6, 1)) }) as never,
      );
      m.entitlementFindFirst.mockResolvedValue({
        annual_entitlement: 10,
        source: 'POLICY',
        policy_group: { name: 'Standard', entitlements: [{ annual_days: 20 }] },
      } as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.prorated).toBe(true);
      expect(balance.proration?.fraction).toBeLessThan(1);
    });
  });

  describe('policy group matching', () => {
    beforeEach(() => {
      m.empFindUnique.mockResolvedValue(empInfo() as never);
    });

    it('yields a zero entitlement when nothing matches', async () => {
      m.policyGroupFindMany.mockResolvedValue([] as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.entitlement).toBe(0);
      expect(balance.source).toBeNull();
    });

    it('excludes groups whose employment type differs', async () => {
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'PartTimers',
          employment_type: 'PART_TIME',
          grades: [],
          department_id: null,
          proration_enabled: false,
          entitlements: [{ annual_days: 5 }],
        },
      ] as never);

      expect(
        firstBalance(await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }))
          .entitlement,
      ).toBe(0);
    });

    it('excludes groups whose grade list does not include the employee grade', async () => {
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'Execs',
          employment_type: null,
          grades: ['G9'],
          department_id: null,
          proration_enabled: false,
          entitlements: [{ annual_days: 30 }],
        },
      ] as never);

      expect(
        firstBalance(await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }))
          .entitlement,
      ).toBe(0);
    });

    it('excludes graded groups when the employee has no grade', async () => {
      m.empFindUnique.mockResolvedValue(empInfo({ position: null }) as never);
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'Graded',
          employment_type: null,
          grades: ['G2'],
          department_id: null,
          proration_enabled: false,
          entitlements: [{ annual_days: 30 }],
        },
      ] as never);

      expect(
        firstBalance(await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }))
          .entitlement,
      ).toBe(0);
    });

    it('excludes groups scoped to a different department', async () => {
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'OtherDept',
          employment_type: null,
          grades: [],
          department_id: 'd-other',
          proration_enabled: false,
          entitlements: [{ annual_days: 25 }],
        },
      ] as never);

      expect(
        firstBalance(await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }))
          .entitlement,
      ).toBe(0);
    });

    it('excludes matching groups that have no entitlement for the leave type', async () => {
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'Empty',
          employment_type: 'FULL_TIME',
          grades: [],
          department_id: null,
          proration_enabled: false,
          entitlements: [],
        },
      ] as never);

      expect(
        firstBalance(await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }))
          .entitlement,
      ).toBe(0);
    });

    it('prefers the group with the most specific criteria', async () => {
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'Generic',
          employment_type: null,
          grades: [],
          department_id: null,
          proration_enabled: false,
          entitlements: [{ annual_days: 10 }],
        },
        {
          name: 'Specific',
          employment_type: 'FULL_TIME',
          grades: ['G2'],
          department_id: 'd1',
          proration_enabled: false,
          entitlements: [{ annual_days: 25 }],
        },
      ] as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.policyGroupName).toBe('Specific');
      expect(balance.entitlement).toBe(25);
    });

    it('prorates a mid-year hire when the group enables proration', async () => {
      m.empFindUnique.mockResolvedValue(
        empInfo({ hire_date: new Date(Date.UTC(YEAR, 6, 1)) }) as never,
      );
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'Prorated',
          employment_type: 'FULL_TIME',
          grades: [],
          department_id: null,
          proration_enabled: true,
          entitlements: [{ annual_days: 20 }],
        },
      ] as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.prorated).toBe(true);
      expect(balance.entitlement).toBeLessThan(20);
      expect(balance.entitlement).toBeGreaterThan(0);
    });

    it('does not prorate when the employee was hired before the year started', async () => {
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'Prorated',
          employment_type: 'FULL_TIME',
          grades: [],
          department_id: null,
          proration_enabled: true,
          entitlements: [{ annual_days: 20 }],
        },
      ] as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.entitlement).toBe(20);
      expect(balance.prorated).toBe(false);
    });

    it('gives zero when the hire date falls after the year end', async () => {
      m.empFindUnique.mockResolvedValue(
        empInfo({ hire_date: new Date(Date.UTC(YEAR + 1, 5, 1)) }) as never,
      );
      m.policyGroupFindMany.mockResolvedValue([
        {
          name: 'Prorated',
          employment_type: 'FULL_TIME',
          grades: [],
          department_id: null,
          proration_enabled: true,
          entitlements: [{ annual_days: 20 }],
        },
      ] as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.entitlement).toBe(0);
    });

    it('returns no match when the employee record cannot be resolved', async () => {
      m.empFindUnique.mockResolvedValue(null as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'ghost' }),
      );

      expect(balance.entitlement).toBe(0);
      expect(balance.policyGroupName).toBeNull();
    });
  });

  describe('used and pending aggregation', () => {
    beforeEach(() => {
      m.empFindUnique.mockResolvedValue(empInfo() as never);
      m.entitlementFindFirst.mockResolvedValue({
        annual_entitlement: 20,
        source: 'POLICY',
        policy_group: { name: 'Standard', entitlements: [{ annual_days: 20 }] },
      } as never);
    });

    it('subtracts used and pending days from the available balance', async () => {
      m.reqAggregate
        .mockResolvedValueOnce({ _sum: { days: 5 } } as never)
        .mockResolvedValueOnce({ _sum: { days: 3 } } as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.used).toBe(5);
      expect(balance.pending).toBe(3);
      expect(balance.available).toBe(12);
    });

    it('never reports a negative available balance', async () => {
      m.reqAggregate
        .mockResolvedValueOnce({ _sum: { days: 25 } } as never)
        .mockResolvedValueOnce({ _sum: { days: 10 } } as never);

      expect(
        firstBalance(await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }))
          .available,
      ).toBe(0);
    });

    it('treats null aggregate sums as zero', async () => {
      m.reqAggregate.mockResolvedValue({ _sum: { days: null } } as never);

      const balance = firstBalance(
        await getLeaveBalance({ role: 'ADMIN', userId: 'u1', employeeId: 'e1' }),
      );

      expect(balance.used).toBe(0);
      expect(balance.pending).toBe(0);
      expect(balance.available).toBe(20);
    });
  });
});
