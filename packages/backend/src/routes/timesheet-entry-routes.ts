import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import * as timesheets from '../services/timesheet-service.js';

export const timesheetEntryRoutes: Router = Router();
timesheetEntryRoutes.use(authenticate);

// ── Schemas ─────────────────────────────────────
// Hour increments (multiples of 0.25), the 24h cap, the current/previous-week
// window, and project/task validity are enforced by the service layer.

const createEntrySchema = z.object({
  // Accepted for contract compatibility; the target timesheet is always
  // derived from entryDate (get-or-create), so the value is not forwarded.
  timesheetId: z.uuid().optional(),
  entryDate: z.coerce.date(),
  projectId: z.uuid(),
  taskId: z.uuid().nullable().optional(),
  hours: z.coerce.number(),
  description: z.string().max(500).nullable().optional(),
});

const updateEntrySchema = z.object({
  entryDate: z.coerce.date().optional(),
  projectId: z.uuid().optional(),
  taskId: z.uuid().nullable().optional(),
  hours: z.coerce.number().optional(),
  description: z.string().max(500).nullable().optional(),
});

// ── Routes ──────────────────────────────────────

timesheetEntryRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createEntrySchema.parse(req.body);
    const user = getAuthUser(req)!;
    if (!user.employeeId) {
      res.status(400).json({ error: 'No employee profile linked to your account' });
      return;
    }
    const timesheet = await timesheets.createTimesheetEntry({
      employeeId: user.employeeId,
      entryDate: data.entryDate,
      projectId: data.projectId,
      taskId: data.taskId ?? undefined,
      hours: data.hours,
      description: data.description ?? undefined,
      actorId: user.userId,
      actorName: user.email,
    });
    res.status(201).json({ timesheet });
  } catch (err) {
    next(err);
  }
});

timesheetEntryRoutes.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = updateEntrySchema.parse(req.body);
    const user = getAuthUser(req)!;
    if (!user.employeeId) {
      res.status(400).json({ error: 'No employee profile linked to your account' });
      return;
    }
    const timesheet = await timesheets.updateTimesheetEntry({
      entryId: String(req.params.id),
      employeeId: user.employeeId,
      entryDate: data.entryDate,
      projectId: data.projectId,
      taskId: data.taskId,
      hours: data.hours,
      description: data.description,
      actorId: user.userId,
      actorName: user.email,
    });
    res.json({ timesheet });
  } catch (err) {
    next(err);
  }
});

timesheetEntryRoutes.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    if (!user.employeeId) {
      res.status(400).json({ error: 'No employee profile linked to your account' });
      return;
    }
    const timesheet = await timesheets.deleteTimesheetEntry({
      entryId: String(req.params.id),
      employeeId: user.employeeId,
      actorId: user.userId,
      actorName: user.email,
    });
    res.json({ timesheet });
  } catch (err) {
    next(err);
  }
});
