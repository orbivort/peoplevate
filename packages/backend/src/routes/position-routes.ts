import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireHR } from '../middleware/rbac.js';
import * as orgService from '../services/org-service.js';
import { withAuditContext } from '../utils/audit-context.js';
import { prisma } from '../config/prisma.js';
import { getAuthUser } from '../middleware/auth.js';

export const positionRoutes: Router = Router();

const createSchema = z.object({
  name: z.string().min(1),
  grade: z.string().optional(),
  description: z.string().optional(),
  departmentId: z.string().min(1),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  grade: z.string().optional(),
  description: z.string().optional(),
});

positionRoutes.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const departmentId = req.query.departmentId as string | undefined;
    const positions = await orgService.listPositions(departmentId);
    res.json({ positions });
  } catch (err) {
    next(err);
  }
});

positionRoutes.post(
  '/',
  authenticate,
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const pos = await withAuditContext(prisma, user.userId, user.email, () =>
        orgService.createPosition(data),
      );
      res.status(201).json(pos);
    } catch (err) {
      next(err);
    }
  },
);

positionRoutes.put(
  '/:id',
  authenticate,
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updateSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const pos = await withAuditContext(prisma, user.userId, user.email, () =>
        orgService.updatePosition(String(req.params.id), data),
      );
      res.json(pos);
    } catch (err) {
      next(err);
    }
  },
);

positionRoutes.delete(
  '/:id',
  authenticate,
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      await withAuditContext(prisma, user.userId, user.email, () =>
        orgService.deletePosition(String(req.params.id)),
      );
      res.json({ message: 'Position deleted' });
    } catch (err) {
      next(err);
    }
  },
);
