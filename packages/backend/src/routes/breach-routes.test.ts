import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the auth middleware so handlers run under an authenticated ADMIN context.
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

// The route mounts `requireRoles(UserRole.ADMIN)`; allow the request through.
vi.mock('../middleware/rbac.js', () => ({
  requireRoles: vi.fn(
    (..._roles: string[]) =>
      (_req: unknown, _res: unknown, next: () => void) =>
        next(),
  ),
}));

vi.mock('../services/breach-service.js', () => ({
  createBreach: vi.fn(),
  listBreaches: vi.fn(),
  getBreach: vi.fn(),
  updateBreach: vi.fn(),
  recordBreachNotification: vi.fn(),
  generateNotificationTemplate: vi.fn(),
}));

import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import * as breachService from '../services/breach-service.js';
import { breachRoutes } from './breach-routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import { HttpError } from '../utils/http-error.js';

const mocked = {
  authenticate: vi.mocked(authenticate),
  getAuthUser: vi.mocked(getAuthUser),
  requireRoles: vi.mocked(requireRoles),
  createBreach: vi.mocked(breachService.createBreach),
  listBreaches: vi.mocked(breachService.listBreaches),
  getBreach: vi.mocked(breachService.getBreach),
  updateBreach: vi.mocked(breachService.updateBreach),
  recordBreachNotification: vi.mocked(breachService.recordBreachNotification),
  generateNotificationTemplate: vi.mocked(breachService.generateNotificationTemplate),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/breach', breachRoutes);
  app.use(errorHandler);
  return app;
}

const sampleBreach = {
  id: 'br-1',
  title: 'Test Breach',
  description: 'Sensitive data exposed',
  detection_at: '2026-08-01T00:00:00.000Z',
  severity: 'HIGH',
  is_high_risk: true,
  data_categories_affected: ['CONTACT', 'FINANCIAL'],
  affected_subjects_count: 120,
  containment_status: 'OPEN',
  root_cause: null,
  resolution: null,
  notifications: [],
};

describe('breach-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listBreaches.mockResolvedValue([]);
    mocked.getBreach.mockResolvedValue(sampleBreach as never);
    mocked.createBreach.mockResolvedValue(sampleBreach as never);
    mocked.updateBreach.mockResolvedValue(sampleBreach as never);
    mocked.recordBreachNotification.mockResolvedValue({ id: 'n-1' } as never);
    mocked.generateNotificationTemplate.mockResolvedValue({
      nature: 'Test Breach',
    } as never);
  });

  describe('GET /api/breach', () => {
    it('returns all breaches', async () => {
      mocked.listBreaches.mockResolvedValue([sampleBreach] as never);

      const res = await request(buildApp()).get('/api/breach');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ breaches: [sampleBreach] });
      expect(mocked.listBreaches).toHaveBeenCalledWith(undefined);
    });

    it('passes the containment status filter to the service', async () => {
      await request(buildApp()).get('/api/breach?status=CLOSED');

      expect(mocked.listBreaches).toHaveBeenCalledWith('CLOSED');
    });

    it('forwards service errors to the error handler', async () => {
      mocked.listBreaches.mockRejectedValue(new HttpError(500, 'db down'));

      const res = await request(buildApp()).get('/api/breach');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('db down');
    });
  });

  describe('GET /api/breach/:id', () => {
    it('returns a single breach', async () => {
      const res = await request(buildApp()).get('/api/breach/br-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ breach: sampleBreach });
      expect(mocked.getBreach).toHaveBeenCalledWith('br-1');
    });

    it('forwards a 404 when the breach is not found', async () => {
      mocked.getBreach.mockRejectedValue(new HttpError(404, 'Breach not found'));

      const res = await request(buildApp()).get('/api/breach/missing');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Breach not found');
    });
  });

  describe('POST /api/breach', () => {
    const payload = {
      title: 'New Breach',
      description: 'Leak detected',
      detectionAt: '2026-08-01T00:00:00Z',
      severity: 'MEDIUM',
      isHighRisk: false,
      dataCategoriesAffected: ['CONTACT'],
      affectedSubjectsCount: 5,
    };

    it('creates a breach and returns 201', async () => {
      const created = { ...sampleBreach, title: 'New Breach' };
      mocked.createBreach.mockResolvedValue(created as never);

      const res = await request(buildApp()).post('/api/breach').send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ breach: created });
      expect(mocked.createBreach).toHaveBeenCalledWith({
        title: 'New Breach',
        description: 'Leak detected',
        detectionAt: new Date('2026-08-01T00:00:00Z'),
        severity: 'MEDIUM',
        isHighRisk: false,
        dataCategoriesAffected: ['CONTACT'],
        affectedSubjectsCount: 5,
        actorId: 'u-1',
        actorName: 'admin@example.com',
      });
    });

    it('forwards service errors from create', async () => {
      mocked.createBreach.mockRejectedValue(new HttpError(400, 'invalid severity'));

      const res = await request(buildApp()).post('/api/breach').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid severity');
    });
  });

  describe('PATCH /api/breach/:id', () => {
    it('updates a breach and returns the result', async () => {
      const updated = { ...sampleBreach, containment_status: 'CONTAINED' };
      mocked.updateBreach.mockResolvedValue(updated as never);

      const res = await request(buildApp())
        .patch('/api/breach/br-1')
        .send({ containmentStatus: 'CONTAINED' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ breach: updated });
      expect(mocked.updateBreach).toHaveBeenCalledWith(
        'br-1',
        { containmentStatus: 'CONTAINED' },
        'u-1',
        'admin@example.com',
      );
    });

    it('forwards service errors from update', async () => {
      mocked.updateBreach.mockRejectedValue(new HttpError(400, 'notification plan required'));

      const res = await request(buildApp())
        .patch('/api/breach/br-1')
        .send({ containmentStatus: 'CLOSED' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('notification plan required');
    });
  });

  describe('POST /api/breach/:id/notification', () => {
    const payload = {
      notificationType: 'SUPERVISORY_AUTHORITY',
      method: 'EMAIL',
      reference: 'ref-123',
    };

    it('records a notification and returns 201', async () => {
      const notification = { id: 'n-1', notification_type: 'SUPERVISORY_AUTHORITY' };
      mocked.recordBreachNotification.mockResolvedValue(notification as never);

      const res = await request(buildApp()).post('/api/breach/br-1/notification').send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ notification });
      expect(mocked.recordBreachNotification).toHaveBeenCalledWith(
        'br-1',
        { notificationType: 'SUPERVISORY_AUTHORITY', method: 'EMAIL', reference: 'ref-123' },
        'u-1',
        'admin@example.com',
      );
    });

    it('omits reference when not provided', async () => {
      await request(buildApp())
        .post('/api/breach/br-1/notification')
        .send({ notificationType: 'DATA_SUBJECT', method: 'PORTAL' });

      expect(mocked.recordBreachNotification).toHaveBeenCalledWith(
        'br-1',
        { notificationType: 'DATA_SUBJECT', method: 'PORTAL', reference: undefined },
        'u-1',
        'admin@example.com',
      );
    });

    it('forwards service errors from recording a notification', async () => {
      mocked.recordBreachNotification.mockRejectedValue(new HttpError(404, 'Breach not found'));

      const res = await request(buildApp()).post('/api/breach/br-1/notification').send(payload);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Breach not found');
    });
  });

  describe('GET /api/breach/:id/template', () => {
    it('generates a notification template for the breach', async () => {
      const template = { nature: 'Test Breach', severity: 'HIGH' };
      mocked.generateNotificationTemplate.mockReturnValue(template as never);

      const res = await request(buildApp()).get('/api/breach/br-1/template');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ template });
      expect(mocked.getBreach).toHaveBeenCalledWith('br-1');
      expect(mocked.generateNotificationTemplate).toHaveBeenCalledWith(sampleBreach);
    });

    it('forwards errors when the breach is missing', async () => {
      mocked.getBreach.mockRejectedValue(new HttpError(404, 'Breach not found'));

      const res = await request(buildApp()).get('/api/breach/missing/template');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Breach not found');
      expect(mocked.generateNotificationTemplate).not.toHaveBeenCalled();
    });
  });
});
