import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHRorManager } from '../middleware/rbac.js';
import * as reports from '../services/timesheet-report-service.js';

export const timesheetReportRoutes: Router = Router();
timesheetReportRoutes.use(authenticate);
// Reports are MANAGER and above; EMPLOYEE has no report access (own summary
// comes from GET /api/timesheets). The service scopes MANAGER to direct
// reports while HR_MANAGER/ADMIN see everything.
timesheetReportRoutes.use(requireHRorManager);

// ── Schemas ─────────────────────────────────────

/** Query-string boolean: only the literals "true"/"false" are accepted. */
const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const reportQuerySchema = z.object({
  groupBy: z.enum(['employee', 'project', 'department']).default('employee'),
  from: z.coerce.date(),
  to: z.coerce.date(),
  employeeId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  includeAllStatuses: booleanQuery,
});

const detailsQuerySchema = reportQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Helpers ─────────────────────────────────────

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function requestingUserOf(user: {
  userId: string;
  role: string;
  email: string;
  employeeId?: string | null;
}) {
  return {
    userId: user.userId,
    role: user.role,
    ...(user.employeeId !== undefined ? { employeeId: user.employeeId } : {}),
    userName: user.email,
  };
}

// ── Routes ──────────────────────────────────────

timesheetReportRoutes.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = reportQuerySchema.parse(req.query);
    const user = getAuthUser(req)!;
    // Service returns the contract wrapper { rows, groupBy, from, to, includeAllStatuses }.
    res.json(
      await reports.getSummaryReport({
        requestingUser: requestingUserOf(user),
        groupBy: query.groupBy,
        from: query.from,
        to: query.to,
        employeeId: query.employeeId,
        departmentId: query.departmentId,
        projectId: query.projectId,
        includeAllStatuses: query.includeAllStatuses,
      }),
    );
  } catch (err) {
    next(err);
  }
});

timesheetReportRoutes.get('/details', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = detailsQuerySchema.parse(req.query);
    const user = getAuthUser(req)!;
    // Service returns the contract wrapper { entries, total, page, pageSize }.
    res.json(
      await reports.getDetailsReport({
        requestingUser: requestingUserOf(user),
        groupBy: query.groupBy,
        from: query.from,
        to: query.to,
        employeeId: query.employeeId,
        departmentId: query.departmentId,
        projectId: query.projectId,
        includeAllStatuses: query.includeAllStatuses,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
  } catch (err) {
    next(err);
  }
});

timesheetReportRoutes.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = reportQuerySchema.parse(req.query);
    const user = getAuthUser(req)!;
    const csv = await reports.exportReportCsv({
      requestingUser: requestingUserOf(user),
      groupBy: query.groupBy,
      from: query.from,
      to: query.to,
      employeeId: query.employeeId,
      departmentId: query.departmentId,
      projectId: query.projectId,
      includeAllStatuses: query.includeAllStatuses,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="timesheet-report-${dateKey(query.from)}-to-${dateKey(query.to)}.csv"`,
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});
