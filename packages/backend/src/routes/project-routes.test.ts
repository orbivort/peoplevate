import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

const authUser: {
  userId: string;
  email: string;
  role: string;
  employeeId: string | null;
} = { userId: 'u-1', email: 'hr@example.com', role: 'HR_MANAGER', employeeId: null };

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: Request, res: Response, next: NextFunction): void => {
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }
    (req as { user?: unknown }).user = authUser;
    next();
  }),
  getAuthUser: vi.fn((req: Request) => (req as { user?: unknown }).user),
}));

// Faithful stand-in for the real rbac.ts guards so RBAC paths are exercised.
vi.mock('../middleware/rbac.js', () => {
  const requireRoles =
    (...roles: string[]) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const user = (req as { user?: { role: string } }).user;
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      if (!roles.includes(user.role)) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }
      next();
    };
  return {
    requireRoles,
    requireAdmin: requireRoles('ADMIN'),
    requireHR: requireRoles('ADMIN', 'HR_MANAGER'),
    requireHRorManager: requireRoles('ADMIN', 'HR_MANAGER', 'MANAGER'),
    requireAllStaff: requireRoles('ADMIN', 'HR_MANAGER', 'MANAGER', 'EMPLOYEE'),
    hasCapability: () => false,
  };
});

vi.mock('../services/project-service.js', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectsWithEntryCounts: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));

import * as projects from '../services/project-service.js';
import { projectRoutes } from './project-routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import { HttpError } from '../utils/http-error.js';

const mocked = {
  listProjects: vi.mocked(projects.listProjects),
  createProject: vi.mocked(projects.createProject),
  updateProject: vi.mocked(projects.updateProject),
  deleteProject: vi.mocked(projects.deleteProject),
  getProjectsWithEntryCounts: vi.mocked(projects.getProjectsWithEntryCounts),
  listTasks: vi.mocked(projects.listTasks),
  createTask: vi.mocked(projects.createTask),
  updateTask: vi.mocked(projects.updateTask),
  deleteTask: vi.mocked(projects.deleteTask),
};

const PROJECT = { id: 'p-1', code: 'APX', name: 'Apollo X', taskCount: 2 };
const TASK = { id: 't-1', projectId: 'p-1', name: 'Implementation' };

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectRoutes);
  app.use(errorHandler);
  return app;
}

function auth(req: request.Test): request.Test {
  return req.set('Authorization', 'Bearer test-token');
}

describe('project-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.role = 'HR_MANAGER';
    authUser.employeeId = null;
    mocked.listProjects.mockResolvedValue([PROJECT] as never);
    mocked.createProject.mockResolvedValue(PROJECT as never);
    mocked.updateProject.mockResolvedValue(PROJECT as never);
    mocked.deleteProject.mockResolvedValue({ deleted: true } as never);
    mocked.getProjectsWithEntryCounts.mockResolvedValue([{ ...PROJECT, entryCount: 12 }] as never);
    mocked.listTasks.mockResolvedValue([TASK] as never);
    mocked.createTask.mockResolvedValue(TASK as never);
    mocked.updateTask.mockResolvedValue(TASK as never);
    mocked.deleteTask.mockResolvedValue({ deleted: true } as never);
  });

  describe('authentication', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(buildApp()).get('/api/projects');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'No token provided' });
      expect(mocked.listProjects).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/projects', () => {
    it('lists active projects for employees', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).get('/api/projects'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ projects: [PROJECT] });
      expect(mocked.listProjects).toHaveBeenCalledWith({ includeInactive: undefined });
    });

    it('includes inactive projects for HR', async () => {
      const res = await auth(request(buildApp()).get('/api/projects?includeInactive=true'));

      expect(res.status).toBe(200);
      expect(mocked.listProjects).toHaveBeenCalledWith({ includeInactive: true });
    });

    it('returns 403 when an employee requests inactive projects', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).get('/api/projects?includeInactive=true'));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Insufficient permissions' });
      expect(mocked.listProjects).not.toHaveBeenCalled();
    });

    it('returns 400 on an invalid includeInactive value', async () => {
      const res = await auth(request(buildApp()).get('/api/projects?includeInactive=yes'));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
    });
  });

  describe('GET /api/projects/admin-stats', () => {
    it('returns entry counts for HR', async () => {
      const res = await auth(request(buildApp()).get('/api/projects/admin-stats'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ projects: [{ ...PROJECT, entryCount: 12 }] });
    });

    it('returns 403 for employees', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).get('/api/projects/admin-stats'));

      expect(res.status).toBe(403);
      expect(mocked.getProjectsWithEntryCounts).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/projects/:id/tasks', () => {
    it('lists active tasks for employees', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).get('/api/projects/p-1/tasks'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tasks: [TASK] });
      expect(mocked.listTasks).toHaveBeenCalledWith({
        projectId: 'p-1',
        includeInactive: undefined,
      });
    });

    it('includes inactive tasks for HR', async () => {
      const res = await auth(
        request(buildApp()).get('/api/projects/p-1/tasks?includeInactive=true'),
      );

      expect(res.status).toBe(200);
      expect(mocked.listTasks).toHaveBeenCalledWith({ projectId: 'p-1', includeInactive: true });
    });

    it('returns 403 when an employee requests inactive tasks', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(
        request(buildApp()).get('/api/projects/p-1/tasks?includeInactive=true'),
      );

      expect(res.status).toBe(403);
      expect(mocked.listTasks).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/projects', () => {
    it('creates a project for HR', async () => {
      const res = await auth(request(buildApp()).post('/api/projects')).send({
        code: 'APX',
        name: 'Apollo X',
        client: 'Acme Corp',
        isBillable: true,
        startDate: '2026-01-05',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(PROJECT);
      expect(mocked.createProject).toHaveBeenCalledWith({
        code: 'APX',
        name: 'Apollo X',
        client: 'Acme Corp',
        description: undefined,
        isBillable: true,
        startDate: new Date('2026-01-05'),
        endDate: undefined,
        isActive: undefined,
        actorId: 'u-1',
        actorName: 'hr@example.com',
      });
    });

    it('returns 403 for employees', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).post('/api/projects')).send({
        code: 'APX',
        name: 'Apollo X',
      });

      expect(res.status).toBe(403);
      expect(mocked.createProject).not.toHaveBeenCalled();
    });

    it('returns 400 when the code is too long', async () => {
      const res = await auth(request(buildApp()).post('/api/projects')).send({
        code: 'X'.repeat(21),
        name: 'Apollo X',
      });

      expect(res.status).toBe(400);
      expect(mocked.createProject).not.toHaveBeenCalled();
    });

    it('returns 400 when the name is missing', async () => {
      const res = await auth(request(buildApp()).post('/api/projects')).send({ code: 'APX' });

      expect(res.status).toBe(400);
      expect(mocked.createProject).not.toHaveBeenCalled();
    });

    it('forwards duplicate-code conflicts as 409', async () => {
      mocked.createProject.mockRejectedValue(
        new HttpError(409, 'A project with this code already exists'),
      );

      const res = await auth(request(buildApp()).post('/api/projects')).send({
        code: 'APX',
        name: 'Apollo X',
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('A project with this code already exists');
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('updates a project with a partial payload', async () => {
      const res = await auth(request(buildApp()).patch('/api/projects/p-1')).send({
        name: 'Apollo X Phase 2',
        isActive: false,
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(PROJECT);
      expect(mocked.updateProject).toHaveBeenCalledWith({
        projectId: 'p-1',
        name: 'Apollo X Phase 2',
        isActive: false,
        actorId: 'u-1',
        actorName: 'hr@example.com',
      });
    });

    it('returns 403 for employees', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).patch('/api/projects/p-1')).send({ name: 'X' });

      expect(res.status).toBe(403);
      expect(mocked.updateProject).not.toHaveBeenCalled();
    });

    it('returns 400 when the name is empty', async () => {
      const res = await auth(request(buildApp()).patch('/api/projects/p-1')).send({ name: '' });

      expect(res.status).toBe(400);
      expect(mocked.updateProject).not.toHaveBeenCalled();
    });

    it('forwards not-found errors as 404', async () => {
      mocked.updateProject.mockRejectedValue(new HttpError(404, 'Project not found'));

      const res = await auth(request(buildApp()).patch('/api/projects/p-404')).send({ name: 'X' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('soft-deletes a project for HR', async () => {
      const res = await auth(request(buildApp()).delete('/api/projects/p-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });
      expect(mocked.deleteProject).toHaveBeenCalledWith({
        projectId: 'p-1',
        actorId: 'u-1',
        actorName: 'hr@example.com',
      });
    });

    it('returns 403 for employees', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).delete('/api/projects/p-1'));

      expect(res.status).toBe(403);
      expect(mocked.deleteProject).not.toHaveBeenCalled();
    });

    it('forwards entry-referenced conflicts as 409', async () => {
      mocked.deleteProject.mockRejectedValue(
        new HttpError(
          409,
          'Project has timesheet entries and cannot be deleted. Deactivate it instead',
        ),
      );

      const res = await auth(request(buildApp()).delete('/api/projects/p-1'));

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/projects/:id/tasks', () => {
    it('creates a task for HR', async () => {
      const res = await auth(request(buildApp()).post('/api/projects/p-1/tasks')).send({
        name: 'Implementation',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(TASK);
      expect(mocked.createTask).toHaveBeenCalledWith({
        projectId: 'p-1',
        name: 'Implementation',
        actorId: 'u-1',
        actorName: 'hr@example.com',
      });
    });

    it('returns 403 for employees', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).post('/api/projects/p-1/tasks')).send({
        name: 'Implementation',
      });

      expect(res.status).toBe(403);
      expect(mocked.createTask).not.toHaveBeenCalled();
    });

    it('returns 400 when the name is empty', async () => {
      const res = await auth(request(buildApp()).post('/api/projects/p-1/tasks')).send({
        name: '',
      });

      expect(res.status).toBe(400);
      expect(mocked.createTask).not.toHaveBeenCalled();
    });

    it('forwards duplicate-name conflicts as 409', async () => {
      mocked.createTask.mockRejectedValue(
        new HttpError(409, 'A task with this name already exists in this project'),
      );

      const res = await auth(request(buildApp()).post('/api/projects/p-1/tasks')).send({
        name: 'Implementation',
      });

      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /api/projects/:id/tasks/:taskId', () => {
    it('updates a task with a partial payload', async () => {
      const res = await auth(request(buildApp()).patch('/api/projects/p-1/tasks/t-1')).send({
        isActive: false,
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(TASK);
      expect(mocked.updateTask).toHaveBeenCalledWith({
        taskId: 't-1',
        name: undefined,
        isActive: false,
        actorId: 'u-1',
        actorName: 'hr@example.com',
      });
    });

    it('returns 403 for employees', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).patch('/api/projects/p-1/tasks/t-1')).send({
        name: 'X',
      });

      expect(res.status).toBe(403);
      expect(mocked.updateTask).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/projects/:id/tasks/:taskId', () => {
    it('soft-deletes a task for HR', async () => {
      const res = await auth(request(buildApp()).delete('/api/projects/p-1/tasks/t-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });
      expect(mocked.deleteTask).toHaveBeenCalledWith({
        taskId: 't-1',
        actorId: 'u-1',
        actorName: 'hr@example.com',
      });
    });

    it('returns 403 for employees', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(request(buildApp()).delete('/api/projects/p-1/tasks/t-1'));

      expect(res.status).toBe(403);
      expect(mocked.deleteTask).not.toHaveBeenCalled();
    });

    it('forwards entry-referenced conflicts as 409', async () => {
      mocked.deleteTask.mockRejectedValue(
        new HttpError(
          409,
          'Task has timesheet entries and cannot be deleted. Deactivate it instead',
        ),
      );

      const res = await auth(request(buildApp()).delete('/api/projects/p-1/tasks/t-1'));

      expect(res.status).toBe(409);
    });
  });
});
