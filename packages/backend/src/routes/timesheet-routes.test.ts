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

vi.mock('../services/timesheet-service.js', () => ({
  listTimesheets: vi.fn(),
  getCurrentTimesheet: vi.fn(),
  listPendingTimesheets: vi.fn(),
  getTimesheetById: vi.fn(),
  submitTimesheet: vi.fn(),
  approveTimesheet: vi.fn(),
  rejectTimesheet: vi.fn(),
}));

import * as timesheets from '../services/timesheet-service.js';
import { timesheetRoutes } from './timesheet-routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import { HttpError } from '../utils/http-error.js';

const mocked = {
  listTimesheets: vi.mocked(timesheets.listTimesheets),
  getCurrentTimesheet: vi.mocked(timesheets.getCurrentTimesheet),
  listPendingTimesheets: vi.mocked(timesheets.listPendingTimesheets),
  getTimesheetById: vi.mocked(timesheets.getTimesheetById),
  submitTimesheet: vi.mocked(timesheets.submitTimesheet),
  approveTimesheet: vi.mocked(timesheets.approveTimesheet),
  rejectTimesheet: vi.mocked(timesheets.rejectTimesheet),
};

const DETAIL = { id: 'ts-1', status: 'DRAFT', entries: [] };

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/timesheets', timesheetRoutes);
  app.use(errorHandler);
  return app;
}

function auth(req: request.Test): request.Test {
  return req.set('Authorization', 'Bearer test-token');
}

describe('timesheet-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.role = 'EMPLOYEE';
    authUser.employeeId = 'emp-1';
    mocked.listTimesheets.mockResolvedValue({
      timesheets: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never);
    mocked.getCurrentTimesheet.mockResolvedValue(DETAIL as never);
    mocked.listPendingTimesheets.mockResolvedValue([] as never);
    mocked.getTimesheetById.mockResolvedValue(DETAIL as never);
    mocked.submitTimesheet.mockResolvedValue({ ...DETAIL, status: 'SUBMITTED' } as never);
    mocked.approveTimesheet.mockResolvedValue({ ...DETAIL, status: 'APPROVED' } as never);
    mocked.rejectTimesheet.mockResolvedValue({ ...DETAIL, status: 'REJECTED' } as never);
  });

  describe('authentication', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(buildApp()).get('/api/timesheets');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'No token provided' });
      expect(mocked.listTimesheets).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/timesheets', () => {
    it('lists own timesheets with filters', async () => {
      mocked.listTimesheets.mockResolvedValue({
        timesheets: [{ id: 'ts-1', status: 'DRAFT' }],
        total: 1,
        page: 1,
        pageSize: 20,
      } as never);

      const res = await auth(
        request(buildApp()).get('/api/timesheets?status=DRAFT&periodStart=2026-09-14'),
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        timesheets: [{ id: 'ts-1', status: 'DRAFT' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      expect(mocked.listTimesheets).toHaveBeenCalledWith({
        employeeId: 'emp-1',
        status: 'DRAFT',
        periodStart: new Date('2026-09-14'),
        page: undefined,
        pageSize: undefined,
      });
    });

    it('passes pagination through', async () => {
      await auth(request(buildApp()).get('/api/timesheets?page=2&pageSize=10'));

      expect(mocked.listTimesheets).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 10 }),
      );
    });

    it('returns 400 on an invalid status', async () => {
      const res = await auth(request(buildApp()).get('/api/timesheets?status=NOPE'));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
      expect(mocked.listTimesheets).not.toHaveBeenCalled();
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.employeeId = null;

      const res = await auth(request(buildApp()).get('/api/timesheets'));

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No employee profile linked to your account' });
      expect(mocked.listTimesheets).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/timesheets/current', () => {
    it('gets or creates the current week draft timesheet', async () => {
      const res = await auth(
        request(buildApp()).get('/api/timesheets/current?date=2026-09-16'),
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ timesheet: DETAIL });
      expect(mocked.getCurrentTimesheet).toHaveBeenCalledWith({
        employeeId: 'emp-1',
        date: new Date('2026-09-16'),
        actorId: 'u-1',
        actorName: 'emma@example.com',
      });
    });

    it('omits the date when the query param is absent', async () => {
      await auth(request(buildApp()).get('/api/timesheets/current'));

      expect(mocked.getCurrentTimesheet).toHaveBeenCalledWith({
        employeeId: 'emp-1',
        date: undefined,
        actorId: 'u-1',
        actorName: 'emma@example.com',
      });
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.employeeId = null;

      const res = await auth(request(buildApp()).get('/api/timesheets/current'));

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No employee profile linked to your account' });
      expect(mocked.getCurrentTimesheet).not.toHaveBeenCalled();
    });

    it('forwards out-of-window date errors as 400', async () => {
      mocked.getCurrentTimesheet.mockRejectedValue(
        new HttpError(400, 'entryDate must fall within the current or previous week'),
      );

      const res = await auth(request(buildApp()).get('/api/timesheets/current?date=2020-01-01'));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('entryDate must fall within the current or previous week');
    });
  });

  describe('GET /api/timesheets/pending', () => {
    it('returns 403 for employees', async () => {
      const res = await auth(request(buildApp()).get('/api/timesheets/pending'));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Insufficient permissions' });
      expect(mocked.listPendingTimesheets).not.toHaveBeenCalled();
    });

    it('returns the manager approval queue for managers', async () => {
      authUser.role = 'MANAGER';
      mocked.listPendingTimesheets.mockResolvedValue([{ id: 'ts-9', status: 'SUBMITTED' }] as never);

      const res = await auth(request(buildApp()).get('/api/timesheets/pending'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ timesheets: [{ id: 'ts-9', status: 'SUBMITTED' }] });
      expect(mocked.listPendingTimesheets).toHaveBeenCalledWith({
        managerEmployeeId: 'emp-1',
        role: 'MANAGER',
        userId: 'u-1',
      });
    });

    it('lets HR see all submitted timesheets', async () => {
      authUser.role = 'HR_MANAGER';

      const res = await auth(request(buildApp()).get('/api/timesheets/pending'));

      expect(res.status).toBe(200);
      expect(mocked.listPendingTimesheets).toHaveBeenCalledWith({
        managerEmployeeId: 'emp-1',
        role: 'HR_MANAGER',
        userId: 'u-1',
      });
    });
  });

  describe('GET /api/timesheets/:id', () => {
    it('returns the timesheet detail with the requesting user context', async () => {
      const res = await auth(request(buildApp()).get('/api/timesheets/ts-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ timesheet: DETAIL });
      expect(mocked.getTimesheetById).toHaveBeenCalledWith({
        timesheetId: 'ts-1',
        requestingUser: {
          userId: 'u-1',
          role: 'EMPLOYEE',
          employeeId: 'emp-1',
          userName: 'emma@example.com',
        },
      });
    });

    it('forwards ownership errors as 403', async () => {
      mocked.getTimesheetById.mockRejectedValue(new HttpError(403, 'Insufficient permissions'));

      const res = await auth(request(buildApp()).get('/api/timesheets/ts-1'));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Insufficient permissions' });
    });

    it('forwards not-found errors as 404', async () => {
      mocked.getTimesheetById.mockRejectedValue(new HttpError(404, 'Timesheet not found'));

      const res = await auth(request(buildApp()).get('/api/timesheets/ts-404'));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Timesheet not found' });
    });
  });

  describe('POST /api/timesheets/:id/submit', () => {
    it('submits the timesheet for the linked employee', async () => {
      const res = await auth(request(buildApp()).post('/api/timesheets/ts-1/submit').send({}));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ timesheet: { ...DETAIL, status: 'SUBMITTED' } });
      expect(mocked.submitTimesheet).toHaveBeenCalledWith({
        timesheetId: 'ts-1',
        employeeId: 'emp-1',
        actorId: 'u-1',
        actorName: 'emma@example.com',
      });
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.employeeId = null;

      const res = await auth(request(buildApp()).post('/api/timesheets/ts-1/submit').send({}));

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No employee profile linked to your account' });
      expect(mocked.submitTimesheet).not.toHaveBeenCalled();
    });

    it('forwards empty-timesheet errors as 400', async () => {
      mocked.submitTimesheet.mockRejectedValue(
        new HttpError(400, 'Timesheet has no entries to submit'),
      );

      const res = await auth(request(buildApp()).post('/api/timesheets/ts-1/submit').send({}));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Timesheet has no entries to submit');
    });

    it('forwards already-submitted conflicts as 409', async () => {
      mocked.submitTimesheet.mockRejectedValue(
        new HttpError(409, 'Cannot submit a timesheet in status SUBMITTED'),
      );

      const res = await auth(request(buildApp()).post('/api/timesheets/ts-1/submit').send({}));

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Cannot submit a timesheet in status SUBMITTED');
    });
  });

  describe('POST /api/timesheets/:id/approve', () => {
    it('returns 403 for employees', async () => {
      const res = await auth(request(buildApp()).post('/api/timesheets/ts-1/approve').send({}));

      expect(res.status).toBe(403);
      expect(mocked.approveTimesheet).not.toHaveBeenCalled();
    });

    it('approves a submitted timesheet as the manager', async () => {
      authUser.role = 'MANAGER';

      const res = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/approve').send({ comment: 'Looks good' }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ timesheet: { ...DETAIL, status: 'APPROVED' } });
      expect(mocked.approveTimesheet).toHaveBeenCalledWith({
        timesheetId: 'ts-1',
        approverId: 'u-1',
        approverRole: 'MANAGER',
        comment: 'Looks good',
        actorId: 'u-1',
        actorName: 'emma@example.com',
      });
    });

    it('allows an omitted comment', async () => {
      authUser.role = 'HR_MANAGER';

      const res = await auth(request(buildApp()).post('/api/timesheets/ts-1/approve').send({}));

      expect(res.status).toBe(200);
      expect(mocked.approveTimesheet).toHaveBeenCalledWith(
        expect.objectContaining({ comment: undefined }),
      );
    });

    it('returns 400 when the comment exceeds 500 characters', async () => {
      authUser.role = 'MANAGER';

      const res = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/approve').send({ comment: 'x'.repeat(501) }),
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
      expect(mocked.approveTimesheet).not.toHaveBeenCalled();
    });

    it('blocks self-approval with 403', async () => {
      authUser.role = 'MANAGER';
      mocked.approveTimesheet.mockRejectedValue(
        new HttpError(403, 'You cannot approve or reject your own timesheet'),
      );

      const res = await auth(request(buildApp()).post('/api/timesheets/ts-1/approve').send({}));

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('You cannot approve or reject your own timesheet');
    });

    it('forwards status conflicts as 409', async () => {
      authUser.role = 'HR_MANAGER';
      mocked.approveTimesheet.mockRejectedValue(
        new HttpError(409, 'Cannot approve a timesheet in status DRAFT'),
      );

      const res = await auth(request(buildApp()).post('/api/timesheets/ts-1/approve').send({}));

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/timesheets/:id/reject', () => {
    it('returns 403 for employees', async () => {
      const res = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/reject').send({ comment: 'No' }),
      );

      expect(res.status).toBe(403);
      expect(mocked.rejectTimesheet).not.toHaveBeenCalled();
    });

    it('rejects a submitted timesheet with a comment', async () => {
      authUser.role = 'MANAGER';

      const res = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/reject').send({ comment: 'Missing detail' }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ timesheet: { ...DETAIL, status: 'REJECTED' } });
      expect(mocked.rejectTimesheet).toHaveBeenCalledWith({
        timesheetId: 'ts-1',
        approverId: 'u-1',
        approverRole: 'MANAGER',
        comment: 'Missing detail',
        actorId: 'u-1',
        actorName: 'emma@example.com',
      });
    });

    it('returns 400 when the comment is missing', async () => {
      authUser.role = 'MANAGER';

      const res = await auth(request(buildApp()).post('/api/timesheets/ts-1/reject').send({}));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation error');
      expect(mocked.rejectTimesheet).not.toHaveBeenCalled();
    });

    it('returns 400 when the comment is an empty string', async () => {
      authUser.role = 'MANAGER';

      const res = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/reject').send({ comment: '' }),
      );

      expect(res.status).toBe(400);
      expect(mocked.rejectTimesheet).not.toHaveBeenCalled();
    });

    it('returns 400 when the comment exceeds 500 characters', async () => {
      authUser.role = 'MANAGER';

      const res = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/reject').send({ comment: 'x'.repeat(501) }),
      );

      expect(res.status).toBe(400);
      expect(mocked.rejectTimesheet).not.toHaveBeenCalled();
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.role = 'MANAGER';
      authUser.employeeId = null;

      const res = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/reject').send({ comment: 'No' }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No employee profile linked to your account' });
      expect(mocked.rejectTimesheet).not.toHaveBeenCalled();
    });

    it('blocks self-rejection with 403', async () => {
      authUser.role = 'MANAGER';
      mocked.rejectTimesheet.mockRejectedValue(
        new HttpError(403, 'You cannot approve or reject your own timesheet'),
      );

      const res = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/reject').send({ comment: 'No' }),
      );

      expect(res.status).toBe(403);
    });
  });

  describe('submit → approve manager flow', () => {
    it('moves a timesheet through SUBMITTED to APPROVED', async () => {
      authUser.role = 'MANAGER';
      // The employee (emp-2) submits; their manager (authUser) approves.
      mocked.submitTimesheet.mockResolvedValue({ ...DETAIL, status: 'SUBMITTED' } as never);
      mocked.approveTimesheet.mockResolvedValue({
        ...DETAIL,
        status: 'APPROVED',
        approvals: [{ id: 'ap-1', action: 'APPROVE' }],
      } as never);

      const submitted = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/submit').send({}),
      );
      expect(submitted.status).toBe(200);
      expect(submitted.body.timesheet.status).toBe('SUBMITTED');

      const approved = await auth(
        request(buildApp()).post('/api/timesheets/ts-1/approve').send({ comment: 'Thanks' }),
      );
      expect(approved.status).toBe(200);
      expect(approved.body.timesheet.status).toBe('APPROVED');
      expect(approved.body.timesheet.approvals).toEqual([
        { id: 'ap-1', action: 'APPROVE' },
      ]);
    });
  });
});
