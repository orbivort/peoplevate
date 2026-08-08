import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AttendanceType } from '#prisma';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireHR, requireAllStaff } from '../middleware/rbac.js';
import * as attendance from '../services/attendance-service.js';

export const attendanceRoutes: Router = Router();
attendanceRoutes.use(authenticate);

// ── Clock in / out ─────────────────────────────

const clockSchema = z.object({
  type: z.nativeEnum(AttendanceType),
});

attendanceRoutes.post('/clock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = clockSchema.parse(req.body);
    const user = getAuthUser(req)!;
    if (!user.employeeId) {
      res.status(400).json({ error: 'No employee profile linked to your account' });
      return;
    }
    const result = await attendance.clockInOut({
      employeeId: user.employeeId,
      type: data.type,
      ipAddress: req.ip,
      actorId: user.userId,
      actorName: user.email,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ── Daily summary ──────────────────────────────

attendanceRoutes.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const summaries = await attendance.getDailySummaries({
      employeeId: typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined,
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
      role: user.role,
      userId: user.userId,
    });
    res.json({ summaries });
  } catch (err) {
    next(err);
  }
});

// ── Leave types ────────────────────────────────

attendanceRoutes.get('/leave-types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ leaveTypes: await attendance.listLeaveTypes() });
  } catch (err) {
    next(err);
  }
});

const createLeaveTypeSchema = z.object({
  name: z.string().min(1),
  accrualRate: z.coerce.number().min(0).default(0),
  carryForwardPolicy: z.string().default('none'),
  maxConsecutiveDays: z.coerce.number().int().optional(),
  approvalLevels: z.coerce.number().int().min(1).max(2).default(1),
  autoApproveSickDays: z.coerce.number().int().min(0).default(0),
});

attendanceRoutes.post(
  '/leave-types',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createLeaveTypeSchema.parse(req.body);
      res.status(201).json(await attendance.createLeaveType(data));
    } catch (err) {
      next(err);
    }
  },
);

attendanceRoutes.put(
  '/leave-types/:id',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createLeaveTypeSchema.partial().parse(req.body);
      res.json(await attendance.updateLeaveType(String(req.params.id), data));
    } catch (err) {
      next(err);
    }
  },
);

// ── Leave policy groups (replaces role-based templates) ───

attendanceRoutes.get(
  '/policy-groups',
  requireAllStaff,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const groups = await attendance.listPolicyGroups({
        year: typeof req.query.year === 'string' ? Number(req.query.year) : undefined,
      });
      res.json({ policyGroups: groups });
    } catch (err) {
      next(err);
    }
  },
);

const policyGroupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  year: z.coerce.number().int(),
  employment_type: z.string().optional(),
  grades: z.array(z.string()).optional(),
  department_id: z.string().optional(),
  proration_enabled: z.coerce.boolean().default(true),
  entitlements: z.array(
    z.object({
      leave_type_id: z.string().min(1),
      annual_days: z.coerce.number().min(0),
    }),
  ),
});

attendanceRoutes.post(
  '/policy-groups',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = policyGroupSchema.parse(req.body);
      res.status(201).json(await attendance.createPolicyGroup(data));
    } catch (err) {
      next(err);
    }
  },
);

attendanceRoutes.put(
  '/policy-groups/:id',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = policyGroupSchema.partial().parse(req.body);
      res.json(await attendance.updatePolicyGroup(String(req.params.id), data));
    } catch (err) {
      next(err);
    }
  },
);

attendanceRoutes.delete(
  '/policy-groups/:id',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await attendance.deletePolicyGroup(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

// ── Employee policy assignments ────────────────

attendanceRoutes.get(
  '/employee-assignments',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const year =
        typeof req.query.year === 'string' ? Number(req.query.year) : new Date().getFullYear();
      res.json({ assignments: await attendance.listEmployeeAssignments({ year }) });
    } catch (err) {
      next(err);
    }
  },
);

const assignmentSchema = z.object({
  employeeId: z.string().min(1),
  policyGroupId: z.string().min(1),
  year: z.coerce.number().int(),
});

attendanceRoutes.put(
  '/employee-assignments',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = assignmentSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await attendance.setEmployeeAssignment({
          employeeId: data.employeeId,
          policyGroupId: data.policyGroupId,
          year: data.year,
          assignedBy: user.userId,
          actorId: user.userId,
          actorName: user.email,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ── Holidays ───────────────────────────────────

attendanceRoutes.get(
  '/holidays',
  requireAllStaff,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const holidays = await attendance.listHolidays({
        year: typeof req.query.year === 'string' ? Number(req.query.year) : undefined,
      });
      res.json({ holidays });
    } catch (err) {
      next(err);
    }
  },
);

const holidaySchema = z.object({
  name: z.string().min(1),
  date: z.coerce.date(),
  year: z.coerce.number().int(),
  type: z.string().default('STATUTORY'),
  recurring: z.coerce.boolean().default(false),
});

attendanceRoutes.put(
  '/holidays',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = holidaySchema.parse(req.body);
      res.json(await attendance.upsertHoliday(data));
    } catch (err) {
      next(err);
    }
  },
);

attendanceRoutes.delete(
  '/holidays/:id',
  requireHR,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await attendance.deleteHoliday(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

// ── Leave requests ─────────────────────────────

const leaveRequestSchema = z.object({
  leaveTypeId: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  reason: z.string().optional(),
});

attendanceRoutes.post(
  '/leave-requests',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = leaveRequestSchema.parse(req.body);
      const user = getAuthUser(req)!;
      if (!user.employeeId) {
        res.status(400).json({ error: 'No employee profile linked to your account' });
        return;
      }
      const result = await attendance.submitLeaveRequest({
        employeeId: user.employeeId,
        ...data,
        submittedBy: user.userId,
        actorId: user.userId,
        actorName: user.email,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

attendanceRoutes.get('/leave-requests', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const requests = await attendance.listLeaveRequests({
      employeeId: typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      role: user.role,
      userId: user.userId,
    });
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

const approveSchema = z.object({
  comment: z.string().optional(),
});

attendanceRoutes.post(
  '/leave-requests/:id/approve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = approveSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await attendance.approveLeaveRequest({
          leaveRequestId: String(req.params.id),
          approverId: user.userId,
          approverRole: user.role,
          comment: data.comment,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

attendanceRoutes.post(
  '/leave-requests/:id/reject',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = approveSchema.parse(req.body);
      const user = getAuthUser(req)!;
      res.json(
        await attendance.rejectLeaveRequest({
          leaveRequestId: String(req.params.id),
          approverId: user.userId,
          approverRole: user.role,
          comment: data.comment,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ── Leave balance ──────────────────────────────

attendanceRoutes.get('/leave-balance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const balances = await attendance.getLeaveBalance({
      employeeId: typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined,
      role: user.role,
      userId: user.userId,
    });
    res.json({ balances });
  } catch (err) {
    next(err);
  }
});
