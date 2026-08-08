import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    user: { findMany: vi.fn() },
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { userId: 'u-1', email: 'admin@example.com', role: 'ADMIN', employeeId: 'emp-1' };
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireAdmin: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../utils/audit-context.js', () => ({
  withAuditContext: vi.fn(
    (_prisma: unknown, _actorId: string, _actorName: string, cb: () => unknown) => cb(),
  ),
}));

vi.mock('../services/auth-service.js', () => ({
  inviteUser: vi.fn(),
  changeUserRole: vi.fn(),
  changeUserStatus: vi.fn(),
  adminResetPassword: vi.fn(),
  deleteUser: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import { withAuditContext } from '../utils/audit-context.js';
import * as authService from '../services/auth-service.js';
import { userRoutes } from './user-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  userFindMany: vi.mocked(prisma.user.findMany),
  withAuditContext: vi.mocked(withAuditContext),
  inviteUser: vi.mocked(authService.inviteUser),
  changeUserRole: vi.mocked(authService.changeUserRole),
  changeUserStatus: vi.mocked(authService.changeUserStatus),
  adminResetPassword: vi.mocked(authService.adminResetPassword),
  deleteUser: vi.mocked(authService.deleteUser),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
  app.use(errorHandler);
  return app;
}

describe('user-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.userFindMany.mockResolvedValue([] as never);
    mocked.inviteUser.mockResolvedValue(undefined as never);
    mocked.changeUserRole.mockResolvedValue(undefined as never);
    mocked.changeUserStatus.mockResolvedValue(undefined as never);
    mocked.adminResetPassword.mockResolvedValue(undefined as never);
    mocked.deleteUser.mockResolvedValue(undefined as never);
  });

  describe('GET /api/users', () => {
    it('lists non-deleted users', async () => {
      mocked.userFindMany.mockResolvedValue([{ id: 'u-1' }] as never);

      const res = await request(buildApp()).get('/api/users');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ users: [{ id: 'u-1' }] });
      const arg = mocked.userFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
      expect(arg.where).toEqual({ deleted_at: null });
    });

    it('filters by role', async () => {
      await request(buildApp()).get('/api/users?role=ADMIN');

      const arg = mocked.userFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
      expect(arg.where.role).toBe('ADMIN');
    });

    it('applies a search filter across email and employee name', async () => {
      await request(buildApp()).get('/api/users?search=jane');

      const arg = mocked.userFindMany.mock.calls[0]?.[0] as {
        where: { OR?: unknown[] };
      };
      expect(arg.where.OR).toHaveLength(2);
    });

    it('forwards database errors', async () => {
      mocked.userFindMany.mockRejectedValue(new Error('db down'));

      const res = await request(buildApp()).get('/api/users');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/users/invite', () => {
    it('invites a user within an audit context', async () => {
      const res = await request(buildApp())
        .post('/api/users/invite')
        .send({ email: 'new@example.com', role: 'EMPLOYEE', employeeId: 'emp-2' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ message: 'Invitation sent' });
      expect(mocked.inviteUser).toHaveBeenCalledWith({
        email: 'new@example.com',
        role: 'EMPLOYEE',
        employeeId: 'emp-2',
        actorId: 'u-1',
        actorName: 'admin@example.com',
      });
      expect(mocked.withAuditContext).toHaveBeenCalled();
    });

    it('returns 400 on an invalid email', async () => {
      const res = await request(buildApp())
        .post('/api/users/invite')
        .send({ email: 'not-an-email', role: 'EMPLOYEE' });

      expect(res.status).toBe(400);
      expect(mocked.inviteUser).not.toHaveBeenCalled();
    });

    it('returns 400 on an invalid role', async () => {
      const res = await request(buildApp())
        .post('/api/users/invite')
        .send({ email: 'new@example.com', role: 'SUPERUSER' });

      expect(res.status).toBe(400);
      expect(mocked.inviteUser).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.inviteUser.mockRejectedValue(
        Object.assign(new Error('Email already registered'), { status: 409 }),
      );

      const res = await request(buildApp())
        .post('/api/users/invite')
        .send({ email: 'new@example.com', role: 'EMPLOYEE' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Email already registered');
    });
  });

  describe('PATCH /api/users/:id/role', () => {
    it('changes a user role', async () => {
      const res = await request(buildApp())
        .patch('/api/users/u-2/role')
        .send({ role: 'HR_MANAGER' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Role updated' });
      expect(mocked.changeUserRole).toHaveBeenCalledWith({
        userId: 'u-2',
        newRole: 'HR_MANAGER',
        actorId: 'u-1',
      });
    });

    it('returns 400 on an invalid role', async () => {
      const res = await request(buildApp()).patch('/api/users/u-2/role').send({ role: 'NOPE' });

      expect(res.status).toBe(400);
      expect(mocked.changeUserRole).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.changeUserRole.mockRejectedValue(
        Object.assign(new Error('User not found'), { status: 404 }),
      );

      const res = await request(buildApp())
        .patch('/api/users/u-2/role')
        .send({ role: 'HR_MANAGER' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });
  });

  describe('PATCH /api/users/:id/status', () => {
    it('changes a user status', async () => {
      const res = await request(buildApp())
        .patch('/api/users/u-2/status')
        .send({ status: 'DEACTIVATED' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Status updated' });
      expect(mocked.changeUserStatus).toHaveBeenCalledWith({
        userId: 'u-2',
        status: 'DEACTIVATED',
        actorId: 'u-1',
      });
    });

    it('returns 400 on an invalid status', async () => {
      const res = await request(buildApp())
        .patch('/api/users/u-2/status')
        .send({ status: 'PAUSED' });

      expect(res.status).toBe(400);
      expect(mocked.changeUserStatus).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/users/:id/reset-password', () => {
    it('triggers an admin password reset', async () => {
      const res = await request(buildApp()).post('/api/users/u-2/reset-password');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Password reset email sent' });
      expect(mocked.adminResetPassword).toHaveBeenCalledWith({
        userId: 'u-2',
        actorId: 'u-1',
      });
    });

    it('forwards service errors', async () => {
      mocked.adminResetPassword.mockRejectedValue(
        Object.assign(new Error('User not found'), { status: 404 }),
      );

      const res = await request(buildApp()).post('/api/users/u-2/reset-password');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('deletes a user', async () => {
      const res = await request(buildApp()).delete('/api/users/u-2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'User deleted' });
      expect(mocked.deleteUser).toHaveBeenCalledWith({ userId: 'u-2', actorId: 'u-1' });
    });

    it('forwards service errors', async () => {
      mocked.deleteUser.mockRejectedValue(
        Object.assign(new Error('Cannot delete your own account'), { status: 400 }),
      );

      const res = await request(buildApp()).delete('/api/users/u-2');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot delete your own account');
    });
  });
});
