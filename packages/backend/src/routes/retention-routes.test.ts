import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../config/prisma.js', () => ({
  prisma: {},
}));

const authState = vi.hoisted(() => ({
  user: { userId: 'u-1', email: 'admin@example.com', role: 'ADMIN' } as {
    userId: string;
    email: string;
    role: string;
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

vi.mock('../services/retention-service.js', () => ({
  listPolicies: vi.fn(),
  upsertPolicy: vi.fn(),
  placeLegalHold: vi.fn(),
  releaseLegalHold: vi.fn(),
  dryRunPurge: vi.fn(),
  executePurge: vi.fn(),
}));

vi.mock('./audit-service.js', () => ({
  logAuditEvent: vi.fn(),
}));

import * as retentionService from '../services/retention-service.js';
import { retentionRoutes } from './retention-routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import { HttpError } from '../utils/http-error.js';

const mocked = {
  listPolicies: vi.mocked(retentionService.listPolicies),
  upsertPolicy: vi.mocked(retentionService.upsertPolicy),
  dryRunPurge: vi.mocked(retentionService.dryRunPurge),
  executePurge: vi.mocked(retentionService.executePurge),
  placeLegalHold: vi.mocked(retentionService.placeLegalHold),
  releaseLegalHold: vi.mocked(retentionService.releaseLegalHold),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/retention', retentionRoutes);
  app.use(errorHandler);
  return app;
}

function setRole(role: string) {
  authState.user = { userId: 'u-1', email: 'x@example.com', role };
}

describe('retention-routes (GDPR RBAC)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { userId: 'u-1', email: 'x@example.com', role: 'ADMIN' };
    mocked.listPolicies.mockResolvedValue([] as never);
    mocked.upsertPolicy.mockResolvedValue({ id: 'p-1' } as never);
    mocked.dryRunPurge.mockResolvedValue([] as never);
    mocked.executePurge.mockResolvedValue({
      purged: 0,
      anonymized: 0,
      skipped: 0,
      errors: [],
    } as never);
    mocked.placeLegalHold.mockResolvedValue({ id: 'lh-1' } as never);
    mocked.releaseLegalHold.mockResolvedValue({ id: 'lh-1' } as never);
  });

  describe('RBAC enforcement (all routes are Admin-only)', () => {
    const nonAdminRoles = ['HR_MANAGER', 'MANAGER', 'EMPLOYEE'];

    it('allows ADMIN to list retention policies', async () => {
      setRole('ADMIN');
      const res = await request(buildApp()).get('/api/retention/policies');
      expect(res.status).toBe(200);
      expect(mocked.listPolicies).toHaveBeenCalled();
    });

    it.each(nonAdminRoles)('forbids %s from listing retention policies (403)', async (role) => {
      setRole(role);
      const res = await request(buildApp()).get('/api/retention/policies');
      expect(res.status).toBe(403);
      expect(mocked.listPolicies).not.toHaveBeenCalled();
    });

    it.each(nonAdminRoles)('forbids %s from upserting a policy (403)', async (role) => {
      setRole(role);
      const res = await request(buildApp()).put('/api/retention/policies').send({
        dataCategory: 'AUDIT_LOGS',
        retentionYears: 5,
        action: 'HARD_DELETE',
      });
      expect(res.status).toBe(403);
      expect(mocked.upsertPolicy).not.toHaveBeenCalled();
    });

    it.each(nonAdminRoles)('forbids %s from running a purge (403)', async (role) => {
      setRole(role);
      const res = await request(buildApp()).post('/api/retention/purge');
      expect(res.status).toBe(403);
      expect(mocked.executePurge).not.toHaveBeenCalled();
    });

    it.each(nonAdminRoles)('forbids %s from placing a legal hold (403)', async (role) => {
      setRole(role);
      const res = await request(buildApp())
        .post('/api/retention/legal-hold')
        .send({ entityType: 'Employee', entityId: 'e-1', reason: 'Litigation' });
      expect(res.status).toBe(403);
      expect(mocked.placeLegalHold).not.toHaveBeenCalled();
    });

    it.each(nonAdminRoles)('forbids %s from releasing a legal hold (403)', async (role) => {
      setRole(role);
      const res = await request(buildApp()).delete('/api/retention/legal-hold/lh-9');
      expect(res.status).toBe(403);
      expect(mocked.releaseLegalHold).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/retention/policies', () => {
    it('returns the policies wrapped in { policies }', async () => {
      setRole('ADMIN');
      mocked.listPolicies.mockResolvedValue([{ id: 'p-1' }, { id: 'p-2' }] as never);
      const res = await request(buildApp()).get('/api/retention/policies');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ policies: [{ id: 'p-1' }, { id: 'p-2' }] });
    });

    it('forwards service errors to the error handler', async () => {
      setRole('ADMIN');
      mocked.listPolicies.mockRejectedValue(new Error('db down'));
      const res = await request(buildApp()).get('/api/retention/policies');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  describe('PUT /api/retention/policies', () => {
    it('creates a policy with the required fields (ADMIN)', async () => {
      setRole('ADMIN');
      const body = {
        dataCategory: 'AUDIT_LOGS',
        retentionYears: 7,
        action: 'HARD_DELETE',
      };
      const res = await request(buildApp()).put('/api/retention/policies').send(body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ policy: { id: 'p-1' } });
      expect(mocked.upsertPolicy).toHaveBeenCalledWith({
        dataCategory: 'AUDIT_LOGS',
        retentionYears: 7,
        action: 'HARD_DELETE',
      });
    });

    it('forwards optional description and isDefault when provided', async () => {
      setRole('ADMIN');
      await request(buildApp()).put('/api/retention/policies').send({
        dataCategory: 'CANDIDATE_RESUMES',
        retentionYears: 2,
        action: 'ANONYMIZE',
        description: 'Keep for audit',
        isDefault: true,
      });
      expect(mocked.upsertPolicy).toHaveBeenCalledWith({
        dataCategory: 'CANDIDATE_RESUMES',
        retentionYears: 2,
        action: 'ANONYMIZE',
        description: 'Keep for audit',
        isDefault: true,
      });
    });

    it('omits description and isDefault when not provided', async () => {
      setRole('ADMIN');
      await request(buildApp()).put('/api/retention/policies').send({
        dataCategory: 'CONTRACTS',
        retentionYears: 10,
        action: 'HARD_DELETE',
      });
      const call = mocked.upsertPolicy.mock.calls[0][0] as Record<string, unknown>;
      expect(call.description).toBeUndefined();
      expect(call.isDefault).toBeUndefined();
    });

    it('forwards HttpError status codes from the service', async () => {
      setRole('ADMIN');
      mocked.upsertPolicy.mockRejectedValue(new HttpError(400, 'invalid category'));
      const res = await request(buildApp())
        .put('/api/retention/policies')
        .send({ dataCategory: 'BAD', retentionYears: 1, action: 'HARD_DELETE' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid category');
    });
  });

  describe('POST /api/retention/purge', () => {
    it('runs a dry-run purge for ADMIN and returns candidates with count', async () => {
      setRole('ADMIN');
      mocked.dryRunPurge.mockResolvedValue([{ id: 'x' }, { id: 'y' }] as never);
      const res = await request(buildApp()).post('/api/retention/purge?dryRun=true');
      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.count).toBe(2);
      expect(res.body.candidates).toHaveLength(2);
      expect(mocked.dryRunPurge).toHaveBeenCalled();
      expect(mocked.executePurge).not.toHaveBeenCalled();
    });

    it('executes a real purge for ADMIN using the authenticated user', async () => {
      setRole('ADMIN');
      const res = await request(buildApp()).post('/api/retention/purge');
      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(false);
      expect(mocked.executePurge).toHaveBeenCalledWith('u-1', 'x@example.com');
      expect(mocked.dryRunPurge).not.toHaveBeenCalled();
    });

    it('treats only the literal string "true" as a dry run (other values execute)', async () => {
      setRole('ADMIN');
      await request(buildApp()).post('/api/retention/purge?dryRun=1');
      expect(mocked.executePurge).toHaveBeenCalled();
      expect(mocked.dryRunPurge).not.toHaveBeenCalled();
    });

    it('forwards service errors during a real purge', async () => {
      setRole('ADMIN');
      mocked.executePurge.mockRejectedValue(new Error('purge failed'));
      const res = await request(buildApp()).post('/api/retention/purge');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });

    it('forwards service errors during a dry run', async () => {
      setRole('ADMIN');
      mocked.dryRunPurge.mockRejectedValue(new Error('scan failed'));
      const res = await request(buildApp()).post('/api/retention/purge?dryRun=true');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/retention/legal-hold', () => {
    it('creates a legal hold for ADMIN and returns 201', async () => {
      setRole('ADMIN');
      const res = await request(buildApp())
        .post('/api/retention/legal-hold')
        .send({ entityType: 'Employee', entityId: 'e-1', reason: 'Litigation' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ hold: { id: 'lh-1' } });
      expect(mocked.placeLegalHold).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Employee',
          entityId: 'e-1',
          reason: 'Litigation',
          actorId: 'u-1',
          actorName: 'x@example.com',
        }),
      );
    });

    it('forwards an HttpError (e.g. missing reason) from the service', async () => {
      setRole('ADMIN');
      mocked.placeLegalHold.mockRejectedValue(new HttpError(400, 'Legal hold requires a reason'));
      const res = await request(buildApp())
        .post('/api/retention/legal-hold')
        .send({ entityType: 'Employee', entityId: 'e-1', reason: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('reason');
    });
  });

  describe('DELETE /api/retention/legal-hold/:id', () => {
    it('releases a legal hold for ADMIN and returns the hold', async () => {
      setRole('ADMIN');
      const res = await request(buildApp()).delete('/api/retention/legal-hold/lh-42');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hold: { id: 'lh-1' } });
      expect(mocked.releaseLegalHold).toHaveBeenCalledWith('lh-42', 'u-1', 'x@example.com');
    });

    it('passes the route id parameter through to the service', async () => {
      setRole('ADMIN');
      await request(buildApp()).delete('/api/retention/legal-hold/abc-123');
      expect(mocked.releaseLegalHold).toHaveBeenCalledWith('abc-123', 'u-1', 'x@example.com');
    });

    it('forwards service errors during release', async () => {
      setRole('ADMIN');
      mocked.releaseLegalHold.mockRejectedValue(new Error('hold not found'));
      const res = await request(buildApp()).delete('/api/retention/legal-hold/missing');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });
});
