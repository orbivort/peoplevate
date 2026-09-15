import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { TimesheetStatus } from '#prisma';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHRorManager } from '../middleware/rbac.js';
import * as timesheets from '../services/timesheet-service.js';

export const timesheetRoutes: Router = Router();
timesheetRoutes.use(authenticate);

// ── Schemas ─────────────────────────────────────

const listQuerySchema = z.object({
  status: z.nativeEnum(TimesheetStatus).optional(),
  periodStart: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const currentQuerySchema = z.object({
  date: z.coerce.date().optional(),
});

const approveSchema = z.object({
  comment: z.string().max(500).optional(),
});

const rejectSchema = z.object({
  comment: z.string().min(1).max(500),
});

// ── Own timesheets ──────────────────────────────

timesheetRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    if (!user.employeeId) {
      res.status(400).json({ error: 'No employee profile linked to your account' });
      return;
    }
    const query = listQuerySchema.parse(req.query);
    // Service returns the contract wrapper { timesheets, total, page, pageSize }.
    res.json(
      await timesheets.listTimesheets({
        employeeId: user.employeeId,
        status: query.status,
        periodStart: query.periodStart,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
  } catch (err) {
    next(err);
  }
});

timesheetRoutes.get('/current', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    if (!user.employeeId) {
      res.status(400).json({ error: 'No employee profile linked to your account' });
      return;
    }
    const query = currentQuerySchema.parse(req.query);
    const timesheet = await timesheets.getCurrentTimesheet({
      employeeId: user.employeeId,
      date: query.date,
      actorId: user.userId,
      actorName: user.email,
    });
    res.json({ timesheet });
  } catch (err) {
    next(err);
  }
});

// ── Approval queue (MANAGER+; the service scopes managers to direct reports) ──

timesheetRoutes.get(
  '/pending',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      const pending = await timesheets.listPendingTimesheets({
        managerEmployeeId: user.employeeId ?? undefined,
        role: user.role,
        userId: user.userId,
      });
      res.json({ timesheets: pending });
    } catch (err) {
      next(err);
    }
  },
);

// ── Single timesheet (owner / manager-of / HR / ADMIN — enforced in service) ──

timesheetRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const timesheet = await timesheets.getTimesheetById({
      timesheetId: String(req.params.id),
      requestingUser: {
        userId: user.userId,
        role: user.role,
        ...(user.employeeId !== undefined ? { employeeId: user.employeeId } : {}),
        userName: user.email,
      },
    });
    res.json({ timesheet });
  } catch (err) {
    next(err);
  }
});

// ── Lifecycle transitions ───────────────────────

timesheetRoutes.post('/:id/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    if (!user.employeeId) {
      res.status(400).json({ error: 'No employee profile linked to your account' });
      return;
    }
    const timesheet = await timesheets.submitTimesheet({
      timesheetId: String(req.params.id),
      employeeId: user.employeeId,
      actorId: user.userId,
      actorName: user.email,
    });
    res.json({ timesheet });
  } catch (err) {
    next(err);
  }
});

timesheetRoutes.post(
  '/:id/approve',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = approveSchema.parse(req.body);
      const user = getAuthUser(req)!;
      const timesheet = await timesheets.approveTimesheet({
        timesheetId: String(req.params.id),
        approverId: user.userId,
        approverRole: user.role,
        comment: data.comment,
        actorId: user.userId,
        actorName: user.email,
      });
      res.json({ timesheet });
    } catch (err) {
      next(err);
    }
  },
);

timesheetRoutes.post(
  '/:id/reject',
  requireHRorManager,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = rejectSchema.parse(req.body);
      const user = getAuthUser(req)!;
      if (!user.employeeId) {
        res.status(400).json({ error: 'No employee profile linked to your account' });
        return;
      }
      const timesheet = await timesheets.rejectTimesheet({
        timesheetId: String(req.params.id),
        approverId: user.userId,
        approverRole: user.role,
        comment: data.comment,
        actorId: user.userId,
        actorName: user.email,
      });
      res.json({ timesheet });
    } catch (err) {
      next(err);
    }
  },
);
