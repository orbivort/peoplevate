import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SeparationType, ClearanceItemStatus, OffboardingStatus } from '#prisma';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHR } from '../middleware/rbac.js';
import * as offboarding from '../services/offboarding-service.js';

export const offboardingRoutes: Router = Router();
offboardingRoutes.use(authenticate);

// ── Resignation ────────────────────────────────

const resignationSchema = z.object({
  reason: z.string().optional(),
  lastWorkingDay: z.coerce.date(),
});

offboardingRoutes.post('/resignations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = resignationSchema.parse(req.body);
    const user = getAuthUser(req)!;
    if (!user.employeeId) {
      res.status(400).json({ error: 'No employee profile linked to your account' });
      return;
    }
    const result = await offboarding.submitResignation({
      employeeId: user.employeeId,
      ...data,
      actorId: user.userId,
      actorName: user.email,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ── Termination (HR/Manager) ───────────────────

const terminationSchema = z.object({
  employeeId: z.string().min(1),
  separationType: z.nativeEnum(SeparationType),
  reason: z.string().optional(),
  effectiveDate: z.coerce.date(),
});

offboardingRoutes.post('/terminations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = terminationSchema.parse(req.body);
    const user = getAuthUser(req)!;

    // Dismissal requires HR-only initiation
    if (
      data.separationType === SeparationType.DISMISSAL &&
      user.role !== 'ADMIN' &&
      user.role !== 'HR_MANAGER'
    ) {
      res.status(403).json({ error: 'Dismissal can only be initiated by HR' });
      return;
    }
    if (user.role === 'EMPLOYEE') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const result = await offboarding.initiateTermination({
      employeeId: data.employeeId,
      separationType: data.separationType,
      reason: data.reason,
      effectiveDate: data.effectiveDate,
      initiatedBy: user.userId,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

offboardingRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const records = await offboarding.listOffboardingRecords({
      role: user.role,
      userId: user.userId,
      status:
        typeof req.query.status === 'string' ? (req.query.status as OffboardingStatus) : undefined,
    });
    res.json({ records });
  } catch (err) {
    next(err);
  }
});

offboardingRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await offboarding.getOffboardingRecord(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

// ── Clearance ──────────────────────────────────

offboardingRoutes.get('/:id/clearance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ items: await offboarding.listClearanceItems(String(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

const updateItemSchema = z.object({
  status: z.nativeEnum(ClearanceItemStatus).optional(),
  responsiblePartyId: z.string().optional(),
  waivedReason: z.string().optional(),
});

offboardingRoutes.patch(
  '/clearance-items/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updateItemSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await offboarding.updateClearanceItem({
          id: String(req.params.id),
          ...data,
          actorId: user.userId,
          actorRole: user.role,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

offboardingRoutes.post(
  '/:id/close',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      res.json(await offboarding.closeOffboarding(String(req.params.id), user.userId, user.role));
    } catch (err) {
      next(err);
    }
  },
);

// ── Exit interview ─────────────────────────────

const exitInterviewSchema = z.object({
  responses: z.unknown(),
  declined: z.boolean().optional(),
});

offboardingRoutes.post(
  '/:id/exit-interview',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = exitInterviewSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.status(201).json(
        await offboarding.conductExitInterview({
          offboardingId: String(req.params.id),
          responses: data.responses,
          declined: data.declined,
          conductedBy: user.userId,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);
