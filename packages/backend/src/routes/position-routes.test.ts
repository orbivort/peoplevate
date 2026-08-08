import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    position: {
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
  listPositions: vi.fn(),
  createPosition: vi.fn(),
  updatePosition: vi.fn(),
  deletePosition: vi.fn(),
}));

import { withAuditContext } from '../utils/audit-context.js';
import * as orgService from '../services/org-service.js';
import { positionRoutes } from './position-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  listPositions: vi.mocked(orgService.listPositions),
  createPosition: vi.mocked(orgService.createPosition),
  updatePosition: vi.mocked(orgService.updatePosition),
  deletePosition: vi.mocked(orgService.deletePosition),
  withAuditContext: vi.mocked(withAuditContext),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/positions', positionRoutes);
  app.use(errorHandler);
  return app;
}

describe('position-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listPositions.mockResolvedValue([]);
    mocked.createPosition.mockResolvedValue({ id: 'pos-1' });
    mocked.updatePosition.mockResolvedValue({ id: 'pos-1' });
    mocked.deletePosition.mockResolvedValue(undefined);
  });

  describe('GET /api/positions', () => {
    it('lists positions, optionally filtered by department', async () => {
      mocked.listPositions.mockResolvedValue([{ id: 'pos-1' }]);

      await request(buildApp()).get('/api/positions?departmentId=dep-1');

      expect(mocked.listPositions).toHaveBeenCalledWith('dep-1');
    });
  });

  describe('POST /api/positions', () => {
    it('creates a position with audit context', async () => {
      const res = await request(buildApp())
        .post('/api/positions')
        .send({ name: 'Engineer', grade: 'G7', departmentId: 'dep-1' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'pos-1' });
      expect(mocked.createPosition).toHaveBeenCalledWith({
        name: 'Engineer',
        grade: 'G7',
        departmentId: 'dep-1',
      });
      expect(mocked.withAuditContext).toHaveBeenCalled();
    });

    it('returns 400 on invalid body', async () => {
      const res = await request(buildApp()).post('/api/positions').send({ grade: 'G7' });

      expect(res.status).toBe(400);
      expect(mocked.createPosition).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/positions/:id', () => {
    it('updates a position', async () => {
      const res = await request(buildApp()).put('/api/positions/pos-1').send({ name: 'Senior' });

      expect(res.status).toBe(200);
      expect(mocked.updatePosition).toHaveBeenCalledWith('pos-1', { name: 'Senior' });
    });
  });

  describe('DELETE /api/positions/:id', () => {
    it('deletes a position', async () => {
      const res = await request(buildApp()).delete('/api/positions/pos-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Position deleted' });
      expect(mocked.deletePosition).toHaveBeenCalledWith('pos-1');
    });
  });
});
