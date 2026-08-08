import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { UserRole } from '#prisma';
import {
  getSubjectData,
  eraseSubjectData,
  exportSubjectData,
  resolveSubjectUserId,
} from '../services/data-subject-rights-service.js';

export const dataSubjectRightsRoutes: Router = Router();

dataSubjectRightsRoutes.use(authenticate);

// GET /api/data-subject-rights/access/:userId - Art. 15 access (self or Admin/HR)
dataSubjectRightsRoutes.get(
  '/access/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      const subjectUserId = await resolveSubjectUserId(
        String(req.params.userId),
        user.userId,
        user.role,
      );
      const data = await getSubjectData(subjectUserId);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/data-subject-rights/erasure/:userId - Art. 17 erasure (Admin/HR only)
dataSubjectRightsRoutes.post(
  '/erasure/:userId',
  requireRoles(UserRole.ADMIN, UserRole.HR_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      const result = await eraseSubjectData(String(req.params.userId), user.userId, user.email);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/data-subject-rights/export/:userId - Art. 20 portability (self or Admin/HR)
dataSubjectRightsRoutes.get(
  '/export/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      const { format } = req.query as { format?: string };
      const subjectUserId = await resolveSubjectUserId(
        String(req.params.userId),
        user.userId,
        user.role,
      );
      const result = await exportSubjectData(
        subjectUserId,
        (format as 'json' | 'csv') ?? 'json',
        user.userId,
        user.email,
      );

      if (result.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="data-export-${subjectUserId}.csv"`,
        );
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="data-export-${subjectUserId}.json"`,
        );
      }
      res.json(result.data);
    } catch (err) {
      next(err);
    }
  },
);
