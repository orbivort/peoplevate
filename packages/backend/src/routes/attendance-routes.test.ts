import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const authUser: {
  userId: string;
  email: string;
  role: string;
  employeeId: string | null;
} = { userId: 'u-1', email: 'jane@example.com', role: 'HR_MANAGER', employeeId: 'emp-1' };

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = authUser;
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireHR: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  requireAllStaff: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../services/attendance-service.js', () => ({
  clockInOut: vi.fn(),
  getDailySummaries: vi.fn(),
  listLeaveTypes: vi.fn(),
  createLeaveType: vi.fn(),
  updateLeaveType: vi.fn(),
  listPolicyGroups: vi.fn(),
  createPolicyGroup: vi.fn(),
  updatePolicyGroup: vi.fn(),
  deletePolicyGroup: vi.fn(),
  listEmployeeAssignments: vi.fn(),
  setEmployeeAssignment: vi.fn(),
  listHolidays: vi.fn(),
  upsertHoliday: vi.fn(),
  deleteHoliday: vi.fn(),
  submitLeaveRequest: vi.fn(),
  listLeaveRequests: vi.fn(),
  approveLeaveRequest: vi.fn(),
  rejectLeaveRequest: vi.fn(),
  getLeaveBalance: vi.fn(),
}));

import * as attendance from '../services/attendance-service.js';
import { attendanceRoutes } from './attendance-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  clockInOut: vi.mocked(attendance.clockInOut),
  getDailySummaries: vi.mocked(attendance.getDailySummaries),
  listLeaveTypes: vi.mocked(attendance.listLeaveTypes),
  createLeaveType: vi.mocked(attendance.createLeaveType),
  updateLeaveType: vi.mocked(attendance.updateLeaveType),
  listPolicyGroups: vi.mocked(attendance.listPolicyGroups),
  createPolicyGroup: vi.mocked(attendance.createPolicyGroup),
  updatePolicyGroup: vi.mocked(attendance.updatePolicyGroup),
  deletePolicyGroup: vi.mocked(attendance.deletePolicyGroup),
  listEmployeeAssignments: vi.mocked(attendance.listEmployeeAssignments),
  setEmployeeAssignment: vi.mocked(attendance.setEmployeeAssignment),
  listHolidays: vi.mocked(attendance.listHolidays),
  upsertHoliday: vi.mocked(attendance.upsertHoliday),
  deleteHoliday: vi.mocked(attendance.deleteHoliday),
  submitLeaveRequest: vi.mocked(attendance.submitLeaveRequest),
  listLeaveRequests: vi.mocked(attendance.listLeaveRequests),
  approveLeaveRequest: vi.mocked(attendance.approveLeaveRequest),
  rejectLeaveRequest: vi.mocked(attendance.rejectLeaveRequest),
  getLeaveBalance: vi.mocked(attendance.getLeaveBalance),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRoutes);
  app.use(errorHandler);
  return app;
}

describe('attendance-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.role = 'HR_MANAGER';
    authUser.employeeId = 'emp-1';
    mocked.clockInOut.mockResolvedValue({ id: 'att-1' } as never);
    mocked.getDailySummaries.mockResolvedValue([] as never);
    mocked.listLeaveTypes.mockResolvedValue([] as never);
    mocked.createLeaveType.mockResolvedValue({ id: 'lt-1' } as never);
    mocked.updateLeaveType.mockResolvedValue({ id: 'lt-1' } as never);
    mocked.listPolicyGroups.mockResolvedValue([] as never);
    mocked.createPolicyGroup.mockResolvedValue({ id: 'pg-1' } as never);
    mocked.updatePolicyGroup.mockResolvedValue({ id: 'pg-1' } as never);
    mocked.deletePolicyGroup.mockResolvedValue({ id: 'pg-1' } as never);
    mocked.listEmployeeAssignments.mockResolvedValue([] as never);
    mocked.setEmployeeAssignment.mockResolvedValue({ id: 'asg-1' } as never);
    mocked.listHolidays.mockResolvedValue([] as never);
    mocked.upsertHoliday.mockResolvedValue({ id: 'hol-1' } as never);
    mocked.deleteHoliday.mockResolvedValue({ id: 'hol-1' } as never);
    mocked.submitLeaveRequest.mockResolvedValue({ id: 'lr-1' } as never);
    mocked.listLeaveRequests.mockResolvedValue([] as never);
    mocked.approveLeaveRequest.mockResolvedValue({ id: 'lr-1' } as never);
    mocked.rejectLeaveRequest.mockResolvedValue({ id: 'lr-1' } as never);
    mocked.getLeaveBalance.mockResolvedValue([] as never);
  });

  describe('POST /api/attendance/clock', () => {
    it('records a clock event for the linked employee', async () => {
      const res = await request(buildApp()).post('/api/attendance/clock').send({ type: 'IN' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'att-1' });
      const arg = mocked.clockInOut.mock.calls[0]?.[0] as {
        employeeId: string;
        type: string;
        actorId: string;
      };
      expect(arg.employeeId).toBe('emp-1');
      expect(arg.type).toBe('IN');
      expect(arg.actorId).toBe('u-1');
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.employeeId = null;

      const res = await request(buildApp()).post('/api/attendance/clock').send({ type: 'IN' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No employee profile linked to your account' });
      expect(mocked.clockInOut).not.toHaveBeenCalled();
    });

    it('returns 400 on an invalid attendance type', async () => {
      const res = await request(buildApp())
        .post('/api/attendance/clock')
        .send({ type: 'NOT_A_TYPE' });

      expect(res.status).toBe(400);
      expect(mocked.clockInOut).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.clockInOut.mockRejectedValue(
        Object.assign(new Error('Already clocked in'), { status: 409 }),
      );

      const res = await request(buildApp()).post('/api/attendance/clock').send({ type: 'IN' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Already clocked in');
    });
  });

  describe('GET /api/attendance/summary', () => {
    it('returns daily summaries scoped by role', async () => {
      mocked.getDailySummaries.mockResolvedValue([{ date: '2026-08-05' }] as never);

      const res = await request(buildApp()).get(
        '/api/attendance/summary?employeeId=emp-2&date=2026-08-05',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ summaries: [{ date: '2026-08-05' }] });
      expect(mocked.getDailySummaries).toHaveBeenCalledWith({
        employeeId: 'emp-2',
        date: '2026-08-05',
        role: 'HR_MANAGER',
        userId: 'u-1',
      });
    });

    it('passes undefined filters when query params are absent', async () => {
      await request(buildApp()).get('/api/attendance/summary');

      expect(mocked.getDailySummaries).toHaveBeenCalledWith({
        employeeId: undefined,
        date: undefined,
        role: 'HR_MANAGER',
        userId: 'u-1',
      });
    });
  });

  describe('GET /api/attendance/leave-types', () => {
    it('lists leave types', async () => {
      mocked.listLeaveTypes.mockResolvedValue([{ id: 'lt-1' }] as never);

      const res = await request(buildApp()).get('/api/attendance/leave-types');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ leaveTypes: [{ id: 'lt-1' }] });
    });
  });

  describe('POST /api/attendance/leave-types', () => {
    it('creates a leave type with defaults applied', async () => {
      const res = await request(buildApp())
        .post('/api/attendance/leave-types')
        .send({ name: 'Annual Leave' });

      expect(res.status).toBe(201);
      expect(mocked.createLeaveType).toHaveBeenCalledWith({
        name: 'Annual Leave',
        accrualRate: 0,
        carryForwardPolicy: 'none',
        approvalLevels: 1,
        autoApproveSickDays: 0,
      });
    });

    it('returns 400 when the name is empty', async () => {
      const res = await request(buildApp()).post('/api/attendance/leave-types').send({ name: '' });

      expect(res.status).toBe(400);
      expect(mocked.createLeaveType).not.toHaveBeenCalled();
    });

    it('returns 400 when approvalLevels is out of range', async () => {
      const res = await request(buildApp())
        .post('/api/attendance/leave-types')
        .send({ name: 'Annual Leave', approvalLevels: 5 });

      expect(res.status).toBe(400);
      expect(mocked.createLeaveType).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/attendance/leave-types/:id', () => {
    it('updates a leave type with a partial payload', async () => {
      const res = await request(buildApp())
        .put('/api/attendance/leave-types/lt-1')
        .send({ accrualRate: 1.5 });

      expect(res.status).toBe(200);
      expect(mocked.updateLeaveType).toHaveBeenCalledWith(
        'lt-1',
        expect.objectContaining({ accrualRate: 1.5 }),
      );
    });

    it('forwards service errors', async () => {
      mocked.updateLeaveType.mockRejectedValue(
        Object.assign(new Error('Leave type not found'), { status: 404 }),
      );

      const res = await request(buildApp())
        .put('/api/attendance/leave-types/lt-1')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Leave type not found');
    });
  });

  describe('GET /api/attendance/policy-groups', () => {
    it('lists policy groups for a year', async () => {
      mocked.listPolicyGroups.mockResolvedValue([{ id: 'pg-1' }] as never);

      const res = await request(buildApp()).get('/api/attendance/policy-groups?year=2026');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ policyGroups: [{ id: 'pg-1' }] });
      expect(mocked.listPolicyGroups).toHaveBeenCalledWith({ year: 2026 });
    });

    it('passes undefined year when the query param is absent', async () => {
      await request(buildApp()).get('/api/attendance/policy-groups');

      expect(mocked.listPolicyGroups).toHaveBeenCalledWith({ year: undefined });
    });
  });

  describe('POST /api/attendance/policy-groups', () => {
    it('creates a policy group', async () => {
      const res = await request(buildApp())
        .post('/api/attendance/policy-groups')
        .send({
          name: 'Standard',
          year: 2026,
          entitlements: [{ leave_type_id: 'lt-1', annual_days: 15 }],
        });

      expect(res.status).toBe(201);
      const arg = mocked.createPolicyGroup.mock.calls[0]?.[0] as {
        name: string;
        year: number;
        proration_enabled: boolean;
      };
      expect(arg.name).toBe('Standard');
      expect(arg.year).toBe(2026);
      expect(arg.proration_enabled).toBe(true);
    });

    it('returns 400 when entitlements are missing', async () => {
      const res = await request(buildApp())
        .post('/api/attendance/policy-groups')
        .send({ name: 'Standard', year: 2026 });

      expect(res.status).toBe(400);
      expect(mocked.createPolicyGroup).not.toHaveBeenCalled();
    });

    it('forwards conflict errors', async () => {
      mocked.createPolicyGroup.mockRejectedValue(
        Object.assign(new Error('A policy group with this name already exists for the year'), {
          status: 409,
        }),
      );

      const res = await request(buildApp())
        .post('/api/attendance/policy-groups')
        .send({ name: 'Standard', year: 2026, entitlements: [] });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('A policy group with this name already exists for the year');
    });
  });

  describe('PUT /api/attendance/policy-groups/:id', () => {
    it('updates a policy group with a partial payload', async () => {
      const res = await request(buildApp())
        .put('/api/attendance/policy-groups/pg-1')
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(mocked.updatePolicyGroup).toHaveBeenCalledWith(
        'pg-1',
        expect.objectContaining({ name: 'Updated' }),
      );
    });
  });

  describe('DELETE /api/attendance/policy-groups/:id', () => {
    it('deletes a policy group', async () => {
      const res = await request(buildApp()).delete('/api/attendance/policy-groups/pg-1');

      expect(res.status).toBe(200);
      expect(mocked.deletePolicyGroup).toHaveBeenCalledWith('pg-1');
    });
  });

  describe('GET /api/attendance/employee-assignments', () => {
    it('lists assignments for the requested year', async () => {
      await request(buildApp()).get('/api/attendance/employee-assignments?year=2025');

      expect(mocked.listEmployeeAssignments).toHaveBeenCalledWith({ year: 2025 });
    });

    it('defaults to the current year', async () => {
      await request(buildApp()).get('/api/attendance/employee-assignments');

      expect(mocked.listEmployeeAssignments).toHaveBeenCalledWith({
        year: new Date().getFullYear(),
      });
    });
  });

  describe('PUT /api/attendance/employee-assignments', () => {
    it('sets an employee policy assignment', async () => {
      const res = await request(buildApp())
        .put('/api/attendance/employee-assignments')
        .send({ employeeId: 'emp-2', policyGroupId: 'pg-1', year: 2026 });

      expect(res.status).toBe(200);
      expect(mocked.setEmployeeAssignment).toHaveBeenCalledWith({
        employeeId: 'emp-2',
        policyGroupId: 'pg-1',
        year: 2026,
        assignedBy: 'u-1',
        actorId: 'u-1',
        actorName: 'jane@example.com',
      });
    });

    it('returns 400 when the employee id is missing', async () => {
      const res = await request(buildApp())
        .put('/api/attendance/employee-assignments')
        .send({ policyGroupId: 'pg-1', year: 2026 });

      expect(res.status).toBe(400);
      expect(mocked.setEmployeeAssignment).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/attendance/holidays', () => {
    it('lists holidays for a year', async () => {
      mocked.listHolidays.mockResolvedValue([{ id: 'hol-1' }] as never);

      const res = await request(buildApp()).get('/api/attendance/holidays?year=2026');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ holidays: [{ id: 'hol-1' }] });
      expect(mocked.listHolidays).toHaveBeenCalledWith({ year: 2026 });
    });
  });

  describe('PUT /api/attendance/holidays', () => {
    it('upserts a holiday with defaults applied', async () => {
      const res = await request(buildApp())
        .put('/api/attendance/holidays')
        .send({ name: 'New Year', date: '2026-01-01', year: 2026 });

      expect(res.status).toBe(200);
      const arg = mocked.upsertHoliday.mock.calls[0]?.[0] as {
        name: string;
        type: string;
        recurring: boolean;
      };
      expect(arg.name).toBe('New Year');
      expect(arg.type).toBe('STATUTORY');
      expect(arg.recurring).toBe(false);
    });

    it('returns 400 when the date is missing', async () => {
      const res = await request(buildApp())
        .put('/api/attendance/holidays')
        .send({ name: 'New Year', year: 2026 });

      expect(res.status).toBe(400);
      expect(mocked.upsertHoliday).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/attendance/holidays/:id', () => {
    it('deletes a holiday', async () => {
      const res = await request(buildApp()).delete('/api/attendance/holidays/hol-1');

      expect(res.status).toBe(200);
      expect(mocked.deleteHoliday).toHaveBeenCalledWith('hol-1');
    });
  });

  describe('POST /api/attendance/leave-requests', () => {
    it('submits a leave request for the linked employee', async () => {
      const res = await request(buildApp()).post('/api/attendance/leave-requests').send({
        leaveTypeId: 'lt-1',
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        reason: 'Vacation',
      });

      expect(res.status).toBe(201);
      const arg = mocked.submitLeaveRequest.mock.calls[0]?.[0] as {
        employeeId: string;
        leaveTypeId: string;
        submittedBy: string;
      };
      expect(arg.employeeId).toBe('emp-1');
      expect(arg.leaveTypeId).toBe('lt-1');
      expect(arg.submittedBy).toBe('u-1');
    });

    it('returns 400 when the account has no linked employee profile', async () => {
      authUser.employeeId = null;

      const res = await request(buildApp()).post('/api/attendance/leave-requests').send({
        leaveTypeId: 'lt-1',
        startDate: '2026-09-01',
        endDate: '2026-09-03',
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No employee profile linked to your account' });
      expect(mocked.submitLeaveRequest).not.toHaveBeenCalled();
    });

    it('returns 400 when the leave type is missing', async () => {
      const res = await request(buildApp())
        .post('/api/attendance/leave-requests')
        .send({ startDate: '2026-09-01', endDate: '2026-09-03' });

      expect(res.status).toBe(400);
      expect(mocked.submitLeaveRequest).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.submitLeaveRequest.mockRejectedValue(
        Object.assign(new Error('Insufficient leave balance'), { status: 400 }),
      );

      const res = await request(buildApp()).post('/api/attendance/leave-requests').send({
        leaveTypeId: 'lt-1',
        startDate: '2026-09-01',
        endDate: '2026-09-03',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Insufficient leave balance');
    });
  });

  describe('GET /api/attendance/leave-requests', () => {
    it('lists leave requests scoped by role', async () => {
      mocked.listLeaveRequests.mockResolvedValue([{ id: 'lr-1' }] as never);

      const res = await request(buildApp()).get(
        '/api/attendance/leave-requests?employeeId=emp-2&status=PENDING',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ requests: [{ id: 'lr-1' }] });
      expect(mocked.listLeaveRequests).toHaveBeenCalledWith({
        employeeId: 'emp-2',
        status: 'PENDING',
        role: 'HR_MANAGER',
        userId: 'u-1',
      });
    });
  });

  describe('POST /api/attendance/leave-requests/:id/approve', () => {
    it('approves a leave request', async () => {
      const res = await request(buildApp())
        .post('/api/attendance/leave-requests/lr-1/approve')
        .send({ comment: 'Approved' });

      expect(res.status).toBe(200);
      expect(mocked.approveLeaveRequest).toHaveBeenCalledWith({
        leaveRequestId: 'lr-1',
        approverId: 'u-1',
        approverRole: 'HR_MANAGER',
        comment: 'Approved',
      });
    });

    it('forwards permission errors', async () => {
      mocked.approveLeaveRequest.mockRejectedValue(
        Object.assign(new Error('You are not authorised to approve this request'), { status: 403 }),
      );

      const res = await request(buildApp())
        .post('/api/attendance/leave-requests/lr-1/approve')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('You are not authorised to approve this request');
    });
  });

  describe('POST /api/attendance/leave-requests/:id/reject', () => {
    it('rejects a leave request', async () => {
      const res = await request(buildApp())
        .post('/api/attendance/leave-requests/lr-1/reject')
        .send({ comment: 'Not enough coverage' });

      expect(res.status).toBe(200);
      expect(mocked.rejectLeaveRequest).toHaveBeenCalledWith({
        leaveRequestId: 'lr-1',
        approverId: 'u-1',
        approverRole: 'HR_MANAGER',
        comment: 'Not enough coverage',
      });
    });
  });

  describe('GET /api/attendance/leave-balance', () => {
    it('returns leave balances scoped by role', async () => {
      mocked.getLeaveBalance.mockResolvedValue([{ leaveTypeId: 'lt-1' }] as never);

      const res = await request(buildApp()).get('/api/attendance/leave-balance?employeeId=emp-2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ balances: [{ leaveTypeId: 'lt-1' }] });
      expect(mocked.getLeaveBalance).toHaveBeenCalledWith({
        employeeId: 'emp-2',
        role: 'HR_MANAGER',
        userId: 'u-1',
      });
    });

    it('forwards permission errors', async () => {
      mocked.getLeaveBalance.mockRejectedValue(
        Object.assign(new Error('Access denied'), { status: 403 }),
      );

      const res = await request(buildApp()).get('/api/attendance/leave-balance?employeeId=emp-2');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });
  });
});
