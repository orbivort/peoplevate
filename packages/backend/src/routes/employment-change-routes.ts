import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ChangeType } from '#prisma';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHR, requireHRorManager } from '../middleware/rbac.js';
import * as changeService from '../services/employment-change-service.js';
import { prisma } from '../config/prisma.js';

export const employmentChangeRoutes: Router = Router();

employmentChangeRoutes.use(authenticate);

const recordSchema = z.object({
  changeType: z.nativeEnum(ChangeType),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  effectiveDate: z.coerce.date(),
  reason: z.string().optional(),
});

employmentChangeRoutes.get(
  '/:id/changes',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      if (user.role === 'MANAGER') {
        const selfEmployee = await prisma.employee.findUnique({
          where: { user_id: user.userId },
          select: { id: true },
        });
        const target = await prisma.employee.findFirst({
          where: { id: String(req.params.id) },
          select: { manager_id: true },
        });
        if (!target || target.manager_id !== selfEmployee?.id) {
          res.status(403).json({ error: 'You can only view changes for your direct reports' });
          return;
        }
      }

      const changes = await changeService.listChanges(String(req.params.id));
      res.json({ changes });
    } catch (err) {
      next(err);
    }
  },
);

employmentChangeRoutes.post(
  '/:id/changes',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = recordSchema.parse(req.body);
      const user = getAuthUser(req)!;

      let isDirectReport = false;
      if (user.role === 'MANAGER') {
        const selfEmployee = await prisma.employee.findUnique({
          where: { user_id: user.userId },
          select: { id: true },
        });
        const target = await prisma.employee.findFirst({
          where: { id: String(req.params.id) },
          select: { manager_id: true },
        });
        isDirectReport = target?.manager_id === selfEmployee?.id;
      }

      await changeService.recordChange({
        employeeId: String(req.params.id),
        changeType: data.changeType,
        oldValue: data.oldValue,
        newValue: data.newValue,
        effectiveDate: data.effectiveDate,
        reason: data.reason,
        recordedBy: user.userId,
        role: user.role,
        isDirectReport,
      });

      res.status(201).json({ message: 'Change recorded' });
    } catch (err) {
      next(err);
    }
  },
);

employmentChangeRoutes.patch(
  '/:id/changes/:changeId/apply',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await changeService.applyPendingChange(String(req.params.changeId));
      res.json({ message: 'Change applied' });
    } catch (err) {
      next(err);
    }
  },
);
