import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

const authUser: {
  userId: string;
  email: string;
  role: string;
  employeeId: string | null;
} = { userId: 'u-1', email: 'emma@example.com', role: 'EMPLOYEE', employeeId: 'emp-1' };

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

vi.mock('../services/timesheet-service.js', () => ({
  createTimesheetEntry: vi.fn(),
  updateTimesheetEntry: vi.fn(),
  deleteTimesheetEntry: vi.fn(),
}));

import * as timesheets from '../services/timesheet-service.js';
import { timesheetEntryRoutes } from './timesheet-entry-routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import { HttpError } from '../utils/http-error.js';

const mocked = {
  createTimesheetEntry: vi.mocked(timesheets.createTimesheetEntry),
  updateTimesheetEntry: vi.mocked(timesheets.updateTimesheetEntry),
  deleteTimesheetEntry: vi.mocked(timesheets.deleteTimesheetEntry),
};

const DETAIL = { id: 'ts-1', status: 'DRAFT', entries: [{ id: 'e-1' }] };

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/timesheet-entries', timesheetEntryRoutes);
  app.use(errorHandler);
  return app;
}

function auth(req: request.Test): request.Test {
  return req.set('Authorization', 'Bearer test-token');
}

describe('timesheet-entry-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.role = 'EMPLOYEE';
    authUser.employeeId = 'emp-1';
    mocked.createTimesheetEntry.mockResolvedValue(DETAIL as never);
    mocked.updateTimesheetEntry.mockResolvedValue(DETAIL as never);
    mocked.deleteTimesheetEntry.mockResolvedValue(DETAIL as never);
  });

  describe('authentication', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(buildApp()).post('/api/timesheet-entries').send({});

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'No token provided' });
      expect(mocked.createTimesheetEntry).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/timesheet-entries', () => {
    it('creates an entry and returns the owning timesheet detail', async () => {
      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2026-09-15',
        projectId: '11111111-1111-4111-8111-111111111111',
        hours: 7.5,
        description: 'API contract review',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ timesheet: DETAIL });
      expect(mocked.createTimesheetEntry).toHaveBeenCalledWith({
        employeeId: 'emp-1',
        entryDate: new Date('2026-09-15'),
        projectId: '11111111-1111-4111-8111-111111111111',
        taskId: undefined,
        hours: 7.5,
        description: 'API contract review',
        actorId: 'u-1',
        actorName: 'emma@example.com',
      });
    });

    it('accepts a task id and a contract-compat timesheetId (ignored)', async () => {
      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        timesheetId: '22222222-2222-4222-8222-222222222222',
        entryDate: '2026-09-15',
        projectId: '11111111-1111-4111-8111-111111111111',
        taskId: '33333333-3333-4333-8333-333333333333',
        hours: 2,
      });

      expect(res.status).toBe(201);
      expect(mocked.createTimesheetEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: '33333333-3333-4333-8333-333333333333',
        }),
      );
    });

    it('returns 400 when the projectId is missing', async () => {
      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2026-09-15',
        hours: 7.5,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
      expect(mocked.createTimesheetEntry).not.toHaveBeenCalled();
    });

    it('returns 400 when the projectId is not a uuid', async () => {
      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2026-09-15',
        projectId: 'not-a-uuid',
        hours: 7.5,
      });

      expect(res.status).toBe(400);
      expect(mocked.createTimesheetEntry).not.toHaveBeenCalled();
    });

    it('returns 400 when hours is not a number', async () => {
      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2026-09-15',
        projectId: '11111111-1111-4111-8111-111111111111',
        hours: 'abc',
      });

      expect(res.status).toBe(400);
      expect(mocked.createTimesheetEntry).not.toHaveBeenCalled();
    });

    it('returns 400 when description exceeds 500 characters', async () => {
      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2026-09-15',
        projectId: '11111111-1111-4111-8111-111111111111',
        hours: 7.5,
        description: 'x'.repeat(501),
      });

      expect(res.status).toBe(400);
      expect(mocked.createTimesheetEntry).not.toHaveBeenCalled();
    });

    it('returns 400 for a bad hours increment (service-enforced)', async () => {
      mocked.createTimesheetEntry.mockRejectedValue(
        new HttpError(400, 'hours must be a multiple of 0.25'),
      );

      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2026-09-15',
        projectId: '11111111-1111-4111-8111-111111111111',
        hours: 7.55,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('hours must be a multiple of 0.25');
    });

    it('returns 400 for a future-week entry date (service-enforced)', async () => {
      mocked.createTimesheetEntry.mockRejectedValue(
        new HttpError(400, 'entryDate must fall within the current or previous week'),
      );

      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2099-01-01',
        projectId: '11111111-1111-4111-8111-111111111111',
        hours: 8,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('entryDate must fall within the current or previous week');
    });

    it('returns 409 TIMESHEET_LOCKED for a submitted timesheet (service-enforced)', async () => {
      mocked.createTimesheetEntry.mockRejectedValue(
        new HttpError(409, 'Timesheet is locked for editing', 'TIMESHEET_LOCKED'),
      );

      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2026-09-15',
        projectId: '11111111-1111-4111-8111-111111111111',
        hours: 8,
      });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: 'Timesheet is locked for editing',
        code: 'TIMESHEET_LOCKED',
      });
    });

    it('returns 409 DAY_TOTAL_EXCEEDED when the day cap is exceeded (service-enforced)', async () => {
      mocked.createTimesheetEntry.mockRejectedValue(
        new HttpError(
          409,
          'Total logged hours for this date would exceed 24',
          'DAY_TOTAL_EXCEEDED',
        ),
      );

      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2026-09-15',
        projectId: '11111111-1111-4111-8111-111111111111',
        hours: 24,
      });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DAY_TOTAL_EXCEEDED');
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.employeeId = null;

      const res = await auth(request(buildApp()).post('/api/timesheet-entries')).send({
        entryDate: '2026-09-15',
        projectId: '11111111-1111-4111-8111-111111111111',
        hours: 8,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No employee profile linked to your account' });
      expect(mocked.createTimesheetEntry).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/timesheet-entries/:id', () => {
    it('updates an entry with a partial payload', async () => {
      const res = await auth(request(buildApp()).patch('/api/timesheet-entries/e-1')).send({
        hours: 8,
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ timesheet: DETAIL });
      expect(mocked.updateTimesheetEntry).toHaveBeenCalledWith({
        entryId: 'e-1',
        employeeId: 'emp-1',
        entryDate: undefined,
        projectId: undefined,
        taskId: undefined,
        hours: 8,
        description: undefined,
        actorId: 'u-1',
        actorName: 'emma@example.com',
      });
    });

    it('allows clearing the task and description with null', async () => {
      const res = await auth(request(buildApp()).patch('/api/timesheet-entries/e-1')).send({
        taskId: null,
        description: null,
      });

      expect(res.status).toBe(200);
      expect(mocked.updateTimesheetEntry).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: null, description: null }),
      );
    });

    it('returns 400 when description exceeds 500 characters', async () => {
      const res = await auth(request(buildApp()).patch('/api/timesheet-entries/e-1')).send({
        description: 'x'.repeat(501),
      });

      expect(res.status).toBe(400);
      expect(mocked.updateTimesheetEntry).not.toHaveBeenCalled();
    });

    it('forwards non-owner errors as 404', async () => {
      mocked.updateTimesheetEntry.mockRejectedValue(
        new HttpError(404, 'Timesheet entry not found'),
      );

      const res = await auth(request(buildApp()).patch('/api/timesheet-entries/e-1')).send({
        hours: 8,
      });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Timesheet entry not found' });
    });

    it('forwards locked-timesheet conflicts as 409', async () => {
      mocked.updateTimesheetEntry.mockRejectedValue(
        new HttpError(409, 'Timesheet is locked for editing', 'TIMESHEET_LOCKED'),
      );

      const res = await auth(request(buildApp()).patch('/api/timesheet-entries/e-1')).send({
        hours: 8,
      });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TIMESHEET_LOCKED');
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.employeeId = null;

      const res = await auth(request(buildApp()).patch('/api/timesheet-entries/e-1')).send({
        hours: 8,
      });

      expect(res.status).toBe(400);
      expect(mocked.updateTimesheetEntry).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/timesheet-entries/:id', () => {
    it('soft-deletes an entry and returns the owning timesheet detail', async () => {
      const res = await auth(request(buildApp()).delete('/api/timesheet-entries/e-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ timesheet: DETAIL });
      expect(mocked.deleteTimesheetEntry).toHaveBeenCalledWith({
        entryId: 'e-1',
        employeeId: 'emp-1',
        actorId: 'u-1',
        actorName: 'emma@example.com',
      });
    });

    it('forwards non-owner errors as 404', async () => {
      mocked.deleteTimesheetEntry.mockRejectedValue(
        new HttpError(404, 'Timesheet entry not found'),
      );

      const res = await auth(request(buildApp()).delete('/api/timesheet-entries/e-1'));

      expect(res.status).toBe(404);
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.employeeId = null;

      const res = await auth(request(buildApp()).delete('/api/timesheet-entries/e-1'));

      expect(res.status).toBe(400);
      expect(mocked.deleteTimesheetEntry).not.toHaveBeenCalled();
    });
  });
});
