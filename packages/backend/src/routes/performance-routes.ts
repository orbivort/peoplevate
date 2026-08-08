import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { EvaluationType } from '#prisma';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHR } from '../middleware/rbac.js';
import * as performance from '../services/performance-service.js';

export const performanceRoutes: Router = Router();
performanceRoutes.use(authenticate);

// ── Evaluation cycles ──────────────────────────

performanceRoutes.get('/cycles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const cycles = await performance.listEvaluationCycles({
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      role: user.role,
      userId: user.userId,
    });
    res.json({ cycles });
  } catch (err) {
    next(err);
  }
});

// Read-only: on-probation employees whose probation period is ending soon (for UI hints)
performanceRoutes.get(
  '/cycles/probation/eligible',
  requireHR,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ employees: await performance.listSoonToExpireProbationEmployees() });
    } catch (err) {
      next(err);
    }
  },
);

const cycleSchema = z.object({
  type: z.nativeEnum(EvaluationType),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  selfEvalStart: z.coerce.date(),
  selfEvalEnd: z.coerce.date(),
  managerEvalStart: z.coerce.date(),
  managerEvalEnd: z.coerce.date(),
  hrReviewStart: z.coerce.date(),
  hrReviewEnd: z.coerce.date(),
});

performanceRoutes.post(
  '/cycles',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = cycleSchema.parse(req.body);
      res.status(201).json(await performance.createEvaluationCycle(data));
    } catch (err) {
      next(err);
    }
  },
);

performanceRoutes.post(
  '/cycles/:id/open',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await performance.openEvaluationCycle(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

performanceRoutes.post(
  '/cycles/:id/close',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await performance.closeEvaluationCycle(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

// ── Reviews ────────────────────────────────────

performanceRoutes.get('/reviews', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    res.json({ reviews: await performance.getMyReviews({ role: user.role, userId: user.userId }) });
  } catch (err) {
    next(err);
  }
});

const selfEvalSchema = z.object({
  selfEval: z.unknown(),
});

performanceRoutes.post(
  '/reviews/:id/self',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = selfEvalSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await performance.submitSelfEvaluation({
          reviewId: String(req.params.id),
          selfEval: data.selfEval,
          actorId: user.userId,
          actorName: user.email,
          actorEmployeeId: user.employeeId ?? null,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

const managerEvalSchema = z.object({
  managerEval: z.unknown(),
});

performanceRoutes.post(
  '/reviews/:id/manager',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = managerEvalSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await performance.submitManagerEvaluation({
          reviewId: String(req.params.id),
          managerEval: data.managerEval,
          actorId: user.userId,
          actorName: user.email,
          actorEmployeeId: user.employeeId ?? null,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

const finalizeSchema = z.object({
  overallRating: z.coerce.number().int().min(1).max(5),
  hrComments: z.string().optional(),
});

performanceRoutes.post(
  '/reviews/:id/finalize',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = finalizeSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await performance.finalizeReview({
          reviewId: String(req.params.id),
          ...data,
          actorId: user.userId,
          actorName: user.email,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

const rebuttalSchema = z.object({
  rebuttal: z.string().min(1),
});

performanceRoutes.post(
  '/reviews/:id/rebuttal',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = rebuttalSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await performance.addRebuttal({
          reviewId: String(req.params.id),
          rebuttal: data.rebuttal,
          actorId: user.userId,
          actorName: user.email,
          actorEmployeeId: user.employeeId ?? null,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);
