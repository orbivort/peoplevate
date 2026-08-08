import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireRoles } from '../middleware/rbac.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { UserRole, RetentionAction, type RetentionDataCategory } from '#prisma';
import {
  listPolicies,
  upsertPolicy,
  placeLegalHold,
  releaseLegalHold,
  dryRunPurge,
  executePurge,
} from '../services/retention-service.js';

export const retentionRoutes: Router = Router();

retentionRoutes.use(authenticate);

// GET /api/retention/policies - list all retention policies (Admin only)
retentionRoutes.get(
  '/policies',
  requireRoles(UserRole.ADMIN),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const policies = await listPolicies();
      res.json({ policies });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/retention/policies - create or update a policy (Admin only)
retentionRoutes.put(
  '/policies',
  requireRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { dataCategory, retentionYears, action, description, isDefault } = req.body as {
        dataCategory: RetentionDataCategory;
        retentionYears: number;
        action: RetentionAction;
        description?: string;
        isDefault?: boolean;
      };
      const policy = await upsertPolicy({
        dataCategory,
        retentionYears,
        action,
        ...(description !== undefined ? { description } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
      });
      res.json({ policy });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/retention/purge - execute or dry-run purge (Admin only)
retentionRoutes.post(
  '/purge',
  requireRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { dryRun } = req.query as { dryRun?: string };
      const user = getAuthUser(req)!;

      if (dryRun === 'true') {
        const candidates = await dryRunPurge();
        res.json({ dryRun: true, candidates, count: candidates.length });
      } else {
        const result = await executePurge(user.userId, user.email);
        res.json({ dryRun: false, ...result });
      }
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/retention/legal-hold - place a legal hold (Admin only)
retentionRoutes.post(
  '/legal-hold',
  requireRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entityType, entityId, reason } = req.body as {
        entityType: string;
        entityId: string;
        reason: string;
      };
      const user = getAuthUser(req)!;
      const hold = await placeLegalHold({
        entityType,
        entityId,
        reason,
        actorId: user.userId,
        actorName: user.email,
      });
      res.status(201).json({ hold });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/retention/legal-hold/:id - release a legal hold (Admin only)
retentionRoutes.delete(
  '/legal-hold/:id',
  requireRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      const hold = await releaseLegalHold(String(req.params.id), user.userId, user.email);
      res.json({ hold });
    } catch (err) {
      next(err);
    }
  },
);
