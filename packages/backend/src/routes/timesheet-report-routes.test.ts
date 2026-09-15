import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

const authUser: {
  userId: string;
  email: string;
  role: string;
  employeeId: string | null;
} = { userId: 'u-1', email: 'marcus@example.com', role: 'MANAGER', employeeId: 'mgr-1' };

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

vi.mock('../services/timesheet-report-service.js', () => ({
  getSummaryReport: vi.fn(),
  getDetailsReport: vi.fn(),
  exportReportCsv: vi.fn(),
}));

import * as reports from '../services/timesheet-report-service.js';
import { timesheetReportRoutes } from './timesheet-report-routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import { HttpError } from '../utils/http-error.js';

const mocked = {
  getSummaryReport: vi.mocked(reports.getSummaryReport),
  getDetailsReport: vi.mocked(reports.getDetailsReport),
  exportReportCsv: vi.mocked(reports.exportReportCsv),
};

const SUMMARY_QUERY =
  'groupBy=employee&from=2026-01-01&to=2026-09-30&includeAllStatuses=true';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/reports/timesheets', timesheetReportRoutes);
  app.use(errorHandler);
  return app;
}

function auth(req: request.Test): request.Test {
  return req.set('Authorization', 'Bearer test-token');
}

describe('timesheet-report-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.role = 'MANAGER';
    authUser.employeeId = 'mgr-1';
    mocked.getSummaryReport.mockResolvedValue({
      rows: [{ employeeId: 'emp-1', totalHours: 120 }],
      groupBy: 'employee',
      from: '2026-01-01',
      to: '2026-09-30',
      includeAllStatuses: true,
    } as never);
    mocked.getDetailsReport.mockResolvedValue({
      entries: [{ id: 'e-1', hours: 7.5 }],
      total: 1,
      page: 1,
      pageSize: 50,
    } as never);
    mocked.exportReportCsv.mockResolvedValue(
      'employee_no,employee_name,date,project_code,project_name,task_name,hours,description,timesheet_status\nEMP-0001,Emma Employee,2026-01-05,APX,Apollo X,Implementation,7.5,Work,APPROVED\n',
    );
  });

  describe('authentication & RBAC', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(buildApp()).get(`/api/reports/timesheets/summary?${SUMMARY_QUERY}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'No token provided' });
      expect(mocked.getSummaryReport).not.toHaveBeenCalled();
    });

    it('returns 403 for employees on summary', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(
        request(buildApp()).get(`/api/reports/timesheets/summary?${SUMMARY_QUERY}`),
      );

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Insufficient permissions' });
      expect(mocked.getSummaryReport).not.toHaveBeenCalled();
    });

    it('returns 403 for employees on details', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(
        request(buildApp()).get(`/api/reports/timesheets/details?${SUMMARY_QUERY}`),
      );

      expect(res.status).toBe(403);
      expect(mocked.getDetailsReport).not.toHaveBeenCalled();
    });

    it('returns 403 for employees on export', async () => {
      authUser.role = 'EMPLOYEE';

      const res = await auth(
        request(buildApp()).get(`/api/reports/timesheets/export?${SUMMARY_QUERY}`),
      );

      expect(res.status).toBe(403);
      expect(mocked.exportReportCsv).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/reports/timesheets/summary', () => {
    it('returns the aggregated summary for a manager', async () => {
      const res = await auth(
        request(buildApp()).get(
          `/api/reports/timesheets/summary?${SUMMARY_QUERY}&employeeId=11111111-1111-4111-8111-111111111111&projectId=22222222-2222-4222-8222-222222222222`,
        ),
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        rows: [{ employeeId: 'emp-1', totalHours: 120 }],
        groupBy: 'employee',
        from: '2026-01-01',
        to: '2026-09-30',
        includeAllStatuses: true,
      });
      expect(mocked.getSummaryReport).toHaveBeenCalledWith({
        requestingUser: {
          userId: 'u-1',
          role: 'MANAGER',
          employeeId: 'mgr-1',
          userName: 'marcus@example.com',
        },
        groupBy: 'employee',
        from: new Date('2026-01-01'),
        to: new Date('2026-09-30'),
        employeeId: '11111111-1111-4111-8111-111111111111',
        departmentId: undefined,
        projectId: '22222222-2222-4222-8222-222222222222',
        includeAllStatuses: true,
      });
    });

    it('lets HR access the summary', async () => {
      authUser.role = 'HR_MANAGER';

      const res = await auth(
        request(buildApp()).get(`/api/reports/timesheets/summary?${SUMMARY_QUERY}`),
      );

      expect(res.status).toBe(200);
    });

    it('defaults groupBy to employee when missing', async () => {
      const res = await auth(
        request(buildApp()).get('/api/reports/timesheets/summary?from=2026-01-01&to=2026-09-30'),
      );

      expect(res.status).toBe(200);
      expect(mocked.getSummaryReport).toHaveBeenCalledWith(
        expect.objectContaining({ groupBy: 'employee' }),
      );
    });

    it('returns 400 on an invalid groupBy', async () => {
      const res = await auth(
        request(buildApp()).get(
          '/api/reports/timesheets/summary?groupBy=team&from=2026-01-01&to=2026-09-30',
        ),
      );

      expect(res.status).toBe(400);
      expect(mocked.getSummaryReport).not.toHaveBeenCalled();
    });

    it('returns 400 when from or to is missing', async () => {
      const res = await auth(
        request(buildApp()).get('/api/reports/timesheets/summary?groupBy=employee&to=2026-09-30'),
      );

      expect(res.status).toBe(400);
      expect(mocked.getSummaryReport).not.toHaveBeenCalled();
    });

    it('defaults includeAllStatuses to undefined (approved only)', async () => {
      await auth(
        request(buildApp()).get(
          '/api/reports/timesheets/summary?groupBy=project&from=2026-01-01&to=2026-09-30',
        ),
      );

      expect(mocked.getSummaryReport).toHaveBeenCalledWith(
        expect.objectContaining({ includeAllStatuses: undefined, groupBy: 'project' }),
      );
    });

    it('forwards invalid range errors as 400', async () => {
      mocked.getSummaryReport.mockRejectedValue(new HttpError(400, 'from must be before to'));

      const res = await auth(
        request(buildApp()).get(
          '/api/reports/timesheets/summary?groupBy=employee&from=2026-09-30&to=2026-01-01',
        ),
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('from must be before to');
    });
  });

  describe('GET /api/reports/timesheets/details', () => {
    it('returns a paged entry listing with default pagination', async () => {
      const res = await auth(
        request(buildApp()).get(`/api/reports/timesheets/details?${SUMMARY_QUERY}`),
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        entries: [{ id: 'e-1', hours: 7.5 }],
        total: 1,
        page: 1,
        pageSize: 50,
      });
      expect(mocked.getDetailsReport).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 50 }),
      );
    });

    it('applies explicit pagination', async () => {
      await auth(
        request(buildApp()).get(`/api/reports/timesheets/details?${SUMMARY_QUERY}&page=2&pageSize=10`),
      );

      expect(mocked.getDetailsReport).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 10 }),
      );
    });

    it('returns 400 when pageSize exceeds 200', async () => {
      const res = await auth(
        request(buildApp()).get(`/api/reports/timesheets/details?${SUMMARY_QUERY}&pageSize=201`),
      );

      expect(res.status).toBe(400);
      expect(mocked.getDetailsReport).not.toHaveBeenCalled();
    });

    it('returns 400 when page is not a positive integer', async () => {
      const res = await auth(
        request(buildApp()).get(`/api/reports/timesheets/details?${SUMMARY_QUERY}&page=0`),
      );

      expect(res.status).toBe(400);
      expect(mocked.getDetailsReport).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/reports/timesheets/export', () => {
    it('returns a CSV attachment with the right headers and filename', async () => {
      const res = await auth(
        request(buildApp()).get(
          `/api/reports/timesheets/export?groupBy=employee&from=2026-01-01&to=2026-09-30`,
        ),
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="timesheet-report-2026-01-01-to-2026-09-30.csv"',
      );
      expect(res.text).toContain('employee_no,employee_name,date,project_code');
      expect(mocked.exportReportCsv).toHaveBeenCalledWith(
        expect.objectContaining({
          from: new Date('2026-01-01'),
          to: new Date('2026-09-30'),
          includeAllStatuses: undefined,
        }),
      );
    });

    it('forwards filter errors as 400', async () => {
      mocked.exportReportCsv.mockRejectedValue(new HttpError(400, 'from must be before to'));

      const res = await auth(
        request(buildApp()).get(
          `/api/reports/timesheets/export?groupBy=employee&from=2026-09-30&to=2026-01-01`,
        ),
      );

      expect(res.status).toBe(400);
    });

    it('returns 400 when the required filters are missing', async () => {
      const res = await auth(request(buildApp()).get('/api/reports/timesheets/export'));

      expect(res.status).toBe(400);
      expect(mocked.exportReportCsv).not.toHaveBeenCalled();
    });
  });
});
