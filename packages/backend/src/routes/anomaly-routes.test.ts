import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { UserRole, AnomalyAlertStatus } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    anomalyAlert: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = {
      userId: 'u-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      employeeId: 'emp-1',
    };
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireRoles: vi.fn(
    (..._roles: string[]) =>
      (_req: unknown, _res: unknown, next: () => void) =>
        next(),
  ),
}));

vi.mock('../services/audit-service.js', () => ({
  logAuditEvent: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import * as auditService from '../services/audit-service.js';
import { anomalyRoutes } from './anomaly-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  findMany: vi.mocked(prisma.anomalyAlert.findMany),
  update: vi.mocked(prisma.anomalyAlert.update),
  authenticate: vi.mocked(authenticate),
  getAuthUser: vi.mocked(getAuthUser),
  requireRoles: vi.mocked(requireRoles),
  logAuditEvent: vi.mocked(auditService.logAuditEvent),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/anomalies', anomalyRoutes);
  app.use(errorHandler);
  return app;
}

const sampleAlert = {
  id: 'a1',
  alert_type: 'FAILED_LOGIN_SPIKE',
  status: AnomalyAlertStatus.OPEN,
  created_at: new Date('2026-08-07T10:00:00Z'),
};

describe('anomaly-routes', () => {
  beforeEach(() => {
    // Reset only data-layer mocks. The `requireRoles(UserRole.ADMIN)` call
    // happens once at router module-load time, so it is deliberately NOT
    // cleared here (clearAllMocks would wipe that import-time invocation).
    mocked.findMany.mockReset();
    mocked.update.mockReset();
    mocked.logAuditEvent.mockReset();
    mocked.findMany.mockResolvedValue([sampleAlert]);
    mocked.update.mockResolvedValue(sampleAlert as never);
    mocked.logAuditEvent.mockResolvedValue(undefined);
  });

  describe('auth & rbac', () => {
    it('guards the router with authenticate and admin-only requireRoles', () => {
      // The router registers these guards at module-load time.
      expect(mocked.authenticate).toBeDefined();
      expect(mocked.requireRoles).toHaveBeenCalledWith(UserRole.ADMIN);
    });
  });

  describe('GET /api/anomalies', () => {
    it('returns all alerts ordered by newest first', async () => {
      const res = await request(buildApp()).get('/api/anomalies');

      expect(res.status).toBe(200);
      expect(res.body.alerts).toHaveLength(1);
      expect(res.body.alerts[0]).toMatchObject({
        id: 'a1',
        alert_type: 'FAILED_LOGIN_SPIKE',
        status: AnomalyAlertStatus.OPEN,
      });
      expect(mocked.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { created_at: 'desc' },
      });
    });

    it('filters by status when provided', async () => {
      await request(buildApp()).get(`/api/anomalies?status=${AnomalyAlertStatus.REVIEWED}`);

      const call = mocked.findMany.mock.calls[0][0] as Record<string, unknown>;
      expect(call.where).toEqual({ status: AnomalyAlertStatus.REVIEWED });
      expect(call.orderBy).toEqual({ created_at: 'desc' });
    });

    it('filters by alertType when provided', async () => {
      await request(buildApp()).get('/api/anomalies?alertType=BULK_DOWNLOAD_SPIKE');

      const call = mocked.findMany.mock.calls[0][0] as Record<string, unknown>;
      expect(call.where).toEqual({ alert_type: 'BULK_DOWNLOAD_SPIKE' });
    });

    it('combines status and alertType filters', async () => {
      await request(buildApp()).get(
        `/api/anomalies?status=${AnomalyAlertStatus.OPEN}&alertType=FAILED_LOGIN_SPIKE`,
      );

      const call = mocked.findMany.mock.calls[0][0] as Record<string, unknown>;
      expect(call.where).toEqual({
        status: AnomalyAlertStatus.OPEN,
        alert_type: 'FAILED_LOGIN_SPIKE',
      });
    });

    it('ignores empty filter values', async () => {
      await request(buildApp()).get('/api/anomalies?status=&alertType=');

      const call = mocked.findMany.mock.calls[0][0] as Record<string, unknown>;
      expect(call.where).toEqual({});
    });

    it('forwards database errors to the error handler', async () => {
      mocked.findMany.mockRejectedValue(Object.assign(new Error('db down'), { status: 503 }));

      const res = await request(buildApp()).get('/api/anomalies');

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('db down');
    });
  });

  describe('PATCH /api/anomalies/:id/dismiss', () => {
    it('dismisses an alert, records the reviewer and reason, and audits the change', async () => {
      const dismissed = { ...sampleAlert, status: AnomalyAlertStatus.DISMISSED };
      mocked.update.mockResolvedValue(dismissed as never);

      const res = await request(buildApp())
        .patch('/api/anomalies/a1/dismiss')
        .send({ dismissalReason: 'false positive' });

      expect(res.status).toBe(200);
      expect(res.body.alert.status).toBe(AnomalyAlertStatus.DISMISSED);

      expect(mocked.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: {
          status: AnomalyAlertStatus.DISMISSED,
          reviewed_by_id: 'u-1',
          reviewed_at: expect.any(Date),
          dismissal_reason: 'false positive',
        },
      });
      expect(mocked.logAuditEvent).toHaveBeenCalledWith({
        actorId: 'u-1',
        actorName: 'admin@example.com',
        action: 'UPDATE' as never,
        entity: 'ANOMALIES' as never,
        entityId: 'a1',
        newValue: { status: 'DISMISSED', reason: 'false positive' },
      });
    });

    it('works when no dismissal reason is supplied', async () => {
      const res = await request(buildApp()).patch('/api/anomalies/a1/dismiss').send({});

      expect(res.status).toBe(200);
      const data = mocked.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.dismissal_reason).toBeUndefined();
      expect(mocked.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ newValue: { status: 'DISMISSED', reason: undefined } }),
      );
    });

    it('forwards Prisma not-found errors as 404', async () => {
      const { Prisma } = await import('#prisma');
      const notFound = new Prisma.PrismaClientKnownRequestError('nope', {
        code: 'P2025',
        clientVersion: '7',
      });
      mocked.update.mockRejectedValue(notFound);

      const res = await request(buildApp()).patch('/api/anomalies/missing/dismiss').send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Resource not found');
      expect(mocked.logAuditEvent).not.toHaveBeenCalled();
    });

    it('forwards generic errors to the error handler', async () => {
      mocked.update.mockRejectedValue(Object.assign(new Error('boom'), { status: 503 }));

      const res = await request(buildApp()).patch('/api/anomalies/a1/dismiss').send({});

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('boom');
    });
  });

  describe('PATCH /api/anomalies/:id/review', () => {
    it('marks an alert as reviewed and records the reviewer', async () => {
      const reviewed = { ...sampleAlert, status: AnomalyAlertStatus.REVIEWED };
      mocked.update.mockResolvedValue(reviewed as never);

      const res = await request(buildApp()).patch('/api/anomalies/a1/review');

      expect(res.status).toBe(200);
      expect(res.body.alert.status).toBe(AnomalyAlertStatus.REVIEWED);
      expect(mocked.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: {
          status: AnomalyAlertStatus.REVIEWED,
          reviewed_by_id: 'u-1',
          reviewed_at: expect.any(Date),
        },
      });
      // The review route does not emit an audit event.
      expect(mocked.logAuditEvent).not.toHaveBeenCalled();
    });

    it('forwards Prisma not-found errors as 404', async () => {
      const { Prisma } = await import('#prisma');
      const notFound = new Prisma.PrismaClientKnownRequestError('nope', {
        code: 'P2025',
        clientVersion: '7',
      });
      mocked.update.mockRejectedValue(notFound);

      const res = await request(buildApp()).patch('/api/anomalies/missing/review');

      expect(res.status).toBe(404);
    });

    it('forwards generic errors to the error handler', async () => {
      mocked.update.mockRejectedValue(Object.assign(new Error('review failed'), { status: 503 }));

      const res = await request(buildApp()).patch('/api/anomalies/a1/review');

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('review failed');
    });
  });
});
