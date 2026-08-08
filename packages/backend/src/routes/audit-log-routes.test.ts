import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AuditEntity } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

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
  requireRoles: vi.fn(
    (..._roles: string[]) =>
      (_req: unknown, _res: unknown, next: () => void) =>
        next(),
  ),
}));

import { prisma } from '../config/prisma.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { auditLogRoutes } from './audit-log-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  findMany: vi.mocked(prisma.auditLog.findMany),
  count: vi.mocked(prisma.auditLog.count),
  authenticate: vi.mocked(authenticate),
  getAuthUser: vi.mocked(getAuthUser),
  requireRoles: vi.mocked(requireRoles),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/audit-log', auditLogRoutes);
  app.use(errorHandler);
  return app;
}

describe('audit-log-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.findMany.mockResolvedValue([{ id: 'log1' }]);
    mocked.count.mockResolvedValue(1);
  });

  describe('GET /api/audit-log', () => {
    it('restricts entity scope for HR_MANAGER role and returns display-safe views', async () => {
      mocked.findMany.mockResolvedValue([
        {
          id: 'log1',
          actor_id: 'u1',
          actor_name: 'Grace Liu',
          action: 'UPDATE',
          entity: 'EMPLOYEES',
          entity_id: 'emp-1',
          old_value: { status: 'ACTIVE', email: 'x@example.com' },
          new_value: { status: 'PROBATION', email: 'y@example.com' },
          timestamp: new Date('2026-08-07T10:00:00Z'),
        },
      ]);
      const res = await request(buildApp()).get('/api/audit-log');

      expect(res.status).toBe(200);
      // Raw rows are never sent: the view strips old/new JSON and exposes a
      // redacted field-level diff with a humanized entity label.
      expect(res.body.logs).toHaveLength(1);
      const log = res.body.logs[0] as Record<string, unknown>;
      expect(log.id).toBe('log1');
      expect(log.entityLabel).toBe('Employees');
      expect(log.status).toBe('Success');
      expect(log.old_value).toBeUndefined();
      expect(log.new_value).toBeUndefined();
      const status = (log.changes as { field: string; old: unknown; new: unknown }[]).find(
        (c) => c.field === 'status',
      );
      expect(status).toMatchObject({ old: 'ACTIVE', new: 'PROBATION' });
      // Defaults: page 1, pageSize 25, deterministic ordering, bounded take.
      expect(mocked.findMany).toHaveBeenCalledWith({
        where: { entity: { in: [AuditEntity.EMPLOYEES, AuditEntity.DOCUMENTS] } },
        orderBy: [{ timestamp: 'desc' }, { id: 'asc' }],
        skip: 0,
        take: 25,
      });
      expect(mocked.count).toHaveBeenCalledWith({
        where: { entity: { in: [AuditEntity.EMPLOYEES, AuditEntity.DOCUMENTS] } },
      });
      // Pagination metadata accompanies the results.
      expect(res.body.pagination).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    });

    it('applies search and action filters', async () => {
      await request(buildApp()).get('/api/audit-log?action=CREATE&search=john');

      const where = mocked.findMany.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.action).toBe('CREATE');
      const and = where.AND as Record<string, unknown>[];
      expect(Array.isArray(and)).toBe(true);
      expect(and.some((c) => Array.isArray(c.OR))).toBe(true);
    });

    it('applies a user (actor) filter alongside other conditions', async () => {
      await request(buildApp()).get('/api/audit-log?user=grace');

      const where = mocked.findMany.mock.calls[0][0].where as Record<string, unknown>;
      const and = where.AND as Record<string, unknown>[];
      expect(Array.isArray(and)).toBe(true);
      const or = and.find((c) => Array.isArray(c.OR))?.OR as Record<string, unknown>[];
      expect(or).toContainEqual({ actor_id: { equals: 'grace', mode: 'insensitive' } });
      expect(or).toContainEqual({ actor_name: { contains: 'grace', mode: 'insensitive' } });
    });

    it('keeps search and user filters as independent AND conditions', async () => {
      await request(buildApp()).get('/api/audit-log?search=john&user=grace');

      const where = mocked.findMany.mock.calls[0][0].where as Record<string, unknown>;
      const and = where.AND as Record<string, unknown>[];
      // Two separate OR-groups: one for the free-text search, one for the user.
      expect(and).toHaveLength(2);
      // The user group must only contain actor conditions.
      const userGroup = and.find(
        (c) => Array.isArray(c.OR) && (c.OR as unknown[]).length === 2,
      ) as { OR: Record<string, unknown>[] };
      expect(userGroup.OR).toEqual([
        { actor_id: { equals: 'grace', mode: 'insensitive' } },
        { actor_name: { contains: 'grace', mode: 'insensitive' } },
      ]);
    });

    it('applies an inclusive date-range filter and extends the end-of-day bound', async () => {
      await request(buildApp()).get('/api/audit-log?from=2026-01-01&to=2026-01-15');

      const where = mocked.findMany.mock.calls[0][0].where as Record<string, unknown>;
      const ts = where.timestamp as { gte: Date; lte: Date };
      expect(ts.gte.toISOString().startsWith('2026-01-01')).toBe(true);
      // `to` bound extends to the end of the day so entries on 2026-01-15 count.
      expect(ts.lte.getTime()).toBeGreaterThanOrEqual(new Date('2026-01-15T00:00:00Z').getTime());
      expect(ts.lte.getTime()).toBeLessThanOrEqual(new Date('2026-01-16T00:00:00Z').getTime());
    });

    it('ignores an invalid date-range bound instead of erroring', async () => {
      await request(buildApp()).get('/api/audit-log?from=not-a-date');

      const where = mocked.findMany.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.timestamp).toBeUndefined();
    });

    it('accepts the GDPR audit action types as filters', async () => {
      const gdprActions = ['READ', 'VIEW', 'DOWNLOAD', 'EXPORT', 'CONSENT', 'PURGE', 'DSAR'];

      for (const action of gdprActions) {
        mocked.findMany.mockClear();
        await request(buildApp()).get(`/api/audit-log?action=${action}`);
        const where = mocked.findMany.mock.calls[0][0].where as Record<string, unknown>;
        expect(where.action).toBe(action);
      }
    });

    it('accepts the GDPR entity types as filters', async () => {
      // Admin has full audit scope, so the entity filter passes through as-is.
      mocked.getAuthUser.mockReturnValue({
        userId: 'u-1',
        email: 'admin@example.com',
        role: 'ADMIN',
      } as never);
      const gdprEntities = ['data-subject-rights', 'breach', 'consent', 'retention', 'keys'];

      for (const entity of gdprEntities) {
        mocked.findMany.mockClear();
        await request(buildApp()).get(`/api/audit-log?entity=${entity}`);
        const where = mocked.findMany.mock.calls[0][0].where as Record<string, unknown>;
        expect(where.entity).toBe(entity);
      }
    });

    it('applies HR_MANAGER entity scope even when a GDPR action filter is present', async () => {
      mocked.getAuthUser.mockReturnValue({
        userId: 'u-1',
        email: 'jane@example.com',
        role: 'HR_MANAGER',
      } as never);
      await request(buildApp()).get('/api/audit-log?action=DOWNLOAD');

      expect(mocked.findMany).toHaveBeenCalledWith({
        where: {
          entity: { in: [AuditEntity.EMPLOYEES, AuditEntity.DOCUMENTS] },
          action: 'DOWNLOAD',
        },
        orderBy: [{ timestamp: 'desc' }, { id: 'asc' }],
        skip: 0,
        take: 25,
      });
    });

    it('paginates with page/pageSize and computes totalPages', async () => {
      mocked.count.mockResolvedValue(60);
      mocked.findMany.mockResolvedValue([
        { id: 'log-a' },
        { id: 'log-b' },
        { id: 'log-c' },
        { id: 'log-d' },
        { id: 'log-e' },
        { id: 'log-f' },
        { id: 'log-g' },
        { id: 'log-h' },
        { id: 'log-i' },
        { id: 'log-j' },
      ]);
      const res = await request(buildApp()).get('/api/audit-log?page=3&pageSize=10');

      expect(res.status).toBe(200);
      expect(mocked.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
      expect(mocked.count).toHaveBeenCalled();
      expect(res.body.logs).toHaveLength(10);
      expect(res.body.pagination).toEqual({ page: 3, pageSize: 10, total: 60, totalPages: 6 });
    });

    it('clamps page below 1 to the first page', async () => {
      await request(buildApp()).get('/api/audit-log?page=0');

      expect(mocked.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 25 }));
    });

    it('clamps unsupported pageSize to the default', async () => {
      await request(buildApp()).get('/api/audit-log?pageSize=999');

      expect(mocked.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 25 }));
    });

    it('accepts each configured page size', async () => {
      for (const size of [10, 25, 50, 100]) {
        mocked.findMany.mockClear();
        await request(buildApp()).get(`/api/audit-log?pageSize=${size}`);
        expect(mocked.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: size }));
      }
    });
  });
});
