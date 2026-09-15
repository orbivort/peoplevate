import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHR } from '../middleware/rbac.js';
import * as projects from '../services/project-service.js';

export const projectRoutes: Router = Router();
projectRoutes.use(authenticate);

// ── Schemas ─────────────────────────────────────

/** Query-string boolean: only the literals "true"/"false" are accepted. */
const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const listQuerySchema = z.object({
  includeInactive: booleanQuery,
});

const projectBodySchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  client: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  isBillable: z.boolean().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
});

const taskBodySchema = z.object({
  name: z.string().min(1).max(100),
  isActive: z.boolean().optional(),
});

// ── Catalog read (all staff) ────────────────────

projectRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const query = listQuerySchema.parse(req.query);
    // includeInactive is reserved for HR_MANAGER/ADMIN.
    if (query.includeInactive && user.role !== 'HR_MANAGER' && user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    res.json({ projects: await projects.listProjects({ includeInactive: query.includeInactive }) });
  } catch (err) {
    next(err);
  }
});

// ── Admin table (entry counts) ──────────────────

projectRoutes.get(
  '/admin-stats',
  requireHR,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ projects: await projects.getProjectsWithEntryCounts() });
    } catch (err) {
      next(err);
    }
  },
);

// ── Project CRUD (HR) ───────────────────────────

projectRoutes.post('/', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = projectBodySchema.parse(req.body);
    const user = getAuthUser(req)!;
    res
      .status(201)
      .json(
        await projects.createProject({ ...data, actorId: user.userId, actorName: user.email }),
      );
  } catch (err) {
    next(err);
  }
});

projectRoutes.patch('/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = projectBodySchema.partial().parse(req.body);
    const user = getAuthUser(req)!;
    res.json(
      await projects.updateProject({
        projectId: String(req.params.id),
        ...data,
        actorId: user.userId,
        actorName: user.email,
      }),
    );
  } catch (err) {
    next(err);
  }
});

projectRoutes.delete('/:id', requireHR, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    res.json(
      await projects.deleteProject({
        projectId: String(req.params.id),
        actorId: user.userId,
        actorName: user.email,
      }),
    );
  } catch (err) {
    next(err);
  }
});

// ── Task list (all staff; includeInactive reserved for HR) ──────

projectRoutes.get('/:id/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const query = listQuerySchema.parse(req.query);
    // includeInactive is reserved for HR_MANAGER/ADMIN (mirrors GET /).
    if (query.includeInactive && user.role !== 'HR_MANAGER' && user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    res.json({
      tasks: await projects.listTasks({
        projectId: String(req.params.id),
        includeInactive: query.includeInactive,
      }),
    });
  } catch (err) {
    next(err);
  }
});

// ── Task CRUD (HR) ──────────────────────────────

projectRoutes.post(
  '/:id/tasks',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = taskBodySchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.status(201).json(
        await projects.createTask({
          projectId: String(req.params.id),
          name: data.name,
          actorId: user.userId,
          actorName: user.email,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

projectRoutes.patch(
  '/:id/tasks/:taskId',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = taskBodySchema.partial().parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await projects.updateTask({
          taskId: String(req.params.taskId),
          name: data.name,
          isActive: data.isActive,
          actorId: user.userId,
          actorName: user.email,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

projectRoutes.delete(
  '/:id/tasks/:taskId',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      res.json(
        await projects.deleteTask({
          taskId: String(req.params.taskId),
          actorId: user.userId,
          actorName: user.email,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);
