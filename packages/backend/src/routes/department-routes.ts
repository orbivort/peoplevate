import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireHR } from '../middleware/rbac.js';
import * as orgService from '../services/org-service.js';
import { withAuditContext } from '../utils/audit-context.js';
import { prisma } from '../config/prisma.js';
import { getAuthUser } from '../middleware/auth.js';

export const departmentRoutes: Router = Router();

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parentId: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
});

departmentRoutes.get(
  '/',
  authenticate,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const departments = await orgService.listDepartments();
      res.json({ departments });
    } catch (err) {
      next(err);
    }
  },
);

departmentRoutes.post(
  '/',
  authenticate,
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const dept = await withAuditContext(prisma, user.userId, user.email, () =>
        orgService.createDepartment(data),
      );
      res.status(201).json(dept);
    } catch (err) {
      next(err);
    }
  },
);

departmentRoutes.put(
  '/:id',
  authenticate,
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updateSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const dept = await withAuditContext(prisma, user.userId, user.email, () =>
        orgService.updateDepartment(String(req.params.id), {
          name: data.name,
          description: data.description,
          parentId: data.parentId ?? undefined,
        }),
      );
      res.json(dept);
    } catch (err) {
      next(err);
    }
  },
);

departmentRoutes.delete(
  '/:id',
  authenticate,
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      await withAuditContext(prisma, user.userId, user.email, () =>
        orgService.deleteDepartment(String(req.params.id)),
      );
      res.json({ message: 'Department deleted' });
    } catch (err) {
      next(err);
    }
  },
);
