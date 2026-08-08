import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Prisma is not used directly by the router module, but a lightweight mock
// keeps module initialization free of DB connections.
vi.mock('../config/prisma.js', () => ({
  prisma: {},
}));

const authState = vi.hoisted(() => ({
  user: { userId: 'u-1', email: 'admin@example.com', role: 'ADMIN', employeeId: 'emp-1' } as {
    userId: string;
    email: string;
    role: string;
    employeeId?: string | null;
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = authState.user;
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user ?? authState.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireRoles: vi.fn((...roles: string[]) => {
    const middleware = (
      req: { user?: { role?: string } },
      res: { status: (n: number) => { json: (b: unknown) => void } },
      next: () => void,
    ) => {
      if (!roles.includes(req.user?.role ?? '')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      next();
    };
    return middleware;
  }),
}));

vi.mock('../services/data-subject-rights-service.js', () => ({
  getSubjectData: vi.fn(),
  eraseSubjectData: vi.fn(),
  exportSubjectData: vi.fn(),
  resolveSubjectUserId: vi.fn(),
}));

import * as dsrService from '../services/data-subject-rights-service.js';
import { dataSubjectRightsRoutes } from './data-subject-rights-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  getSubjectData: vi.mocked(dsrService.getSubjectData),
  eraseSubjectData: vi.mocked(dsrService.eraseSubjectData),
  exportSubjectData: vi.mocked(dsrService.exportSubjectData),
  resolveSubjectUserId: vi.mocked(dsrService.resolveSubjectUserId),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/data-subject-rights', dataSubjectRightsRoutes);
  app.use(errorHandler);
  return app;
}

function setAuth(overrides: Partial<typeof authState.user> = {}) {
  authState.user = {
    userId: 'u-1',
    email: 'admin@example.com',
    role: 'ADMIN',
    employeeId: 'emp-1',
    ...overrides,
  };
}

const sampleSubjectData = {
  dataCategories: ['user-account'],
  processingPurposes: ['HR administration'],
  user: {
    id: 'u-1',
    email: 'u-1@example.com',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    createdAt: new Date(),
  },
  employee: null,
  documents: [],
  attendance: [],
  leaveRequests: [],
  performanceReviews: [],
  candidate: null,
  offboarding: null,
  consents: [],
};

describe('data-subject-rights-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuth();
    mocked.resolveSubjectUserId.mockImplementation(async (targetUserId: string) => targetUserId);
  });

  describe('authentication', () => {
    it('requires a valid authenticated user (authenticate middleware applied globally)', async () => {
      // With the mocked authenticate setting a user, a request succeeds.
      mocked.getSubjectData.mockResolvedValue(sampleSubjectData as never);
      const res = await request(buildApp()).get('/api/data-subject-rights/access/u-1');
      expect(res.status).not.toBe(401);
    });
  });

  describe('GET /access/:userId (Art. 15 access)', () => {
    it('returns the aggregated subject data for self (EMPLOYEE)', async () => {
      setAuth({ userId: 'u-2', role: 'EMPLOYEE' });
      mocked.resolveSubjectUserId.mockResolvedValue('u-2');
      mocked.getSubjectData.mockResolvedValue(sampleSubjectData as never);

      const res = await request(buildApp()).get('/api/data-subject-rights/access/u-2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: JSON.parse(JSON.stringify(sampleSubjectData)) });
      expect(mocked.resolveSubjectUserId).toHaveBeenCalledWith('u-2', 'u-2', 'EMPLOYEE');
      expect(mocked.getSubjectData).toHaveBeenCalledWith('u-2');
    });

    it('allows ADMIN to access another user', async () => {
      setAuth({ userId: 'u-1', role: 'ADMIN' });
      mocked.resolveSubjectUserId.mockResolvedValue('u-99');
      mocked.getSubjectData.mockResolvedValue(sampleSubjectData as never);

      const res = await request(buildApp()).get('/api/data-subject-rights/access/u-99');

      expect(res.status).toBe(200);
      expect(mocked.resolveSubjectUserId).toHaveBeenCalledWith('u-99', 'u-1', 'ADMIN');
    });

    it('forwards 403 when resolveSubjectUserId rejects (cross-user access by non-privileged role)', async () => {
      setAuth({ userId: 'u-2', role: 'EMPLOYEE' });
      mocked.resolveSubjectUserId.mockRejectedValue(
        new (await import('../utils/http-error.js')).HttpError(
          403,
          'You can only access your own data',
        ),
      );

      const res = await request(buildApp()).get('/api/data-subject-rights/access/u-99');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('only access your own data');
      expect(mocked.getSubjectData).not.toHaveBeenCalled();
    });

    it('forwards service 404 errors to the error handler', async () => {
      const { HttpError } = await import('../utils/http-error.js');
      mocked.resolveSubjectUserId.mockResolvedValue('u-2');
      mocked.getSubjectData.mockRejectedValue(new HttpError(404, 'Data subject not found'));

      const res = await request(buildApp()).get('/api/data-subject-rights/access/u-2');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Data subject not found');
    });

    it('passes query params through unaffected (sanity that access route ignores format)', async () => {
      setAuth({ userId: 'u-2', role: 'EMPLOYEE' });
      mocked.resolveSubjectUserId.mockResolvedValue('u-2');
      mocked.getSubjectData.mockResolvedValue(sampleSubjectData as never);

      const res = await request(buildApp()).get('/api/data-subject-rights/access/u-2?format=csv');

      expect(res.status).toBe(200);
      expect(mocked.getSubjectData).toHaveBeenCalledWith('u-2');
    });
  });

  describe('POST /erasure/:userId (Art. 17 erasure)', () => {
    it('erases data when called by ADMIN', async () => {
      setAuth({ userId: 'u-1', role: 'ADMIN' });
      const eraseResult = { erased: true, retainedRecords: [], filesDeleted: 0 };
      mocked.eraseSubjectData.mockResolvedValue(eraseResult as never);

      const res = await request(buildApp()).post('/api/data-subject-rights/erasure/u-5');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(eraseResult);
      expect(mocked.eraseSubjectData).toHaveBeenCalledWith('u-5', 'u-1', 'admin@example.com');
    });

    it('erases data when called by HR_MANAGER', async () => {
      setAuth({ userId: 'u-1', role: 'HR_MANAGER', email: 'hr@example.com' });
      mocked.eraseSubjectData.mockResolvedValue({
        erased: true,
        retainedRecords: ['x'],
        filesDeleted: 2,
      } as never);

      const res = await request(buildApp()).post('/api/data-subject-rights/erasure/u-5');

      expect(res.status).toBe(200);
      expect(mocked.eraseSubjectData).toHaveBeenCalledWith('u-5', 'u-1', 'hr@example.com');
    });

    it('forbids MANAGER from erasing (RBAC 403)', async () => {
      setAuth({ userId: 'u-1', role: 'MANAGER' });

      const res = await request(buildApp()).post('/api/data-subject-rights/erasure/u-5');

      expect(res.status).toBe(403);
      expect(mocked.eraseSubjectData).not.toHaveBeenCalled();
    });

    it('forbids EMPLOYEE from erasing (RBAC 403)', async () => {
      setAuth({ userId: 'u-1', role: 'EMPLOYEE' });

      const res = await request(buildApp()).post('/api/data-subject-rights/erasure/u-5');

      expect(res.status).toBe(403);
      expect(mocked.eraseSubjectData).not.toHaveBeenCalled();
    });

    it('forwards service 404 errors to the error handler', async () => {
      setAuth({ userId: 'u-1', role: 'ADMIN' });
      const { HttpError } = await import('../utils/http-error.js');
      mocked.eraseSubjectData.mockRejectedValue(new HttpError(404, 'Data subject not found'));

      const res = await request(buildApp()).post('/api/data-subject-rights/erasure/u-5');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Data subject not found');
    });

    it('forwards generic service errors as 500', async () => {
      setAuth({ userId: 'u-1', role: 'ADMIN' });
      mocked.eraseSubjectData.mockRejectedValue(new Error('db down'));

      const res = await request(buildApp()).post('/api/data-subject-rights/erasure/u-5');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /export/:userId (Art. 20 portability)', () => {
    it('exports as JSON by default (no format query)', async () => {
      setAuth({ userId: 'u-1', role: 'ADMIN' });
      mocked.resolveSubjectUserId.mockResolvedValue('u-7');
      mocked.exportSubjectData.mockResolvedValue({
        data: sampleSubjectData,
        format: 'json',
      } as never);

      const res = await request(buildApp()).get('/api/data-subject-rights/export/u-7');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(JSON.parse(JSON.stringify(sampleSubjectData)));
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-disposition']).toContain('data-export-u-7.json');
      expect(mocked.exportSubjectData).toHaveBeenCalledWith(
        'u-7',
        'json',
        'u-1',
        'admin@example.com',
      );
    });

    it('exports as CSV when format=csv is requested', async () => {
      setAuth({ userId: 'u-1', role: 'ADMIN' });
      mocked.resolveSubjectUserId.mockResolvedValue('u-7');
      const csvRows = [{ module: 'all', field: 'email', value: 'x@example.com' }];
      mocked.exportSubjectData.mockResolvedValue({ data: csvRows, format: 'csv' } as never);

      const res = await request(buildApp()).get('/api/data-subject-rights/export/u-7?format=csv');

      expect(res.status).toBe(200);
      // The CSV body is served with a text/csv content-type, so read it as text.
      expect(res.text).toBe(JSON.stringify(csvRows));
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('data-export-u-7.csv');
      expect(mocked.exportSubjectData).toHaveBeenCalledWith(
        'u-7',
        'csv',
        'u-1',
        'admin@example.com',
      );
    });

    it('allows EMPLOYEE to export their own data (self access, no RBAC role gate)', async () => {
      setAuth({ userId: 'u-9', role: 'EMPLOYEE' });
      mocked.resolveSubjectUserId.mockResolvedValue('u-9');
      mocked.exportSubjectData.mockResolvedValue({
        data: sampleSubjectData,
        format: 'json',
      } as never);

      const res = await request(buildApp()).get('/api/data-subject-rights/export/u-9');

      expect(res.status).toBe(200);
      expect(mocked.exportSubjectData).toHaveBeenCalledWith(
        'u-9',
        'json',
        'u-9',
        'admin@example.com',
      );
    });

    it('forwards 403 when resolveSubjectUserId rejects for cross-user EMPLOYEE export', async () => {
      setAuth({ userId: 'u-9', role: 'EMPLOYEE' });
      const { HttpError } = await import('../utils/http-error.js');
      mocked.resolveSubjectUserId.mockRejectedValue(
        new HttpError(403, 'You can only access your own data'),
      );

      const res = await request(buildApp()).get('/api/data-subject-rights/export/u-7');

      expect(res.status).toBe(403);
      expect(mocked.exportSubjectData).not.toHaveBeenCalled();
    });

    it('forwards service 404 errors to the error handler', async () => {
      setAuth({ userId: 'u-1', role: 'ADMIN' });
      const { HttpError } = await import('../utils/http-error.js');
      mocked.resolveSubjectUserId.mockResolvedValue('u-7');
      mocked.exportSubjectData.mockRejectedValue(new HttpError(404, 'Data subject not found'));

      const res = await request(buildApp()).get('/api/data-subject-rights/export/u-7');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Data subject not found');
    });

    it('passes the raw format value (e.g. xml) through to the service', async () => {
      setAuth({ userId: 'u-1', role: 'ADMIN' });
      mocked.resolveSubjectUserId.mockResolvedValue('u-7');
      mocked.exportSubjectData.mockResolvedValue({
        data: sampleSubjectData,
        format: 'xml',
      } as never);

      const res = await request(buildApp()).get('/api/data-subject-rights/export/u-7?format=xml');

      expect(res.status).toBe(200);
      // The service decides the actual serialization; the route forwards the
      // raw query value rather than normalizing it.
      expect(mocked.exportSubjectData).toHaveBeenCalledWith(
        'u-7',
        'xml',
        'u-1',
        'admin@example.com',
      );
    });

    it('defaults to json format when no format query is provided', async () => {
      setAuth({ userId: 'u-1', role: 'ADMIN' });
      mocked.resolveSubjectUserId.mockResolvedValue('u-7');
      mocked.exportSubjectData.mockResolvedValue({
        data: sampleSubjectData,
        format: 'json',
      } as never);

      const res = await request(buildApp()).get('/api/data-subject-rights/export/u-7');

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('data-export-u-7.json');
      expect(mocked.exportSubjectData).toHaveBeenCalledWith(
        'u-7',
        'json',
        'u-1',
        'admin@example.com',
      );
    });
  });
});
