import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const authUser: {
  userId: string;
  email: string;
  role: string;
  employeeId: string | null;
} = { userId: 'u-1', email: 'jane@example.com', role: 'HR_MANAGER', employeeId: 'emp-1' };

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = authUser;
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireHR: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../services/offboarding-service.js', () => ({
  submitResignation: vi.fn(),
  initiateTermination: vi.fn(),
  listOffboardingRecords: vi.fn(),
  getOffboardingRecord: vi.fn(),
  listClearanceItems: vi.fn(),
  updateClearanceItem: vi.fn(),
  closeOffboarding: vi.fn(),
  conductExitInterview: vi.fn(),
}));

import * as offboarding from '../services/offboarding-service.js';
import { offboardingRoutes } from './offboarding-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  submitResignation: vi.mocked(offboarding.submitResignation),
  initiateTermination: vi.mocked(offboarding.initiateTermination),
  listOffboardingRecords: vi.mocked(offboarding.listOffboardingRecords),
  getOffboardingRecord: vi.mocked(offboarding.getOffboardingRecord),
  listClearanceItems: vi.mocked(offboarding.listClearanceItems),
  updateClearanceItem: vi.mocked(offboarding.updateClearanceItem),
  closeOffboarding: vi.mocked(offboarding.closeOffboarding),
  conductExitInterview: vi.mocked(offboarding.conductExitInterview),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/offboarding', offboardingRoutes);
  app.use(errorHandler);
  return app;
}

describe('offboarding-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.role = 'HR_MANAGER';
    authUser.employeeId = 'emp-1';
    mocked.submitResignation.mockResolvedValue({ id: 'off-1' } as never);
    mocked.initiateTermination.mockResolvedValue({ id: 'off-1' } as never);
    mocked.listOffboardingRecords.mockResolvedValue([] as never);
    mocked.getOffboardingRecord.mockResolvedValue({ id: 'off-1' } as never);
    mocked.listClearanceItems.mockResolvedValue([] as never);
    mocked.updateClearanceItem.mockResolvedValue({ id: 'item-1' } as never);
    mocked.closeOffboarding.mockResolvedValue({ id: 'off-1' } as never);
    mocked.conductExitInterview.mockResolvedValue({ id: 'ei-1' } as never);
  });

  describe('POST /api/offboarding/resignations', () => {
    it('submits a resignation for the linked employee', async () => {
      const res = await request(buildApp())
        .post('/api/offboarding/resignations')
        .send({ reason: 'New opportunity', lastWorkingDay: '2026-09-30' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'off-1' });
      const arg = mocked.submitResignation.mock.calls[0]?.[0] as {
        employeeId: string;
        reason?: string;
        actorId: string;
        actorName: string;
      };
      expect(arg.employeeId).toBe('emp-1');
      expect(arg.reason).toBe('New opportunity');
      expect(arg.actorId).toBe('u-1');
      expect(arg.actorName).toBe('jane@example.com');
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.employeeId = null;

      const res = await request(buildApp())
        .post('/api/offboarding/resignations')
        .send({ lastWorkingDay: '2026-09-30' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No employee profile linked to your account' });
      expect(mocked.submitResignation).not.toHaveBeenCalled();
    });

    it('returns 400 when lastWorkingDay is missing', async () => {
      const res = await request(buildApp())
        .post('/api/offboarding/resignations')
        .send({ reason: 'Leaving' });

      expect(res.status).toBe(400);
      expect(mocked.submitResignation).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.submitResignation.mockRejectedValue(
        Object.assign(new Error('An active offboarding record already exists'), { status: 409 }),
      );

      const res = await request(buildApp())
        .post('/api/offboarding/resignations')
        .send({ lastWorkingDay: '2026-09-30' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('An active offboarding record already exists');
    });
  });

  describe('POST /api/offboarding/terminations', () => {
    it('initiates a termination as HR', async () => {
      const res = await request(buildApp()).post('/api/offboarding/terminations').send({
        employeeId: 'emp-2',
        separationType: 'DISMISSAL',
        reason: 'Policy breach',
        effectiveDate: '2026-09-30',
      });

      expect(res.status).toBe(201);
      const arg = mocked.initiateTermination.mock.calls[0]?.[0] as {
        employeeId: string;
        separationType: string;
        initiatedBy: string;
      };
      expect(arg.employeeId).toBe('emp-2');
      expect(arg.separationType).toBe('DISMISSAL');
      expect(arg.initiatedBy).toBe('u-1');
    });

    it('returns 403 when a manager initiates a dismissal', async () => {
      authUser.role = 'MANAGER';

      const res = await request(buildApp()).post('/api/offboarding/terminations').send({
        employeeId: 'emp-2',
        separationType: 'DISMISSAL',
        effectiveDate: '2026-09-30',
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Dismissal can only be initiated by HR' });
      expect(mocked.initiateTermination).not.toHaveBeenCalled();
    });

    it('returns 403 when an employee initiates a termination', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await request(buildApp()).post('/api/offboarding/terminations').send({
        employeeId: 'emp-2',
        separationType: 'END_OF_CONTRACT',
        effectiveDate: '2026-09-30',
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Access denied' });
      expect(mocked.initiateTermination).not.toHaveBeenCalled();
    });

    it('returns 400 on an invalid separation type', async () => {
      const res = await request(buildApp()).post('/api/offboarding/terminations').send({
        employeeId: 'emp-2',
        separationType: 'NOT_A_TYPE',
        effectiveDate: '2026-09-30',
      });

      expect(res.status).toBe(400);
      expect(mocked.initiateTermination).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.initiateTermination.mockRejectedValue(
        Object.assign(new Error('Employee not found'), { status: 404 }),
      );

      const res = await request(buildApp()).post('/api/offboarding/terminations').send({
        employeeId: 'emp-2',
        separationType: 'DISMISSAL',
        effectiveDate: '2026-09-30',
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Employee not found');
    });
  });

  describe('GET /api/offboarding', () => {
    it('lists offboarding records scoped by role', async () => {
      mocked.listOffboardingRecords.mockResolvedValue([{ id: 'off-1' }] as never);

      const res = await request(buildApp()).get('/api/offboarding?status=IN_PROGRESS');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ records: [{ id: 'off-1' }] });
      expect(mocked.listOffboardingRecords).toHaveBeenCalledWith({
        role: 'HR_MANAGER',
        userId: 'u-1',
        status: 'IN_PROGRESS',
      });
    });

    it('passes undefined status when the query param is absent', async () => {
      await request(buildApp()).get('/api/offboarding');

      expect(mocked.listOffboardingRecords).toHaveBeenCalledWith({
        role: 'HR_MANAGER',
        userId: 'u-1',
        status: undefined,
      });
    });
  });

  describe('GET /api/offboarding/:id', () => {
    it('returns a single offboarding record', async () => {
      const res = await request(buildApp()).get('/api/offboarding/off-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 'off-1' });
      expect(mocked.getOffboardingRecord).toHaveBeenCalledWith('off-1');
    });

    it('forwards service errors', async () => {
      mocked.getOffboardingRecord.mockRejectedValue(
        Object.assign(new Error('Offboarding record not found'), { status: 404 }),
      );

      const res = await request(buildApp()).get('/api/offboarding/off-1');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Offboarding record not found');
    });
  });

  describe('GET /api/offboarding/:id/clearance', () => {
    it('lists clearance items', async () => {
      mocked.listClearanceItems.mockResolvedValue([{ id: 'item-1' }] as never);

      const res = await request(buildApp()).get('/api/offboarding/off-1/clearance');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [{ id: 'item-1' }] });
      expect(mocked.listClearanceItems).toHaveBeenCalledWith('off-1');
    });
  });

  describe('PATCH /api/offboarding/clearance-items/:id', () => {
    it('updates a clearance item', async () => {
      const res = await request(buildApp())
        .patch('/api/offboarding/clearance-items/item-1')
        .send({ status: 'COMPLETE' });

      expect(res.status).toBe(200);
      expect(mocked.updateClearanceItem).toHaveBeenCalledWith({
        id: 'item-1',
        status: 'COMPLETE',
        actorId: 'u-1',
        actorRole: 'HR_MANAGER',
      });
    });

    it('returns 400 on an invalid status', async () => {
      const res = await request(buildApp())
        .patch('/api/offboarding/clearance-items/item-1')
        .send({ status: 'NOT_A_STATUS' });

      expect(res.status).toBe(400);
      expect(mocked.updateClearanceItem).not.toHaveBeenCalled();
    });

    it('forwards permission errors', async () => {
      mocked.updateClearanceItem.mockRejectedValue(
        Object.assign(new Error('Only HR can waive a clearance item'), { status: 403 }),
      );

      const res = await request(buildApp())
        .patch('/api/offboarding/clearance-items/item-1')
        .send({ waivedReason: 'N/A' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Only HR can waive a clearance item');
    });
  });

  describe('POST /api/offboarding/:id/close', () => {
    it('closes an offboarding record', async () => {
      const res = await request(buildApp()).post('/api/offboarding/off-1/close');

      expect(res.status).toBe(200);
      expect(mocked.closeOffboarding).toHaveBeenCalledWith('off-1', 'u-1', 'HR_MANAGER');
    });

    it('forwards service errors', async () => {
      mocked.closeOffboarding.mockRejectedValue(
        Object.assign(new Error('All clearance items must be completed or waived'), {
          status: 400,
        }),
      );

      const res = await request(buildApp()).post('/api/offboarding/off-1/close');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('All clearance items must be completed or waived');
    });
  });

  describe('POST /api/offboarding/:id/exit-interview', () => {
    it('records an exit interview', async () => {
      const res = await request(buildApp())
        .post('/api/offboarding/off-1/exit-interview')
        .send({ responses: { q1: 'ok' }, declined: false });

      expect(res.status).toBe(201);
      expect(mocked.conductExitInterview).toHaveBeenCalledWith({
        offboardingId: 'off-1',
        responses: { q1: 'ok' },
        declined: false,
        conductedBy: 'u-1',
      });
    });

    it('returns 400 when declined is not a boolean', async () => {
      const res = await request(buildApp())
        .post('/api/offboarding/off-1/exit-interview')
        .send({ responses: {}, declined: 'yes' });

      expect(res.status).toBe(400);
      expect(mocked.conductExitInterview).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.conductExitInterview.mockRejectedValue(
        Object.assign(new Error('Exit interview already recorded'), { status: 409 }),
      );

      const res = await request(buildApp())
        .post('/api/offboarding/off-1/exit-interview')
        .send({ responses: {} });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Exit interview already recorded');
    });
  });
});
