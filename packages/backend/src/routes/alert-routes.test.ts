import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

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

vi.mock('../services/alert-service.js', () => ({
  getAlerts: vi.fn(),
  acknowledgeAlert: vi.fn(),
}));

import { authenticate } from '../middleware/auth.js';
import { requireHR } from '../middleware/rbac.js';
import * as alertService from '../services/alert-service.js';
import { alertRoutes } from './alert-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  getAlerts: vi.mocked(alertService.getAlerts),
  acknowledgeAlert: vi.mocked(alertService.acknowledgeAlert),
  authenticate: vi.mocked(authenticate),
  requireHR: vi.mocked(requireHR),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/alerts', alertRoutes);
  app.use(errorHandler);
  return app;
}

describe('alert-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getAlerts.mockResolvedValue([]);
    mocked.acknowledgeAlert.mockResolvedValue(undefined);
  });

  describe('GET /api/alerts', () => {
    it('returns the list of alerts', async () => {
      mocked.getAlerts.mockResolvedValue([{ id: 'a1' }]);

      const res = await request(buildApp()).get('/api/alerts');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ alerts: [{ id: 'a1' }] });
      expect(mocked.getAlerts).toHaveBeenCalledWith({});
    });

    it('passes the acknowledged filter to the service', async () => {
      await request(buildApp()).get('/api/alerts?acknowledged=true');

      expect(mocked.getAlerts).toHaveBeenCalledWith({ acknowledged: true });
    });
  });

  describe('PATCH /api/alerts/:id/acknowledge', () => {
    it('acknowledges an alert and returns a message', async () => {
      const res = await request(buildApp()).patch('/api/alerts/a1/acknowledge');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Alert acknowledged' });
      expect(mocked.acknowledgeAlert).toHaveBeenCalledWith('a1');
    });

    it('forwards service errors', async () => {
      mocked.acknowledgeAlert.mockRejectedValue(
        Object.assign(new Error('not found'), { status: 404 }),
      );

      const res = await request(buildApp()).patch('/api/alerts/missing/acknowledge');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });
});
