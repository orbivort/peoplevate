import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { withAuditContext } from '../utils/audit-context.js';
import { sendEvaluationCycleEmail } from './email-service.js';
import { HttpError } from '../utils/http-error.js';
import { EvaluationType, CycleStatus, ReviewStatus } from '#prisma';

function assertCycleStatus(cycle: { status: string }, expected: string, action: string): void {
  if (cycle.status !== expected) {
    throw new HttpError(400, `Cannot ${action} a cycle in ${cycle.status} status`);
  }
}

function assertPhaseWindow(phaseStart: Date, phaseEnd: Date, phaseName: string): void {
  const now = new Date();
  if (now.getTime() < phaseStart.getTime()) {
    throw new HttpError(400, `${phaseName} phase has not started yet`);
  }
  if (now.getTime() > phaseEnd.getTime()) {
    throw new HttpError(400, `${phaseName} phase has ended`);
  }
}

// ── Evaluation Cycles ──────────────────────────

/** Derive an employee's probation end date from hire_date plus the probation period in months. */
function computeProbationEnd(hireDate: Date, months: number): Date {
  const end = new Date(hireDate);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
}

interface ProbationCandidate {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  probationEnd: Date;
}

/**
 * Return employees eligible for a PROBATION cycle: on probation (NEW_HIRE/PROBATION),
 * not deleted, whose probation end date falls on or before the cycle's evaluation window.
 * Non-probation cycles are not filtered here.
 */
async function getProbationCycleCandidates(cycle: {
  periodStart: Date;
  periodEnd: Date;
}): Promise<ProbationCandidate[]> {
  const employees = await prisma.employee.findMany({
    where: { deleted_at: null, status: { in: ['NEW_HIRE', 'PROBATION'] } },
    select: {
      id: true,
      email: true,
      first_name: true,
      last_name: true,
      hire_date: true,
    },
  });

  const candidates: ProbationCandidate[] = [];
  for (const emp of employees) {
    if (!emp.hire_date) continue;
    const probationEnd = computeProbationEnd(emp.hire_date, env.PROBATION_DEFAULT_MONTHS);
    // Probation must end on or before the cycle evaluation window closes.
    if (probationEnd.getTime() <= cycle.periodEnd.getTime()) {
      candidates.push({
        id: emp.id,
        email: emp.email,
        first_name: emp.first_name,
        last_name: emp.last_name,
        probationEnd,
      });
    }
  }
  return candidates;
}

/** Enroll the relevant employees for a cycle: eligible probation candidates for PROBATION, all active otherwise. */
async function getCycleParticipants(cycle: {
  type: EvaluationType;
  periodStart: Date;
  periodEnd: Date;
}): Promise<Array<{ id: string; email?: string; first_name?: string; last_name?: string }>> {
  if (cycle.type === EvaluationType.PROBATION) {
    const candidates = await getProbationCycleCandidates(cycle);
    return candidates.map((c) => ({
      id: c.id,
      email: c.email,
      first_name: c.first_name,
      last_name: c.last_name,
    }));
  }
  return prisma.employee.findMany({
    where: { deleted_at: null, status: { in: ['NEW_HIRE', 'PROBATION', 'ACTIVE'] } },
    select: { id: true, email: true, first_name: true, last_name: true },
  });
}

/** List on-probation employees whose probation period ends within the configured ahead window (for UI hints). */
export async function listSoonToExpireProbationEmployees(): Promise<
  Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    probation_end: string;
  }>
> {
  const now = new Date();
  const ahead = new Date(now);
  ahead.setUTCDate(ahead.getUTCDate() + env.PROBATION_AHEAD_DAYS);

  const employees = await prisma.employee.findMany({
    where: { deleted_at: null, status: { in: ['NEW_HIRE', 'PROBATION'] } },
    select: { id: true, first_name: true, last_name: true, email: true, hire_date: true },
  });

  const result: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    probation_end: string;
  }> = [];
  for (const emp of employees) {
    if (!emp.hire_date) continue;
    const probationEnd = computeProbationEnd(emp.hire_date, env.PROBATION_DEFAULT_MONTHS);
    if (probationEnd.getTime() >= now.getTime() && probationEnd.getTime() <= ahead.getTime()) {
      result.push({
        id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name,
        email: emp.email,
        probation_end: probationEnd.toISOString(),
      });
    }
  }
  return result;
}

export async function listEvaluationCycles(params: {
  status?: string | undefined;
  role: string;
  userId: string;
}): Promise<unknown[]> {
  const where: Record<string, unknown> = { deleted_at: null };

  // Non-HR users should not see DRAFT cycles
  const isHR = params.role === 'ADMIN' || params.role === 'HR_MANAGER';
  if (!isHR) {
    where.status = { in: ['OPEN', 'CLOSED'] } as Record<string, unknown>;
  }

  if (params.status) where.status = params.status;

  return prisma.evaluationCycle.findMany({
    where,
    include: { _count: { select: { reviews: true } } },
    orderBy: { period_end: 'desc' },
  });
}

export async function createEvaluationCycle(params: {
  type: EvaluationType;
  periodStart: Date;
  periodEnd: Date;
  selfEvalStart: Date;
  selfEvalEnd: Date;
  managerEvalStart: Date;
  managerEvalEnd: Date;
  hrReviewStart: Date;
  hrReviewEnd: Date;
}): Promise<unknown> {
  // Validate date sequences
  if (params.periodStart.getTime() >= params.periodEnd.getTime()) {
    throw new HttpError(400, 'Period start must be before period end');
  }
  if (params.selfEvalStart.getTime() >= params.selfEvalEnd.getTime()) {
    throw new HttpError(400, 'Self-evaluation start must be before end');
  }
  if (params.managerEvalStart.getTime() >= params.managerEvalEnd.getTime()) {
    throw new HttpError(400, 'Manager evaluation start must be before end');
  }
  if (params.hrReviewStart.getTime() >= params.hrReviewEnd.getTime()) {
    throw new HttpError(400, 'HR review start must be before end');
  }
  // Validate phase sequence: self → manager → HR
  if (params.selfEvalStart.getTime() < params.periodStart.getTime()) {
    throw new HttpError(400, 'Self-evaluation phase must start within the evaluation period');
  }
  if (params.selfEvalEnd.getTime() > params.managerEvalStart.getTime()) {
    throw new HttpError(
      400,
      'Self-evaluation phase must end before manager evaluation phase starts',
    );
  }
  if (params.managerEvalEnd.getTime() > params.hrReviewStart.getTime()) {
    throw new HttpError(400, 'Manager evaluation phase must end before HR review phase starts');
  }
  if (params.hrReviewEnd.getTime() > params.periodEnd.getTime()) {
    throw new HttpError(400, 'HR review phase must end within the evaluation period');
  }

  return withAuditContext(prisma, null, null, async (tx) => {
    const cycle = await tx.evaluationCycle.create({
      data: {
        type: params.type,
        period_start: params.periodStart,
        period_end: params.periodEnd,
        self_eval_start: params.selfEvalStart,
        self_eval_end: params.selfEvalEnd,
        manager_eval_start: params.managerEvalStart,
        manager_eval_end: params.managerEvalEnd,
        hr_review_start: params.hrReviewStart,
        hr_review_end: params.hrReviewEnd,
        status: CycleStatus.DRAFT,
      },
    });

    // Create performance reviews for the cycle's participants: probation
    // candidates for PROBATION cycles, all active employees otherwise.
    const participants = await getCycleParticipants({
      type: params.type,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    });
    for (const emp of participants) {
      await tx.performanceReview.create({
        data: { cycle_id: cycle.id, employee_id: emp.id, status: ReviewStatus.NOT_STARTED },
      });
    }
    return cycle;
  });
}

export async function openEvaluationCycle(id: string): Promise<unknown> {
  const cycle = await prisma.evaluationCycle.findFirst({ where: { id, deleted_at: null } });
  if (!cycle) throw new HttpError(404, 'Evaluation cycle not found');
  assertCycleStatus(cycle, CycleStatus.DRAFT, 'open');

  return withAuditContext(prisma, null, null, async (tx) => {
    const updated = await tx.evaluationCycle.update({
      where: { id },
      data: { status: CycleStatus.OPEN },
    });
    // Notify only the cycle's enrolled participants (probation candidates for
    // PROBATION cycles, all active employees otherwise).
    const participants = await getCycleParticipants({
      type: cycle.type as EvaluationType,
      periodStart: cycle.period_start,
      periodEnd: cycle.period_end,
    });
    for (const emp of participants) {
      if (emp.email) {
        await sendEvaluationCycleEmail(
          emp.email,
          `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim(),
          cycle.type,
        );
      }
    }
    return updated;
  });
}

export async function closeEvaluationCycle(id: string): Promise<unknown> {
  const cycle = await prisma.evaluationCycle.findFirst({ where: { id, deleted_at: null } });
  if (!cycle) throw new HttpError(404, 'Evaluation cycle not found');
  assertCycleStatus(cycle, CycleStatus.OPEN, 'close');

  return withAuditContext(prisma, null, null, async (tx) => {
    // Mark incomplete reviews as completed with auto-close note
    await tx.performanceReview.updateMany({
      where: { cycle_id: id, status: { not: ReviewStatus.COMPLETED } },
      data: {
        status: ReviewStatus.COMPLETED,
        hr_comments: 'Auto-closed: evaluation was not completed before cycle closure',
      },
    });
    return tx.evaluationCycle.update({ where: { id }, data: { status: CycleStatus.CLOSED } });
  });
}

/**
 * Auto-create and open a PROBATION cycle for each on-probation employee whose
 * probation period ends within the configured ahead window. Idempotent: skips
 * employees who already have a PROBATION cycle. Returns the number of cycles created.
 */
export async function autoCreateProbationCycles(): Promise<{ created: number }> {
  const now = new Date();
  const ahead = new Date(now);
  ahead.setUTCDate(ahead.getUTCDate() + env.PROBATION_AHEAD_DAYS);

  const employees = await prisma.employee.findMany({
    where: { deleted_at: null, status: { in: ['NEW_HIRE', 'PROBATION'] } },
    select: { id: true, email: true, first_name: true, last_name: true, hire_date: true },
  });

  let created = 0;

  for (const emp of employees) {
    if (!emp.hire_date) continue;
    const probationEnd = computeProbationEnd(emp.hire_date, env.PROBATION_DEFAULT_MONTHS);
    // Only employees whose probation ends within the ahead window (and not already past).
    if (probationEnd.getTime() < now.getTime() || probationEnd.getTime() > ahead.getTime()) {
      continue;
    }

    // Idempotency: skip if the employee already has a review in an existing PROBATION cycle.
    const existing = await prisma.performanceReview.findFirst({
      where: {
        employee_id: emp.id,
        deleted_at: null,
        cycle: { type: EvaluationType.PROBATION, deleted_at: null },
      },
      select: { id: true },
    });
    if (existing) continue;

    const periodStart = now;
    const periodEnd = probationEnd;

    await withAuditContext(prisma, null, null, async (tx) => {
      const cycle = await tx.evaluationCycle.create({
        data: {
          type: EvaluationType.PROBATION,
          period_start: periodStart,
          period_end: periodEnd,
          self_eval_start: periodStart,
          self_eval_end: probationEnd,
          manager_eval_start: periodStart,
          manager_eval_end: probationEnd,
          hr_review_start: periodStart,
          hr_review_end: probationEnd,
          status: CycleStatus.OPEN,
        },
      });
      await tx.performanceReview.create({
        data: { cycle_id: cycle.id, employee_id: emp.id, status: ReviewStatus.NOT_STARTED },
      });
      await sendEvaluationCycleEmail(
        emp.email,
        `${emp.first_name} ${emp.last_name}`.trim(),
        EvaluationType.PROBATION,
      );
    });

    created += 1;
  }

  return { created };
}

// ── Performance Reviews ────────────────────────

export async function getMyReviews(params: { role: string; userId: string }): Promise<unknown[]> {
  const employee = await prisma.employee.findUnique({
    where: { user_id: params.userId },
    select: { id: true },
  });
  if (!employee) return [];

  const where: Record<string, unknown> = { deleted_at: null };

  if (params.role === 'EMPLOYEE') {
    where.employee_id = employee.id;
  } else if (params.role === 'MANAGER') {
    const reports = await prisma.employee.findMany({
      where: { manager_id: employee.id },
      select: { id: true },
    });
    where.OR = [{ employee_id: employee.id }, { employee_id: { in: reports.map((r) => r.id) } }];
  }

  return prisma.performanceReview.findMany({
    where,
    include: {
      cycle: true,
      employee: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          manager: { select: { id: true, first_name: true, last_name: true } },
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });
}

export async function submitSelfEvaluation(params: {
  reviewId: string;
  selfEval: unknown;
  actorId: string;
  actorName: string;
  actorEmployeeId: string | null;
}): Promise<unknown> {
  const review = await prisma.performanceReview.findFirst({
    where: { id: params.reviewId, deleted_at: null },
    include: { cycle: true },
  });
  if (!review) throw new HttpError(404, 'Review not found');

  // Ownership check: only the review's employee can submit self-evaluation
  if (!params.actorEmployeeId) {
    throw new HttpError(403, 'You must be assigned as an employee to submit self-evaluation');
  }
  if (params.actorEmployeeId !== review.employee_id) {
    throw new HttpError(403, 'You can only submit self-evaluation for your own review');
  }

  // Cycle must be OPEN
  assertCycleStatus(review.cycle, CycleStatus.OPEN, 'submit self-evaluation for');

  // Phase window check
  assertPhaseWindow(review.cycle.self_eval_start, review.cycle.self_eval_end, 'Self-evaluation');

  // Immutable after submission
  if (review.self_eval_submitted_at) {
    throw new HttpError(400, 'Self-evaluation already submitted and is immutable');
  }

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.performanceReview.update({
      where: { id: params.reviewId },
      data: {
        self_eval: params.selfEval as never,
        self_eval_submitted_at: new Date(),
        status: ReviewStatus.MANAGER_EVALUATION,
      },
    }),
  );
}

export async function submitManagerEvaluation(params: {
  reviewId: string;
  managerEval: unknown;
  actorId: string;
  actorName: string;
  actorEmployeeId: string | null;
}): Promise<unknown> {
  const review = await prisma.performanceReview.findFirst({
    where: { id: params.reviewId, deleted_at: null },
    include: { cycle: true, employee: { select: { id: true, manager_id: true } } },
  });
  if (!review) throw new HttpError(404, 'Review not found');

  // Manager verification: only the employee's direct manager can submit
  if (!params.actorEmployeeId) {
    throw new HttpError(403, 'You must be assigned as an employee to submit manager evaluation');
  }
  if (review.employee.manager_id !== params.actorEmployeeId) {
    throw new HttpError(403, 'You are not the manager of this employee');
  }

  // Cycle must be OPEN
  assertCycleStatus(review.cycle, CycleStatus.OPEN, 'submit manager evaluation for');

  // Phase window check
  assertPhaseWindow(
    review.cycle.manager_eval_start,
    review.cycle.manager_eval_end,
    'Manager evaluation',
  );

  // Self-eval must be submitted first
  if (!review.self_eval_submitted_at) {
    throw new HttpError(400, 'Self-evaluation must be submitted before manager evaluation');
  }

  if (review.manager_eval_submitted_at) {
    throw new HttpError(400, 'Manager evaluation already submitted and is immutable');
  }

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.performanceReview.update({
      where: { id: params.reviewId },
      data: {
        manager_eval: params.managerEval as never,
        manager_eval_submitted_at: new Date(),
        status: ReviewStatus.HR_REVIEW,
      },
    }),
  );
}

export async function finalizeReview(params: {
  reviewId: string;
  overallRating: number;
  hrComments?: string | undefined;
  actorId: string;
  actorName: string;
}): Promise<unknown> {
  const review = await prisma.performanceReview.findFirst({
    where: { id: params.reviewId, deleted_at: null },
    include: { cycle: true },
  });
  if (!review) throw new HttpError(404, 'Review not found');

  // Cycle must be OPEN
  assertCycleStatus(review.cycle, CycleStatus.OPEN, 'finalize review for');

  // Manager eval must be submitted first
  if (!review.manager_eval_submitted_at) {
    throw new HttpError(400, 'Manager evaluation must be submitted before finalization');
  }

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.performanceReview.update({
      where: { id: params.reviewId },
      data: {
        overall_rating: params.overallRating,
        hr_comments: params.hrComments ?? null,
        hr_finalized_at: new Date(),
        status: ReviewStatus.COMPLETED,
      },
    }),
  );
}

export async function addRebuttal(params: {
  reviewId: string;
  rebuttal: string;
  actorId: string;
  actorName: string;
  actorEmployeeId: string | null;
}): Promise<unknown> {
  const review = await prisma.performanceReview.findFirst({
    where: { id: params.reviewId, deleted_at: null },
    include: { cycle: true },
  });
  if (!review) throw new HttpError(404, 'Review not found');

  // Ownership check: only the review's employee can add a rebuttal
  if (!params.actorEmployeeId) {
    throw new HttpError(403, 'You must be assigned as an employee to add a rebuttal');
  }
  if (params.actorEmployeeId !== review.employee_id) {
    throw new HttpError(403, 'You can only add a rebuttal to your own review');
  }

  // Cycle must be CLOSED for rebuttals
  assertCycleStatus(review.cycle, CycleStatus.CLOSED, 'add rebuttal for');

  if (review.status !== ReviewStatus.COMPLETED) {
    throw new HttpError(400, 'Rebuttal can only be added after finalization');
  }

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.performanceReview.update({
      where: { id: params.reviewId },
      data: { rebuttal: params.rebuttal },
    }),
  );
}
