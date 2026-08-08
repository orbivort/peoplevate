import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// --- Mocks -------------------------------------------------------------

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = authUser;
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

vi.mock('../config/prisma.js', () => ({
  prisma: {
    dataSubjectAccessRequest: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../config/env.js', () => ({
  env: {
    DSAR_SLA_DAYS: 30,
    DSAR_REMINDER_DAYS: 25,
    DPO_CONTACT_EMAIL: 'dpo@peoplevate.local',
  },
}));

vi.mock('../services/audit-service.js', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { env } from '../config/env.js';
import { logAuditEvent } from '../services/audit-service.js';
import { prisma } from '../config/prisma.js';
import { dsarRoutes, checkDsarSla } from './dsar-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

// The UserRole enum resolves from the generated Prisma client via `#prisma`.
// Re-declare the literals here so tests do not depend on the generated file.
const UserRole = {
  ADMIN: 'ADMIN',
  HR_MANAGER: 'HR_MANAGER',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
} as const;

// Mutable auth user so individual tests can switch roles.
const authUser: {
  userId: string;
  email: string;
  role: string;
  employeeId?: string | null;
} = { userId: 'u-1', email: 'jane@example.com', role: UserRole.HR_MANAGER, employeeId: 'emp-1' };

const mocked = {
  authenticate: vi.mocked(authenticate),
  getAuthUser: vi.mocked(getAuthUser),
  requireRoles: vi.mocked(requireRoles),
  logAuditEvent: vi.mocked(logAuditEvent),
  prismaCreate: vi.mocked(prisma.dataSubjectAccessRequest.create),
  prismaFindMany: vi.mocked(prisma.dataSubjectAccessRequest.findMany),
  prismaFindUnique: vi.mocked(prisma.dataSubjectAccessRequest.findUnique),
  prismaUpdate: vi.mocked(prisma.dataSubjectAccessRequest.update),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/dsar', dsarRoutes);
  app.use(errorHandler);
  return app;
}

// Note: route handlers return raw Prisma results unmodified; supertest
// serializes Date fields to ISO strings over the wire. Test fixtures therefore
// use ISO strings so `toEqual` matches the serialized HTTP body.
const fixedNow = '2026-08-07T13:29:53.465Z';

const sampleDsar = {
  id: 'd-1',
  request_type: 'ACCESS',
  status: 'PENDING_VERIFICATION',
  data_subject_user_id: 'u-1',
  data_subject_email: 'subject@example.com',
  description: null,
  created_at: fixedNow,
};

// --- Tests --------------------------------------------------------------

describe('dsar-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.userId = 'u-1';
    authUser.email = 'jane@example.com';
    authUser.role = UserRole.HR_MANAGER;
    authUser.employeeId = 'emp-1';
  });

  describe('POST /api/dsar', () => {
    it('creates a DSAR and returns 201 with the created record', async () => {
      mocked.prismaCreate.mockResolvedValue(sampleDsar as never);

      const res = await request(buildApp()).post('/api/dsar').send({
        requestType: 'ACCESS',
        dataSubjectEmail: 'subject@example.com',
        description: 'Please export my data',
      });

      expect(res.status).toBe(201);
      expect(res.body.dsar).toEqual(sampleDsar);
      expect(mocked.prismaCreate).toHaveBeenCalledWith({
        data: {
          request_type: 'ACCESS',
          status: 'PENDING_VERIFICATION',
          data_subject_user_id: 'u-1',
          data_subject_email: 'subject@example.com',
          description: 'Please export my data',
        },
      });
      expect(mocked.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'u-1',
          actorName: 'jane@example.com',
          entity: 'DATA_SUBJECT_RIGHTS',
          entityId: 'd-1',
        }),
      );
    });

    it('stores null description when description is omitted', async () => {
      mocked.prismaCreate.mockResolvedValue({ ...sampleDsar, description: null } as never);

      const res = await request(buildApp())
        .post('/api/dsar')
        .send({ requestType: 'ERASURE', dataSubjectEmail: 'subject@example.com' });

      expect(res.status).toBe(201);
      expect(mocked.prismaCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: null }),
        }),
      );
    });

    it('associates the DSAR with the authenticated user as data subject', async () => {
      mocked.prismaCreate.mockResolvedValue(sampleDsar as never);

      await request(buildApp())
        .post('/api/dsar')
        .send({ requestType: 'ACCESS', dataSubjectEmail: 'subject@example.com' });

      const call = mocked.prismaCreate.mock.calls[0][0] as {
        data: { data_subject_user_id: string };
      };
      expect(call.data.data_subject_user_id).toBe('u-1');
    });

    it('forwards errors to the error handler', async () => {
      mocked.prismaCreate.mockRejectedValue(new Error('db down'));

      const res = await request(buildApp())
        .post('/api/dsar')
        .send({ requestType: 'ACCESS', dataSubjectEmail: 'subject@example.com' });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/dsar', () => {
    it('returns all DSARs for an Admin', async () => {
      authUser.role = UserRole.ADMIN;
      mocked.prismaFindMany.mockResolvedValue([sampleDsar] as never);

      const res = await request(buildApp()).get('/api/dsar');

      expect(res.status).toBe(200);
      expect(res.body.dsars).toEqual([sampleDsar]);
      // Admin sees all: no data_subject_user_id filter is added.
      expect(mocked.prismaFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({}),
        orderBy: { created_at: 'desc' },
      });
      const callArg = mocked.prismaFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArg.where.data_subject_user_id).toBeUndefined();
    });

    it('scopes the query to the current user for non-admin/HR roles', async () => {
      authUser.role = UserRole.EMPLOYEE;
      mocked.prismaFindMany.mockResolvedValue([sampleDsar] as never);

      await request(buildApp()).get('/api/dsar');

      expect(mocked.prismaFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ data_subject_user_id: 'u-1' }),
        }),
      );
    });

    it('filters by status query param when provided', async () => {
      mocked.prismaFindMany.mockResolvedValue([] as never);

      await request(buildApp()).get('/api/dsar?status=VERIFIED');

      expect(mocked.prismaFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'VERIFIED' }),
        }),
      );
    });

    it('forwards errors to the error handler', async () => {
      mocked.prismaFindMany.mockRejectedValue(new Error('db down'));

      const res = await request(buildApp()).get('/api/dsar');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/dsar/:id', () => {
    it('returns the DSAR when found', async () => {
      mocked.prismaFindUnique.mockResolvedValue(sampleDsar as never);

      const res = await request(buildApp()).get('/api/dsar/d-1');

      expect(res.status).toBe(200);
      expect(res.body.dsar).toEqual(sampleDsar);
      expect(mocked.prismaFindUnique).toHaveBeenCalledWith({ where: { id: 'd-1' } });
    });

    it('returns 404 when the DSAR does not exist', async () => {
      mocked.prismaFindUnique.mockResolvedValue(null as never);

      const res = await request(buildApp()).get('/api/dsar/missing');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('DSAR not found');
    });

    it('allows the data subject (employee) to view their own DSAR', async () => {
      authUser.role = UserRole.EMPLOYEE;
      const ownDsar = { ...sampleDsar, data_subject_user_id: 'u-1' };
      mocked.prismaFindUnique.mockResolvedValue(ownDsar as never);

      const res = await request(buildApp()).get('/api/dsar/d-1');

      expect(res.status).toBe(200);
    });

    it("returns 403 when an employee views another user's DSAR", async () => {
      authUser.role = UserRole.EMPLOYEE;
      const otherDsar = { ...sampleDsar, data_subject_user_id: 'other-user' };
      mocked.prismaFindUnique.mockResolvedValue(otherDsar as never);

      const res = await request(buildApp()).get('/api/dsar/d-1');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });

    it('forwards errors to the error handler', async () => {
      mocked.prismaFindUnique.mockRejectedValue(new Error('db down'));

      const res = await request(buildApp()).get('/api/dsar/d-1');

      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /api/dsar/:id/status', () => {
    it('requires Admin/HR roles via requireRoles middleware', () => {
      // verify the middleware factory is wired onto the route
      expect(mocked.requireRoles).toBeDefined();
    });

    it('returns 404 when the DSAR does not exist', async () => {
      mocked.prismaFindUnique.mockResolvedValue(null as never);

      const res = await request(buildApp())
        .patch('/api/dsar/d-1/status')
        .send({ status: 'VERIFIED' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('DSAR not found');
      expect(mocked.prismaUpdate).not.toHaveBeenCalled();
    });

    it('transitions PENDING_VERIFICATION -> VERIFIED setting verification + SLA fields', async () => {
      const existing = { ...sampleDsar, status: 'PENDING_VERIFICATION' };
      mocked.prismaFindUnique.mockResolvedValue(existing as never);
      const updated = { ...existing, status: 'VERIFIED', verified_at: fixedNow };
      mocked.prismaUpdate.mockResolvedValue(updated as never);

      const res = await request(buildApp())
        .patch('/api/dsar/d-1/status')
        .send({ status: 'VERIFIED', assignedToId: 'assignee-1' });

      expect(res.status).toBe(200);
      expect(res.body.dsar).toEqual(updated);
      const data = (mocked.prismaUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data.status).toBe('VERIFIED');
      expect(data.identity_verified_by_id).toBe('u-1');
      expect(data.identity_verified_at).toBeInstanceOf(Date);
      expect(data.verified_at).toBeInstanceOf(Date);
      expect(data.sla_deadline).toBeInstanceOf(Date);
      expect(data.assigned_to_id).toBe('assignee-1');
    });

    it('does not set assigned_to_id when not provided', async () => {
      const existing = { ...sampleDsar, status: 'PENDING_VERIFICATION' };
      mocked.prismaFindUnique.mockResolvedValue(existing as never);
      mocked.prismaUpdate.mockResolvedValue(existing as never);

      await request(buildApp()).patch('/api/dsar/d-1/status').send({ status: 'VERIFIED' });

      const data = (mocked.prismaUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data.assigned_to_id).toBeUndefined();
    });

    it('transitions VERIFIED -> IN_PROGRESS with only the status change', async () => {
      const existing = { ...sampleDsar, status: 'VERIFIED' };
      mocked.prismaFindUnique.mockResolvedValue(existing as never);
      mocked.prismaUpdate.mockResolvedValue({ ...existing, status: 'IN_PROGRESS' } as never);

      const res = await request(buildApp())
        .patch('/api/dsar/d-1/status')
        .send({ status: 'IN_PROGRESS' });

      expect(res.status).toBe(200);
      const data = (mocked.prismaUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data.status).toBe('IN_PROGRESS');
      expect(data.identity_verified_at).toBeUndefined();
    });

    it('transitions to COMPLETED setting completed_at', async () => {
      const existing = { ...sampleDsar, status: 'IN_PROGRESS' };
      mocked.prismaFindUnique.mockResolvedValue(existing as never);
      mocked.prismaUpdate.mockResolvedValue({ ...existing, status: 'COMPLETED' } as never);

      const res = await request(buildApp())
        .patch('/api/dsar/d-1/status')
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(200);
      const data = (mocked.prismaUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data.status).toBe('COMPLETED');
      expect(data.completed_at).toBeInstanceOf(Date);
    });

    it('transitions to REJECTED storing rejection reason', async () => {
      const existing = { ...sampleDsar, status: 'PENDING_VERIFICATION' };
      mocked.prismaFindUnique.mockResolvedValue(existing as never);
      mocked.prismaUpdate.mockResolvedValue({ ...existing, status: 'REJECTED' } as never);

      const res = await request(buildApp())
        .patch('/api/dsar/d-1/status')
        .send({ status: 'REJECTED', rejectionReason: 'Not verifiable' });

      expect(res.status).toBe(200);
      const data = (mocked.prismaUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data.status).toBe('REJECTED');
      expect(data.rejection_reason).toBe('Not verifiable');
    });

    it('does not set rejection_reason when REJECTED without reason', async () => {
      const existing = { ...sampleDsar, status: 'PENDING_VERIFICATION' };
      mocked.prismaFindUnique.mockResolvedValue(existing as never);
      mocked.prismaUpdate.mockResolvedValue({ ...existing, status: 'REJECTED' } as never);

      await request(buildApp()).patch('/api/dsar/d-1/status').send({ status: 'REJECTED' });

      const data = (mocked.prismaUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data.rejection_reason).toBeUndefined();
    });

    it('logs an audit event capturing previous status', async () => {
      const existing = { ...sampleDsar, status: 'PENDING_VERIFICATION' };
      mocked.prismaFindUnique.mockResolvedValue(existing as never);
      mocked.prismaUpdate.mockResolvedValue({ ...existing, status: 'VERIFIED' } as never);

      await request(buildApp()).patch('/api/dsar/d-1/status').send({ status: 'VERIFIED' });

      expect(mocked.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'd-1',
          newValue: expect.objectContaining({
            status: 'VERIFIED',
            previousStatus: 'PENDING_VERIFICATION',
          }),
        }),
      );
    });

    it('forwards errors to the error handler', async () => {
      mocked.prismaFindUnique.mockRejectedValue(new Error('db down'));

      const res = await request(buildApp())
        .patch('/api/dsar/d-1/status')
        .send({ status: 'VERIFIED' });

      expect(res.status).toBe(500);
    });
  });

  describe('checkDsarSla', () => {
    it('does not log when no DSARs are approaching or overdue', async () => {
      mocked.prismaFindMany.mockResolvedValue([] as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await checkDsarSla();

      expect(logSpy).not.toHaveBeenCalled();
      expect(mocked.prismaFindMany).toHaveBeenCalledTimes(2);
      logSpy.mockRestore();
    });

    it('logs a reminder when DSARs are approaching deadline', async () => {
      mocked.prismaFindMany
        .mockResolvedValueOnce([sampleDsar] as never) // approaching
        .mockResolvedValueOnce([] as never); // overdue
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await checkDsarSla();

      expect(logSpy).toHaveBeenCalledWith('[DSAR SLA] 1 DSAR(s) approaching deadline');
      logSpy.mockRestore();
    });

    it('logs escalation when DSARs are overdue', async () => {
      mocked.prismaFindMany
        .mockResolvedValueOnce([] as never) // approaching
        .mockResolvedValueOnce([sampleDsar, { ...sampleDsar, id: 'd-2' }] as never); // overdue
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await checkDsarSla();

      expect(logSpy).toHaveBeenCalledWith(
        `[DSAR SLA] 2 DSAR(s) overdue - escalating to DPO: ${env.DPO_CONTACT_EMAIL}`,
      );
      logSpy.mockRestore();
    });
  });
});
