import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    department: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    employee: { count: vi.fn() },
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = {
      userId: 'u-1',
      email: 'jane@example.com',
      role: 'HR_MANAGER',
      employeeId: 'emp-1',
    };
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireHR: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../utils/audit-context.js', () => ({
  withAuditContext: vi.fn(
    (_prisma: unknown, _actorId: string, _actorName: string, cb: () => unknown) => cb(),
  ),
}));

vi.mock('../services/org-service.js', () => ({
  listDepartments: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
}));

import { withAuditContext } from '../utils/audit-context.js';
import * as orgService from '../services/org-service.js';
import { departmentRoutes } from './department-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  listDepartments: vi.mocked(orgService.listDepartments),
  createDepartment: vi.mocked(orgService.createDepartment),
  updateDepartment: vi.mocked(orgService.updateDepartment),
  deleteDepartment: vi.mocked(orgService.deleteDepartment),
  withAuditContext: vi.mocked(withAuditContext),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/departments', departmentRoutes);
  app.use(errorHandler);
  return app;
}

describe('department-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listDepartments.mockResolvedValue([]);
    mocked.createDepartment.mockResolvedValue({ id: 'dep-1' });
    mocked.updateDepartment.mockResolvedValue({ id: 'dep-1' });
    mocked.deleteDepartment.mockResolvedValue(undefined);
  });

  describe('GET /api/departments', () => {
    it('lists departments', async () => {
      mocked.listDepartments.mockResolvedValue([{ id: 'dep-1' }]);

      const res = await request(buildApp()).get('/api/departments');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ departments: [{ id: 'dep-1' }] });
      expect(mocked.listDepartments).toHaveBeenCalled();
    });
  });

  describe('POST /api/departments', () => {
    it('creates a department with audit context', async () => {
      const res = await request(buildApp()).post('/api/departments').send({ name: 'Engineering' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'dep-1' });
      expect(mocked.createDepartment).toHaveBeenCalledWith({ name: 'Engineering' });
      expect(mocked.withAuditContext).toHaveBeenCalled();
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(buildApp()).post('/api/departments').send({});

      expect(res.status).toBe(400);
      expect(mocked.createDepartment).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/departments/:id', () => {
    it('updates a department', async () => {
      const res = await request(buildApp()).put('/api/departments/dep-1').send({ name: 'R&D' });

      expect(res.status).toBe(200);
      expect(mocked.updateDepartment).toHaveBeenCalledWith('dep-1', {
        name: 'R&D',
        description: undefined,
        parentId: undefined,
      });
    });
  });

  describe('DELETE /api/departments/:id', () => {
    it('deletes a department', async () => {
      const res = await request(buildApp()).delete('/api/departments/dep-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Department deleted' });
      expect(mocked.deleteDepartment).toHaveBeenCalledWith('dep-1');
    });
  });
});
