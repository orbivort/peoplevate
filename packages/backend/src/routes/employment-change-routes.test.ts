import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ChangeType } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
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
  requireHRorManager: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../services/employment-change-service.js', () => ({
  listChanges: vi.fn(),
  recordChange: vi.fn(),
  applyPendingChange: vi.fn(),
}));

import { getAuthUser } from '../middleware/auth.js';
import { prisma } from '../config/prisma.js';
import * as changeService from '../services/employment-change-service.js';
import { employmentChangeRoutes } from './employment-change-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  listChanges: vi.mocked(changeService.listChanges),
  recordChange: vi.mocked(changeService.recordChange),
  applyPendingChange: vi.mocked(changeService.applyPendingChange),
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  employeeFindFirst: vi.mocked(prisma.employee.findFirst),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/employees', employmentChangeRoutes);
  app.use(errorHandler);
  return app;
}

describe('employment-change-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the default HR user before each test so MANAGER overrides do not leak.
    vi.mocked(getAuthUser).mockImplementation((req: { user?: unknown }) => req.user);
    mocked.listChanges.mockResolvedValue([]);
    mocked.recordChange.mockResolvedValue(undefined);
    mocked.applyPendingChange.mockResolvedValue(undefined);
  });

  describe('GET /api/employees/:id/changes', () => {
    it('lists changes for the employee (HR path)', async () => {
      mocked.listChanges.mockResolvedValue([{ id: 'c1' }]);

      const res = await request(buildApp()).get('/api/employees/emp-1/changes');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ changes: [{ id: 'c1' }] });
      expect(mocked.listChanges).toHaveBeenCalledWith('emp-1');
      // HR role skips the employee/manager lookups
      expect(mocked.employeeFindUnique).not.toHaveBeenCalled();
      expect(mocked.employeeFindFirst).not.toHaveBeenCalled();
    });

    it('lists changes for a manager when the target is a direct report', async () => {
      // Reconfigure auth mock to a MANAGER for this request.
      vi.mocked(getAuthUser).mockReturnValue({
        userId: 'u-mgr',
        email: 'mgr@example.com',
        role: 'MANAGER',
        employeeId: 'mgr-emp',
      } as never);

      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-emp' });
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'mgr-emp' });
      mocked.listChanges.mockResolvedValue([{ id: 'c2' }]);

      const res = await request(buildApp()).get('/api/employees/direct-report/changes');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ changes: [{ id: 'c2' }] });
      expect(mocked.listChanges).toHaveBeenCalledWith('direct-report');
    });

    it('returns 403 when a manager targets a non-direct-report', async () => {
      vi.mocked(getAuthUser).mockReturnValue({
        userId: 'u-mgr',
        email: 'mgr@example.com',
        role: 'MANAGER',
        employeeId: 'mgr-emp',
      } as never);

      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-emp' });
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'someone-else' });

      const res = await request(buildApp()).get('/api/employees/not-my-report/changes');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'You can only view changes for your direct reports' });
      expect(mocked.listChanges).not.toHaveBeenCalled();
    });

    it('returns 403 when the target employee does not exist (manager path)', async () => {
      vi.mocked(getAuthUser).mockReturnValue({
        userId: 'u-mgr',
        email: 'mgr@example.com',
        role: 'MANAGER',
        employeeId: 'mgr-emp',
      } as never);

      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-emp' });
      mocked.employeeFindFirst.mockResolvedValue(null);

      const res = await request(buildApp()).get('/api/employees/missing/changes');

      expect(res.status).toBe(403);
      expect(mocked.listChanges).not.toHaveBeenCalled();
    });

    it('returns 403 when the manager has no linked employee record', async () => {
      vi.mocked(getAuthUser).mockReturnValue({
        userId: 'u-mgr',
        email: 'mgr@example.com',
        role: 'MANAGER',
        employeeId: null,
      } as never);

      mocked.employeeFindUnique.mockResolvedValue(null);
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'mgr-emp' });

      const res = await request(buildApp()).get('/api/employees/direct-report/changes');

      expect(res.status).toBe(403);
      expect(mocked.listChanges).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.listChanges.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

      const res = await request(buildApp()).get('/api/employees/emp-1/changes');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('POST /api/employees/:id/changes', () => {
    it('records a change (HR path)', async () => {
      const res = await request(buildApp())
        .post('/api/employees/emp-1/changes')
        .send({ changeType: ChangeType.PROMOTION, effectiveDate: '2026-02-01', reason: 'good' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ message: 'Change recorded' });
      expect(mocked.recordChange).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp-1',
          changeType: ChangeType.PROMOTION,
          effectiveDate: expect.any(Date),
          reason: 'good',
          recordedBy: 'u-1',
          role: 'HR_MANAGER',
          isDirectReport: false,
        }),
      );
      expect(mocked.employeeFindUnique).not.toHaveBeenCalled();
      expect(mocked.employeeFindFirst).not.toHaveBeenCalled();
    });

    it('records a change for a direct report when called by a manager', async () => {
      vi.mocked(getAuthUser).mockReturnValue({
        userId: 'u-mgr',
        email: 'mgr@example.com',
        role: 'MANAGER',
        employeeId: 'mgr-emp',
      } as never);

      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-emp' });
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'mgr-emp' });

      const res = await request(buildApp())
        .post('/api/employees/direct-report/changes')
        .send({ changeType: ChangeType.STATUS_CHANGE, effectiveDate: '2026-03-01' });

      expect(res.status).toBe(201);
      expect(mocked.recordChange).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'MANAGER',
          isDirectReport: true,
          recordedBy: 'u-mgr',
        }),
      );
    });

    it('flags isDirectReport false when manager is not the target manager', async () => {
      vi.mocked(getAuthUser).mockReturnValue({
        userId: 'u-mgr',
        email: 'mgr@example.com',
        role: 'MANAGER',
        employeeId: 'mgr-emp',
      } as never);

      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-emp' });
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'other-mgr' });

      const res = await request(buildApp())
        .post('/api/employees/not-my-report/changes')
        .send({ changeType: ChangeType.STATUS_CHANGE, effectiveDate: '2026-03-01' });

      expect(res.status).toBe(201);
      expect(mocked.recordChange).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'MANAGER', isDirectReport: false }),
      );
    });

    it('returns 400 on invalid body', async () => {
      const res = await request(buildApp()).post('/api/employees/emp-1/changes').send({});

      expect(res.status).toBe(400);
      expect(mocked.recordChange).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.recordChange.mockRejectedValue(
        Object.assign(new Error('not allowed'), { status: 403 }),
      );

      const res = await request(buildApp())
        .post('/api/employees/emp-1/changes')
        .send({ changeType: ChangeType.PROMOTION, effectiveDate: '2026-02-01' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('not allowed');
    });
  });

  describe('PATCH /api/employees/:id/changes/:changeId/apply', () => {
    it('applies a pending change', async () => {
      const res = await request(buildApp()).patch('/api/employees/emp-1/changes/c1/apply');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Change applied' });
      expect(mocked.applyPendingChange).toHaveBeenCalledWith('c1');
    });

    it('forwards service errors', async () => {
      mocked.applyPendingChange.mockRejectedValue(
        Object.assign(new Error('not pending'), { status: 400 }),
      );

      const res = await request(buildApp()).patch('/api/employees/emp-1/changes/cx/apply');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not pending');
    });
  });
});
