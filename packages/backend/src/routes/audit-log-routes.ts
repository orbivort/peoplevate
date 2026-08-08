import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { AuditAction, AuditEntity, UserRole } from '#prisma';
import { summarizeAuditRow } from '../services/audit-service.js';

export const auditLogRoutes: Router = Router();

/** Allowed page sizes. Unsupported values are clamped back to the default. */
const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_PAGE = 1;

/** Parse and clamp a page number to >= 1. */
function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed) || parsed < DEFAULT_PAGE) {
    return DEFAULT_PAGE;
  }
  return parsed;
}

/**
 * Parse an ISO date-range bound. Invalid or missing values return undefined so
 * the filter is simply omitted. Accepts `YYYY-MM-DD` and full ISO timestamps.
 */
function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

/** Parse a page size, restricting it to the configured set (default 25). */
function parsePageSize(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_PAGE_SIZE;
  }
  const match = (PAGE_SIZES as readonly number[]).find((size) => size === parsed);
  return match ?? DEFAULT_PAGE_SIZE;
}

auditLogRoutes.use(authenticate);

auditLogRoutes.get(
  '/',
  requireRoles(UserRole.ADMIN, UserRole.HR_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { action, entity, search, from, to, user } = req.query as Record<
        string,
        string | undefined
      >;
      const actor = getAuthUser(req)!;

      const page = parsePage(req.query.page as string | undefined);
      const pageSize = parsePageSize(req.query.pageSize as string | undefined);

      const where: Record<string, unknown> = {};

      if (actor.role === UserRole.HR_MANAGER) {
        where.entity = { in: [AuditEntity.EMPLOYEES, AuditEntity.DOCUMENTS] };
      } else if (entity) {
        where.entity = entity as AuditEntity;
      }

      if (action) {
        where.action = action as AuditAction;
      }

      // Free-text search and the actor (user) filter are independent AND'd
      // conditions, each expressed as its own OR-group so they do not bleed
      // into one another (which would make either match everything).
      const and: Record<string, unknown>[] = [];

      if (search) {
        and.push({
          OR: [
            { actor_name: { contains: search, mode: 'insensitive' } },
            { entity: { contains: search, mode: 'insensitive' } },
            { entity_id: { contains: search, mode: 'insensitive' } },
          ],
        });
      }

      // Filter by the actor (user) who performed the operation. Matches either
      // the raw user id or the display name, case-insensitively.
      if (user) {
        and.push({
          OR: [
            { actor_id: { equals: user, mode: 'insensitive' } },
            { actor_name: { contains: user, mode: 'insensitive' } },
          ],
        });
      }

      if (and.length > 0) {
        where.AND = and;
      }

      // Date-range filter (inclusive) over the immutable `timestamp` column.
      const fromDate = parseDate(from);
      const toDate = parseDate(to);
      if (fromDate || toDate) {
        where.timestamp = {
          ...(fromDate ? { gte: fromDate } : {}),
          // Extend the exclusive end-of-day bound so `to=YYYY-MM-DD` includes
          // every entry recorded on that date.
          ...(toDate ? { lte: new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1) } : {}),
        };
      }

      // Fetch the total count and the requested page concurrently so only one
      // round-trip latency is added and only the needed page rows are loaded.
      const [total, rows] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: [{ timestamp: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      // Transform raw rows into display-safe views: redact PII, compute a
      // field-level diff, and never send the raw old/new row JSON to the UI.
      const logs = rows.map((row) => summarizeAuditRow(row));

      res.json({ logs, pagination: { page, pageSize, total, totalPages } });
    } catch (err) {
      next(err);
    }
  },
);
