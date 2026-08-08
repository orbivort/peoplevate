import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CycleStatus, ReviewStatus, EvaluationType } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    evaluationCycle: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    performanceReview: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
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
    PROBATION_DEFAULT_MONTHS: 6,
    PROBATION_AHEAD_DAYS: 30,
  },
}));

vi.mock('./email-service.js', () => ({
  sendEvaluationCycleEmail: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import { withAuditContext } from '../utils/audit-context.js';
import { sendEvaluationCycleEmail } from './email-service.js';
import {
  addRebuttal,
  autoCreateProbationCycles,
  closeEvaluationCycle,
  createEvaluationCycle,
  finalizeReview,
  getMyReviews,
  listEvaluationCycles,
  listSoonToExpireProbationEmployees,
  openEvaluationCycle,
  submitManagerEvaluation,
  submitSelfEvaluation,
} from './performance-service.js';

const mocked = {
  evaluationCycleFindMany: vi.mocked(prisma.evaluationCycle.findMany),
  evaluationCycleFindFirst: vi.mocked(prisma.evaluationCycle.findFirst),
  evaluationCycleCreate: vi.mocked(prisma.evaluationCycle.create),
  evaluationCycleUpdate: vi.mocked(prisma.evaluationCycle.update),
  employeeFindMany: vi.mocked(prisma.employee.findMany),
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  performanceReviewFindMany: vi.mocked(prisma.performanceReview.findMany),
  performanceReviewFindFirst: vi.mocked(prisma.performanceReview.findFirst),
  performanceReviewCreate: vi.mocked(prisma.performanceReview.create),
  performanceReviewUpdate: vi.mocked(prisma.performanceReview.update),
  performanceReviewUpdateMany: vi.mocked(prisma.performanceReview.updateMany),
  withAuditContext: vi.mocked(withAuditContext),
  sendEvaluationCycleEmail: vi.mocked(sendEvaluationCycleEmail),
};

const DAY = 24 * 60 * 60 * 1000;

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

describe('performance-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // NOTE: getCycleParticipants / getProbationCycleCandidates are NOT exported.
  // Their branches (hire_date null continue, probation-end window push, and the
  // non-PROBATION else path) are exercised indirectly via
  // autoCreateProbationCycles (PROBATION + non-PROBATION) and createEvaluationCycle (ANNUAL).
  describe('listSoonToExpireProbationEmployees', () => {
    it('returns employees whose probation ends within the configured window', async () => {
      const hire = new Date(Date.now() - 165 * DAY);
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'emp-1',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          hire_date: hire,
        },
      ] as never);

      const result = (await listSoonToExpireProbationEmployees()) as { id: string }[];
      expect(result).toHaveLength(1);
    });

    it('excludes employees past their probation window', async () => {
      const hire = new Date(Date.now() - 400 * DAY);
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'emp-1',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          hire_date: hire,
        },
      ] as never);

      const result = (await listSoonToExpireProbationEmployees()) as { id: string }[];
      expect(result).toHaveLength(0);
    });

    it('excludes employees without a hire_date (continue branch)', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'emp-2', first_name: 'A', last_name: 'B', email: 'a@x.com', hire_date: null },
      ] as never);

      const result = (await listSoonToExpireProbationEmployees()) as { id: string }[];
      expect(result).toHaveLength(0);
    });

    it('excludes employees whose probation has not yet started (lower-bound false branch)', async () => {
      // hired today -> probation end ~6 months out, well beyond ahead window
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'emp-3', first_name: 'C', last_name: 'D', email: 'c@x.com', hire_date: new Date() },
      ] as never);

      const result = (await listSoonToExpireProbationEmployees()) as { id: string }[];
      expect(result).toHaveLength(0);
    });
  });

  describe('autoCreateProbationCycles', () => {
    it('creates PROBATION cycles for eligible employees without an existing cycle', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'emp-1',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          hire_date: new Date(Date.now() - 165 * DAY),
        },
      ] as never);
      mocked.performanceReviewFindFirst.mockResolvedValue(null);
      mocked.evaluationCycleCreate.mockResolvedValue({ id: 'c1' } as never);
      mocked.performanceReviewCreate.mockResolvedValue({} as never);

      const result = (await autoCreateProbationCycles()) as { created: number };

      expect(result.created).toBe(1);
      expect(mocked.evaluationCycleCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: EvaluationType.PROBATION, status: CycleStatus.OPEN }),
      });
      expect(mocked.sendEvaluationCycleEmail).toHaveBeenCalled();
    });

    it('skips employees that already have a PROBATION cycle', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'emp-1',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'j@x.com',
          hire_date: new Date(Date.now() - 165 * DAY),
        },
      ] as never);
      mocked.performanceReviewFindFirst.mockResolvedValue({ id: 'existing' } as never);

      const result = (await autoCreateProbationCycles()) as { created: number };
      expect(result.created).toBe(0);
      expect(mocked.evaluationCycleCreate).not.toHaveBeenCalled();
    });

    it('skips employees without a hire_date (continue branch)', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'emp-1', first_name: 'J', last_name: 'D', email: 'j@x.com', hire_date: null },
      ] as never);

      const result = (await autoCreateProbationCycles()) as { created: number };
      expect(result.created).toBe(0);
      expect(mocked.performanceReviewFindFirst).not.toHaveBeenCalled();
    });

    it('skips employees whose probation is outside the ahead window (out-of-window continue branch)', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        // hired 1 day ago -> probation end ~6 months out, beyond ahead window
        { id: 'emp-1', first_name: 'J', last_name: 'D', email: 'j@x.com', hire_date: new Date() },
      ] as never);

      const result = (await autoCreateProbationCycles()) as { created: number };
      expect(result.created).toBe(0);
      expect(mocked.performanceReviewFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('listEvaluationCycles', () => {
    it('hides DRAFT cycles from non-HR users (Employee)', async () => {
      mocked.evaluationCycleFindMany.mockResolvedValue([] as never);
      await listEvaluationCycles({ role: 'EMPLOYEE', userId: 'u-1' });

      const where = mocked.evaluationCycleFindMany.mock.calls[0][0].where as Record<
        string,
        unknown
      >;
      expect(where.status).toEqual({ in: [CycleStatus.OPEN, CycleStatus.CLOSED] });
    });

    it('hides DRAFT cycles from non-HR users (Manager)', async () => {
      mocked.evaluationCycleFindMany.mockResolvedValue([] as never);
      await listEvaluationCycles({ role: 'MANAGER', userId: 'u-1' });

      const where = mocked.evaluationCycleFindMany.mock.calls[0][0].where as Record<
        string,
        unknown
      >;
      expect(where.status).toEqual({ in: [CycleStatus.OPEN, CycleStatus.CLOSED] });
    });

    it('treats ADMIN as HR so it shows all cycles', async () => {
      mocked.evaluationCycleFindMany.mockResolvedValue([] as never);
      await listEvaluationCycles({ role: 'ADMIN', userId: 'u-1' });

      expect(mocked.evaluationCycleFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null },
        include: expect.any(Object),
        orderBy: { period_end: 'desc' },
      });
    });

    it('shows all cycles for HR_MANAGER', async () => {
      mocked.evaluationCycleFindMany.mockResolvedValue([] as never);
      await listEvaluationCycles({ role: 'HR_MANAGER', userId: 'u-1' });

      expect(mocked.evaluationCycleFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null },
        include: expect.any(Object),
        orderBy: { period_end: 'desc' },
      });
    });

    it('overrides the hidden status filter when an explicit status is provided (status branch)', async () => {
      mocked.evaluationCycleFindMany.mockResolvedValue([] as never);
      await listEvaluationCycles({ role: 'EMPLOYEE', userId: 'u-1', status: 'DRAFT' });

      const where = mocked.evaluationCycleFindMany.mock.calls[0][0].where as Record<
        string,
        unknown
      >;
      // Explicit status wins over the non-HR DRAFT-hiding filter
      expect(where.status).toBe('DRAFT');
    });
  });

  describe('createEvaluationCycle', () => {
    const validParams = {
      type: EvaluationType.PROBATION,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
      selfEvalStart: new Date('2026-01-02'),
      selfEvalEnd: new Date('2026-02-01'),
      managerEvalStart: new Date('2026-02-02'),
      managerEvalEnd: new Date('2026-03-01'),
      hrReviewStart: new Date('2026-03-02'),
      hrReviewEnd: new Date('2026-04-01'),
    };

    it('throws 400 when period start is not before period end', async () => {
      await expectHttpError(
        createEvaluationCycle({
          ...validParams,
          periodStart: new Date('2026-12-31'),
          periodEnd: new Date('2026-01-01'),
        }),
        400,
        'Period start must be before period end',
      );
    });

    it('throws 400 when self-eval start is not before self-eval end', async () => {
      await expectHttpError(
        createEvaluationCycle({
          ...validParams,
          selfEvalStart: new Date('2026-02-01'),
          selfEvalEnd: new Date('2026-01-02'),
        }),
        400,
        'Self-evaluation start must be before end',
      );
    });

    it('throws 400 when manager-eval start is not before manager-eval end', async () => {
      await expectHttpError(
        createEvaluationCycle({
          ...validParams,
          managerEvalStart: new Date('2026-03-01'),
          managerEvalEnd: new Date('2026-02-02'),
        }),
        400,
        'Manager evaluation start must be before end',
      );
    });

    it('throws 400 when HR-review start is not before HR-review end', async () => {
      await expectHttpError(
        createEvaluationCycle({
          ...validParams,
          hrReviewStart: new Date('2026-04-01'),
          hrReviewEnd: new Date('2026-03-02'),
        }),
        400,
        'HR review start must be before end',
      );
    });

    it('throws 400 when self-eval starts before the period', async () => {
      await expectHttpError(
        createEvaluationCycle({ ...validParams, selfEvalStart: new Date('2025-12-31') }),
        400,
        'Self-evaluation phase must start within the evaluation period',
      );
    });

    it('throws 400 when self-eval ends after manager-eval starts', async () => {
      await expectHttpError(
        createEvaluationCycle({
          ...validParams,
          selfEvalEnd: new Date('2026-02-03'),
          managerEvalStart: new Date('2026-02-02'),
        }),
        400,
        'Self-evaluation phase must end before manager evaluation phase starts',
      );
    });

    it('throws 400 when manager-eval ends after HR-review starts', async () => {
      await expectHttpError(
        createEvaluationCycle({
          ...validParams,
          managerEvalEnd: new Date('2026-03-03'),
          hrReviewStart: new Date('2026-03-02'),
        }),
        400,
        'Manager evaluation phase must end before HR review phase starts',
      );
    });

    it('throws 400 when HR-review ends after the period', async () => {
      await expectHttpError(
        createEvaluationCycle({ ...validParams, hrReviewEnd: new Date('2027-01-01') }),
        400,
        'HR review phase must end within the evaluation period',
      );
    });

    it('creates a DRAFT cycle with NOT_STARTED reviews (PROBATION participants, skipping null hire_date)', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'emp-1',
          email: 'j@x.com',
          first_name: 'J',
          last_name: 'D',
          hire_date: new Date(Date.now() - 165 * DAY),
        },
        { id: 'emp-no-hire', email: 'n@x.com', first_name: 'N', last_name: 'H', hire_date: null },
      ] as never);
      mocked.evaluationCycleCreate.mockResolvedValue({ id: 'c-new' } as never);
      mocked.performanceReviewCreate.mockResolvedValue({} as never);

      await createEvaluationCycle(validParams);

      expect(mocked.evaluationCycleCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: CycleStatus.DRAFT,
          type: EvaluationType.PROBATION,
        }),
      });
      expect(mocked.performanceReviewCreate).toHaveBeenCalledWith({
        data: { cycle_id: 'c-new', employee_id: 'emp-1', status: ReviewStatus.NOT_STARTED },
      });
    });

    it('excludes PROBATION candidates whose probation end is after the cycle window (probationEnd <= periodEnd false branch)', async () => {
      const now = Date.now();
      const periodStart = new Date(now);
      const periodEnd = new Date(now + 10 * DAY);
      // Newly hired employee -> probation end ~6 months out, beyond the short periodEnd below.
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'emp-new',
          email: 'n@x.com',
          first_name: 'N',
          last_name: 'E',
          hire_date: new Date(now),
        },
      ] as never);
      mocked.evaluationCycleCreate.mockResolvedValue({ id: 'c-new3' } as never);

      await createEvaluationCycle({
        type: EvaluationType.PROBATION,
        periodStart,
        periodEnd,
        selfEvalStart: new Date(now),
        selfEvalEnd: new Date(now + 1 * DAY),
        managerEvalStart: new Date(now + 2 * DAY),
        managerEvalEnd: new Date(now + 4 * DAY),
        hrReviewStart: new Date(now + 5 * DAY),
        hrReviewEnd: new Date(now + 9 * DAY),
      });

      expect(mocked.evaluationCycleCreate).toHaveBeenCalled();
      // Candidate excluded because probationEnd (6 months) > periodEnd (10 days)
      expect(mocked.performanceReviewCreate).not.toHaveBeenCalled();
    });

    it('creates a DRAFT cycle with all active participants for a non-PROBATION type', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        { id: 'emp-2', email: 'a@x.com', first_name: 'A', last_name: 'B' },
      ] as never);
      mocked.evaluationCycleCreate.mockResolvedValue({ id: 'c-new2' } as never);
      mocked.performanceReviewCreate.mockResolvedValue({} as never);

      await createEvaluationCycle({ ...validParams, type: EvaluationType.ANNUAL });

      expect(mocked.performanceReviewCreate).toHaveBeenCalledWith({
        data: { cycle_id: 'c-new2', employee_id: 'emp-2', status: ReviewStatus.NOT_STARTED },
      });
    });
  });

  describe('openEvaluationCycle', () => {
    it('throws 404 when the cycle is missing', async () => {
      mocked.evaluationCycleFindFirst.mockResolvedValue(null);
      await expectHttpError(openEvaluationCycle('c-x'), 404, 'Evaluation cycle not found');
    });

    it('throws 400 when the cycle is not in DRAFT status', async () => {
      mocked.evaluationCycleFindFirst.mockResolvedValue({
        id: 'c1',
        status: CycleStatus.CLOSED,
        type: EvaluationType.PROBATION,
      } as never);
      await expectHttpError(openEvaluationCycle('c1'), 400);
    });

    it('opens a DRAFT cycle and notifies participants with emails', async () => {
      mocked.evaluationCycleFindFirst.mockResolvedValue({
        id: 'c1',
        status: CycleStatus.DRAFT,
        type: EvaluationType.PROBATION,
        period_start: new Date(),
        period_end: new Date(Date.now() + 20 * DAY),
      } as never);
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'emp-1',
          email: 'j@x.com',
          first_name: 'J',
          last_name: 'D',
          hire_date: new Date(Date.now() - 165 * DAY),
        },
      ] as never);
      mocked.evaluationCycleUpdate.mockResolvedValue({} as never);

      await openEvaluationCycle('c1');

      expect(mocked.evaluationCycleUpdate).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: CycleStatus.OPEN },
      });
      expect(mocked.sendEvaluationCycleEmail).toHaveBeenCalled();
    });

    it('skips participants without an email (email falsy branch)', async () => {
      mocked.evaluationCycleFindFirst.mockResolvedValue({
        id: 'c2',
        status: CycleStatus.DRAFT,
        type: EvaluationType.PROBATION,
        period_start: new Date(),
        period_end: new Date(Date.now() + 20 * DAY),
      } as never);
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'emp-2',
          email: null,
          first_name: 'A',
          last_name: 'B',
          hire_date: new Date(Date.now() - 165 * DAY),
        },
        {
          id: 'emp-3',
          email: undefined,
          first_name: 'C',
          last_name: 'D',
          hire_date: new Date(Date.now() - 165 * DAY),
        },
      ] as never);
      mocked.evaluationCycleUpdate.mockResolvedValue({} as never);

      await openEvaluationCycle('c2');

      expect(mocked.sendEvaluationCycleEmail).not.toHaveBeenCalled();
    });

    it('handles participants with missing first/last name in notification (name fallback branch)', async () => {
      mocked.evaluationCycleFindFirst.mockResolvedValue({
        id: 'c3',
        status: CycleStatus.DRAFT,
        type: EvaluationType.PROBATION,
        period_start: new Date(),
        period_end: new Date(Date.now() + 20 * DAY),
      } as never);
      mocked.employeeFindMany.mockResolvedValue([
        {
          id: 'emp-4',
          email: 'e@x.com',
          first_name: undefined,
          last_name: undefined,
          hire_date: new Date(Date.now() - 165 * DAY),
        },
      ] as never);
      mocked.evaluationCycleUpdate.mockResolvedValue({} as never);

      await openEvaluationCycle('c3');

      expect(mocked.sendEvaluationCycleEmail).toHaveBeenCalledWith(
        'e@x.com',
        '',
        EvaluationType.PROBATION,
      );
    });
  });

  describe('closeEvaluationCycle', () => {
    it('throws 404 when the cycle is missing', async () => {
      mocked.evaluationCycleFindFirst.mockResolvedValue(null);
      await expectHttpError(closeEvaluationCycle('c-x'), 404, 'Evaluation cycle not found');
    });

    it('throws 400 when the cycle is not OPEN', async () => {
      mocked.evaluationCycleFindFirst.mockResolvedValue({
        id: 'c1',
        status: CycleStatus.DRAFT,
      } as never);
      await expectHttpError(closeEvaluationCycle('c1'), 400);
    });

    it('closes an OPEN cycle and auto-completes unfinished reviews', async () => {
      mocked.evaluationCycleFindFirst.mockResolvedValue({
        id: 'c1',
        status: CycleStatus.OPEN,
        type: EvaluationType.PROBATION,
      } as never);
      mocked.performanceReviewUpdateMany.mockResolvedValue({} as never);
      mocked.evaluationCycleUpdate.mockResolvedValue({} as never);

      await closeEvaluationCycle('c1');

      expect(mocked.performanceReviewUpdateMany).toHaveBeenCalledWith({
        where: { cycle_id: 'c1', status: { not: ReviewStatus.COMPLETED } },
        data: expect.objectContaining({ status: ReviewStatus.COMPLETED }),
      });
      expect(mocked.evaluationCycleUpdate).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: CycleStatus.CLOSED },
      });
    });
  });

  describe('getMyReviews', () => {
    it('returns an empty list when the user has no employee record', async () => {
      mocked.employeeFindUnique.mockResolvedValue(null);
      const result = (await getMyReviews({ role: 'EMPLOYEE', userId: 'u-1' })) as unknown[];
      expect(result).toEqual([]);
      expect(mocked.performanceReviewFindMany).not.toHaveBeenCalled();
    });

    it('returns reviews for the employee (EMPLOYEE branch)', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-1' } as never);
      mocked.performanceReviewFindMany.mockResolvedValue([{ id: 'r1' }] as never);

      const result = (await getMyReviews({ role: 'EMPLOYEE', userId: 'u-1' })) as { id: string }[];
      expect(result).toHaveLength(1);
      expect(mocked.performanceReviewFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null, employee_id: 'emp-1' },
        include: expect.any(Object),
        orderBy: { created_at: 'desc' },
      });
    });

    it('returns reviews for a manager and their direct reports (MANAGER branch with reports)', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-mgr' } as never);
      mocked.employeeFindMany.mockResolvedValue([{ id: 'emp-r1' }, { id: 'emp-r2' }] as never);
      mocked.performanceReviewFindMany.mockResolvedValue([{ id: 'r1' }] as never);

      await getMyReviews({ role: 'MANAGER', userId: 'u-mgr' });

      const where = mocked.performanceReviewFindMany.mock.calls[0][0].where as Record<
        string,
        unknown
      >;
      expect(where.OR).toEqual([
        { employee_id: 'emp-mgr' },
        { employee_id: { in: ['emp-r1', 'emp-r2'] } },
      ]);
    });

    it('returns only the manager own reviews when there are no direct reports (MANAGER branch, empty reports)', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-mgr' } as never);
      mocked.employeeFindMany.mockResolvedValue([] as never);

      await getMyReviews({ role: 'MANAGER', userId: 'u-mgr' });

      const where = mocked.performanceReviewFindMany.mock.calls[0][0].where as Record<
        string,
        unknown
      >;
      expect(where.OR).toEqual([{ employee_id: 'emp-mgr' }, { employee_id: { in: [] } }]);
    });

    it('filters by employee id for a non-EMPLOYEE/MANAGER role (else branch: no OR / employee_id)', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-hr' } as never);
      mocked.performanceReviewFindMany.mockResolvedValue([] as never);

      await getMyReviews({ role: 'HR_MANAGER', userId: 'u-hr' });

      const where = mocked.performanceReviewFindMany.mock.calls[0][0].where as Record<
        string,
        unknown
      >;
      expect(where).toEqual({ deleted_at: null });
    });
  });

  describe('submitSelfEvaluation', () => {
    it('throws 404 when the review is missing', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue(null);
      await expectHttpError(
        submitSelfEvaluation({
          reviewId: 'r-x',
          selfEval: { a: 1 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        404,
        'Review not found',
      );
    });

    it('throws 403 when the actor has no employee id (actorEmployeeId falsy branch)', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        cycle: { status: CycleStatus.OPEN },
      } as never);

      await expectHttpError(
        submitSelfEvaluation({
          reviewId: 'r1',
          selfEval: { a: 1 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: null,
        }),
        403,
        'assigned as an employee',
      );
    });

    it('throws 403 when the actor is not the review owner', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-other',
        cycle: { status: CycleStatus.OPEN },
      } as never);

      await expectHttpError(
        submitSelfEvaluation({
          reviewId: 'r1',
          selfEval: { a: 1 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        403,
        'your own review',
      );
    });

    it('throws 400 when the cycle is not OPEN', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        cycle: { status: CycleStatus.CLOSED },
      } as never);

      await expectHttpError(
        submitSelfEvaluation({
          reviewId: 'r1',
          selfEval: { a: 1 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        400,
      );
    });

    it('throws 400 when the self-evaluation phase has not started yet', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        cycle: {
          status: CycleStatus.OPEN,
          self_eval_start: new Date(Date.now() + 100000),
          self_eval_end: new Date(Date.now() + 200000),
        },
      } as never);

      await expectHttpError(
        submitSelfEvaluation({
          reviewId: 'r1',
          selfEval: { a: 1 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        400,
        'has not started yet',
      );
    });

    it('throws 400 when the self-evaluation phase has ended', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        cycle: {
          status: CycleStatus.OPEN,
          self_eval_start: new Date(Date.now() - 200000),
          self_eval_end: new Date(Date.now() - 100000),
        },
      } as never);

      await expectHttpError(
        submitSelfEvaluation({
          reviewId: 'r1',
          selfEval: { a: 1 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        400,
        'has ended',
      );
    });

    it('throws 400 when the self-evaluation was already submitted (immutable branch)', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        self_eval_submitted_at: new Date(),
        cycle: {
          status: CycleStatus.OPEN,
          self_eval_start: new Date(Date.now() - 1000),
          self_eval_end: new Date(Date.now() + 100000),
        },
      } as never);

      await expectHttpError(
        submitSelfEvaluation({
          reviewId: 'r1',
          selfEval: { a: 1 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        400,
        'already submitted',
      );
    });

    it('submits the self evaluation and advances to manager evaluation', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        cycle: {
          status: CycleStatus.OPEN,
          self_eval_start: new Date(Date.now() - 1000),
          self_eval_end: new Date(Date.now() + 100000),
        },
      } as never);
      mocked.performanceReviewUpdate.mockResolvedValue({} as never);

      await submitSelfEvaluation({
        reviewId: 'r1',
        selfEval: { a: 1 },
        actorId: 'u-1',
        actorName: 'Jane',
        actorEmployeeId: 'emp-1',
      });

      expect(mocked.performanceReviewUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: ReviewStatus.MANAGER_EVALUATION }),
      });
    });
  });

  describe('submitManagerEvaluation', () => {
    it('throws 404 when the review is missing', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue(null);
      await expectHttpError(
        submitManagerEvaluation({
          reviewId: 'r-x',
          managerEval: { score: 4 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-mgr',
        }),
        404,
        'Review not found',
      );
    });

    it('throws 403 when the actor has no employee id (actorEmployeeId falsy branch)', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee: { manager_id: 'emp-mgr' },
        cycle: { status: CycleStatus.OPEN },
      } as never);

      await expectHttpError(
        submitManagerEvaluation({
          reviewId: 'r1',
          managerEval: { score: 4 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: null,
        }),
        403,
        'assigned as an employee',
      );
    });

    it('throws 403 when the actor is not the employee manager', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee: { manager_id: 'emp-other' },
        cycle: { status: CycleStatus.OPEN },
      } as never);

      await expectHttpError(
        submitManagerEvaluation({
          reviewId: 'r1',
          managerEval: { score: 4 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-mgr',
        }),
        403,
        'not the manager',
      );
    });

    it('throws 400 when the cycle is not OPEN', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee: { manager_id: 'emp-mgr' },
        cycle: { status: CycleStatus.CLOSED },
      } as never);

      await expectHttpError(
        submitManagerEvaluation({
          reviewId: 'r1',
          managerEval: { score: 4 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-mgr',
        }),
        400,
      );
    });

    it('throws 400 when the manager-eval phase has not started yet', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee: { manager_id: 'emp-mgr' },
        self_eval_submitted_at: new Date(),
        cycle: {
          status: CycleStatus.OPEN,
          manager_eval_start: new Date(Date.now() + 100000),
          manager_eval_end: new Date(Date.now() + 200000),
        },
      } as never);

      await expectHttpError(
        submitManagerEvaluation({
          reviewId: 'r1',
          managerEval: { score: 4 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-mgr',
        }),
        400,
        'has not started yet',
      );
    });

    it('throws 400 when the manager-eval phase has ended', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee: { manager_id: 'emp-mgr' },
        self_eval_submitted_at: new Date(),
        cycle: {
          status: CycleStatus.OPEN,
          manager_eval_start: new Date(Date.now() - 200000),
          manager_eval_end: new Date(Date.now() - 100000),
        },
      } as never);

      await expectHttpError(
        submitManagerEvaluation({
          reviewId: 'r1',
          managerEval: { score: 4 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-mgr',
        }),
        400,
        'has ended',
      );
    });

    it('throws 400 when self-eval was not submitted', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee: { manager_id: 'emp-mgr' },
        self_eval_submitted_at: null,
        cycle: {
          status: CycleStatus.OPEN,
          manager_eval_start: new Date(Date.now() - 1000),
          manager_eval_end: new Date(Date.now() + 100000),
        },
      } as never);

      await expectHttpError(
        submitManagerEvaluation({
          reviewId: 'r1',
          managerEval: { score: 4 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-mgr',
        }),
        400,
        'Self-evaluation must be submitted',
      );
    });

    it('throws 400 when the manager evaluation was already submitted (immutable branch)', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee: { manager_id: 'emp-mgr' },
        self_eval_submitted_at: new Date(),
        manager_eval_submitted_at: new Date(),
        cycle: {
          status: CycleStatus.OPEN,
          manager_eval_start: new Date(Date.now() - 1000),
          manager_eval_end: new Date(Date.now() + 100000),
        },
      } as never);

      await expectHttpError(
        submitManagerEvaluation({
          reviewId: 'r1',
          managerEval: { score: 4 },
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-mgr',
        }),
        400,
        'already submitted',
      );
    });

    it('submits the manager evaluation and advances to HR review', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee: { manager_id: 'emp-mgr' },
        self_eval_submitted_at: new Date(),
        cycle: {
          status: CycleStatus.OPEN,
          manager_eval_start: new Date(Date.now() - 1000),
          manager_eval_end: new Date(Date.now() + 100000),
        },
      } as never);
      mocked.performanceReviewUpdate.mockResolvedValue({} as never);

      await submitManagerEvaluation({
        reviewId: 'r1',
        managerEval: { score: 4 },
        actorId: 'u-1',
        actorName: 'Jane',
        actorEmployeeId: 'emp-mgr',
      });

      expect(mocked.performanceReviewUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: ReviewStatus.HR_REVIEW }),
      });
    });
  });

  describe('finalizeReview', () => {
    it('throws 404 when the review is missing', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue(null);
      await expectHttpError(
        finalizeReview({ reviewId: 'r-x', overallRating: 4, actorId: 'u-1', actorName: 'Jane' }),
        404,
        'Review not found',
      );
    });

    it('throws 400 when the cycle is not OPEN', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        manager_eval_submitted_at: new Date(),
        cycle: { status: CycleStatus.CLOSED },
      } as never);
      await expectHttpError(
        finalizeReview({ reviewId: 'r1', overallRating: 4, actorId: 'u-1', actorName: 'Jane' }),
        400,
      );
    });

    it('throws 400 when manager eval was not submitted', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        manager_eval_submitted_at: null,
        cycle: { status: CycleStatus.OPEN },
      } as never);
      await expectHttpError(
        finalizeReview({ reviewId: 'r1', overallRating: 4, actorId: 'u-1', actorName: 'Jane' }),
        400,
        'Manager evaluation must be submitted',
      );
    });

    it('finalizes a review as COMPLETED with provided hrComments', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        manager_eval_submitted_at: new Date(),
        cycle: { status: CycleStatus.OPEN },
      } as never);
      mocked.performanceReviewUpdate.mockResolvedValue({} as never);

      await finalizeReview({
        reviewId: 'r1',
        overallRating: 4,
        hrComments: 'good',
        actorId: 'u-1',
        actorName: 'Jane',
      });

      expect(mocked.performanceReviewUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({
          status: ReviewStatus.COMPLETED,
          overall_rating: 4,
          hr_comments: 'good',
        }),
      });
    });

    it('falls back hrComments to null when omitted (?? null branch)', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        manager_eval_submitted_at: new Date(),
        cycle: { status: CycleStatus.OPEN },
      } as never);
      mocked.performanceReviewUpdate.mockResolvedValue({} as never);

      await finalizeReview({ reviewId: 'r1', overallRating: 3, actorId: 'u-1', actorName: 'Jane' });

      const data = mocked.performanceReviewUpdate.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.hr_comments).toBeNull();
      expect(data.overall_rating).toBe(3);
    });
  });

  describe('addRebuttal', () => {
    it('throws 404 when the review is missing', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue(null);
      await expectHttpError(
        addRebuttal({
          reviewId: 'r-x',
          rebuttal: 'x',
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        404,
        'Review not found',
      );
    });

    it('throws 403 when the actor has no employee id (actorEmployeeId falsy branch)', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        status: ReviewStatus.COMPLETED,
        cycle: { status: CycleStatus.CLOSED },
      } as never);

      await expectHttpError(
        addRebuttal({
          reviewId: 'r1',
          rebuttal: 'x',
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: null,
        }),
        403,
        'assigned as an employee',
      );
    });

    it('throws 403 when the actor is not the review owner', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-other',
        status: ReviewStatus.COMPLETED,
        cycle: { status: CycleStatus.CLOSED },
      } as never);

      await expectHttpError(
        addRebuttal({
          reviewId: 'r1',
          rebuttal: 'x',
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        403,
        'your own review',
      );
    });

    it('throws 400 when the cycle is not CLOSED', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        status: ReviewStatus.COMPLETED,
        cycle: { status: CycleStatus.OPEN },
      } as never);

      await expectHttpError(
        addRebuttal({
          reviewId: 'r1',
          rebuttal: 'x',
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        400,
      );
    });

    it('throws 400 when the review is not COMPLETED yet (status !== COMPLETED branch)', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        status: ReviewStatus.HR_REVIEW,
        cycle: { status: CycleStatus.CLOSED },
      } as never);

      await expectHttpError(
        addRebuttal({
          reviewId: 'r1',
          rebuttal: 'x',
          actorId: 'u-1',
          actorName: 'Jane',
          actorEmployeeId: 'emp-1',
        }),
        400,
        'after finalization',
      );
    });

    it('attaches a rebuttal for a finalized review in a CLOSED cycle', async () => {
      mocked.performanceReviewFindFirst.mockResolvedValue({
        id: 'r1',
        employee_id: 'emp-1',
        status: ReviewStatus.COMPLETED,
        cycle: { status: CycleStatus.CLOSED },
      } as never);
      mocked.performanceReviewUpdate.mockResolvedValue({} as never);

      await addRebuttal({
        reviewId: 'r1',
        rebuttal: 'I disagree',
        actorId: 'u-1',
        actorName: 'Jane',
        actorEmployeeId: 'emp-1',
      });

      expect(mocked.performanceReviewUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { rebuttal: 'I disagree' },
      });
    });
  });
});
