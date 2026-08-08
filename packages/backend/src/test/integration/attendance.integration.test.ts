import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { EmploymentType, LeaveRequestStatus, UserRole } from '#prisma';
import {
  createTestApp,
  createUser,
  loginForToken,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Seeds an org structure plus a manager/employee hierarchy where the employee
 * reports to the manager. Both accounts are linked to their employee records so
 * `user.employeeId` is resolved by the middleware.
 */
async function seedHierarchy() {
  const department = await prisma.department.create({
    data: { name: 'Marketing', description: 'Marketing team' },
  });
  const position = await prisma.position.create({
    data: { name: 'Marketing Lead', grade: 'L5', department_id: department.id },
  });
  const empPosition = await prisma.position.create({
    data: { name: 'Marketing Exec', grade: 'L2', department_id: department.id },
  });

  const managerEmp = await prisma.employee.create({
    data: {
      employee_no: 'EMP-2026-0001',
      first_name: 'Manny',
      last_name: 'Manager',
      email: 'manager@example.com',
      department_id: department.id,
      position_id: position.id,
      hire_date: new Date('2022-01-15'),
      employment_type: EmploymentType.FULL_TIME,
      status: 'ACTIVE',
    },
  });
  const employeeEmp = await prisma.employee.create({
    data: {
      employee_no: 'EMP-2026-0002',
      first_name: 'Eve',
      last_name: 'Employee',
      email: 'employee@example.com',
      department_id: department.id,
      position_id: empPosition.id,
      manager_id: managerEmp.id,
      hire_date: new Date('2024-01-15'),
      employment_type: EmploymentType.FULL_TIME,
      status: 'ACTIVE',
    },
  });

  const managerUser = await createUser({
    role: UserRole.MANAGER,
    email: 'manager@example.com',
    employeeId: managerEmp.id,
  });
  const employeeUser = await createUser({
    role: UserRole.EMPLOYEE,
    email: 'employee@example.com',
    employeeId: employeeEmp.id,
  });

  return { department, employeeEmp, managerEmp, managerUser, employeeUser };
}

/**
 * Creates a leave type (unless one is supplied) and provisions an entitlement
 * for the employee via a policy group assignment.
 */
async function seedLeaveTypeAndEntitlement(
  app: Express,
  hrToken: string,
  opts: {
    employeeId: string;
    annualDays?: number;
    approvalLevels?: number;
    leaveTypeId?: string;
  },
) {
  let leaveTypeId = opts.leaveTypeId;
  if (!leaveTypeId) {
    const leaveType = await request(app)
      .post('/api/attendance/leave-types')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Annual Leave',
        accrualRate: 0,
        carryForwardPolicy: 'none',
        approvalLevels: opts.approvalLevels ?? 2,
        autoApproveSickDays: 0,
      });
    expect(leaveType.status).toBe(201);
    leaveTypeId = (leaveType.body as { id: string }).id;
  }

  const group = await request(app)
    .post('/api/attendance/policy-groups')
    .set('Authorization', `Bearer ${hrToken}`)
    .send({
      name: `Annual ${CURRENT_YEAR}`,
      year: CURRENT_YEAR,
      proration_enabled: false,
      entitlements: [{ leave_type_id: leaveTypeId, annual_days: opts.annualDays ?? 10 }],
    });
  expect(group.status).toBe(201);
  const groupId = (group.body as { id: string }).id;

  const assignment = await request(app)
    .put('/api/attendance/employee-assignments')
    .set('Authorization', `Bearer ${hrToken}`)
    .send({ employeeId: opts.employeeId, policyGroupId: groupId, year: CURRENT_YEAR });
  expect(assignment.status).toBe(200);

  return { leaveTypeId, groupId };
}

describe('attendance integration — leave approval workflow', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDb();
  });

  describe('two-level approval with balance deduction', () => {
    it('approves at manager then HR level, deducting the balance once', async () => {
      const { employeeEmp, managerUser, employeeUser } = await seedHierarchy();

      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);
      const { leaveTypeId } = await seedLeaveTypeAndEntitlement(app, hrToken, {
        employeeId: employeeEmp.id,
        annualDays: 10,
        approvalLevels: 2,
      });

      const empToken = await loginForToken(app, employeeUser.email, employeeUser.password);
      const mgrToken = await loginForToken(app, managerUser.email, managerUser.password);

      // Employee submits a 3-day leave request.
      const submitted = await request(app)
        .post('/api/attendance/leave-requests')
        .set('Authorization', `Bearer ${empToken}`)
        .send({
          leaveTypeId,
          startDate: '2026-08-10',
          endDate: '2026-08-12',
          reason: 'Vacation',
        });
      expect(submitted.status).toBe(201);
      const requestId = (submitted.body as { request: { id: string } }).request.id;

      const stored1 = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
      expect(stored1?.status).toBe(LeaveRequestStatus.PENDING_MANAGER_APPROVAL);
      expect(stored1?.days).toBe(3);

      // Manager approves level 1 -> pending HR.
      const mgrApprove = await request(app)
        .post(`/api/attendance/leave-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({ comment: 'Approved' });
      expect(mgrApprove.status).toBe(200);

      const stored2 = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
      expect(stored2?.status).toBe(LeaveRequestStatus.PENDING_HR_APPROVAL);

      // HR approves level 2 -> approved + balance deducted.
      const hrApprove = await request(app)
        .post(`/api/attendance/leave-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ comment: 'Final' });
      expect(hrApprove.status).toBe(200);

      const stored3 = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
      expect(stored3?.status).toBe(LeaveRequestStatus.APPROVED);

      const approvals = await prisma.leaveApproval.findMany({
        where: { leave_request_id: requestId },
        orderBy: { level: 'asc' },
      });
      expect(approvals.map((a) => a.level)).toEqual([1, 2]);
      expect(approvals.every((a) => a.action === 'APPROVE')).toBe(true);

      // Balance: entitlement 10, used 3.
      const balance = await prisma.leaveBalance.findFirst({
        where: { employee_id: employeeEmp.id, leave_type_id: leaveTypeId },
      });
      expect(balance?.used_days).toBe(3);

      // Balance API reflects available = 10 - 3 = 7.
      const balances = await request(app)
        .get('/api/attendance/leave-balance')
        .set('Authorization', `Bearer ${empToken}`);
      expect(balances.status).toBe(200);
      const mine = (
        balances.body as { balances: Array<{ employeeId: string; balances: unknown[] }> }
      ).balances.find((b) => b.employeeId === employeeEmp.id);
      const annual = (
        mine?.balances as Array<{ name: string; available: number }> | undefined
      )?.find((b) => b.name === 'Annual Leave');
      expect(annual?.available).toBe(7);
    });

    it('rejects approval by a non-manager at level 1', async () => {
      const { employeeEmp, employeeUser } = await seedHierarchy();

      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);
      const { leaveTypeId } = await seedLeaveTypeAndEntitlement(app, hrToken, {
        employeeId: employeeEmp.id,
        annualDays: 10,
        approvalLevels: 2,
      });

      const empToken = await loginForToken(app, employeeUser.email, employeeUser.password);

      const submitted = await request(app)
        .post('/api/attendance/leave-requests')
        .set('Authorization', `Bearer ${empToken}`)
        .send({ leaveTypeId, startDate: '2026-08-10', endDate: '2026-08-12' });
      const requestId = (submitted.body as { request: { id: string } }).request.id;

      // An unrelated employee tries to approve -> 403.
      const stranger = await createUser({ role: UserRole.EMPLOYEE, email: 'stranger@example.com' });
      const strangerToken = await loginForToken(app, stranger.email, stranger.password);

      const approve = await request(app)
        .post(`/api/attendance/leave-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ comment: 'not yours' });
      expect(approve.status).toBe(403);

      const stored = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
      expect(stored?.status).toBe(LeaveRequestStatus.PENDING_MANAGER_APPROVAL);
    });

    it('rejects approval that would exceed the available balance', async () => {
      const { employeeEmp, managerUser, employeeUser } = await seedHierarchy();

      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);
      // Only 2 days of entitlement.
      const { leaveTypeId } = await seedLeaveTypeAndEntitlement(app, hrToken, {
        employeeId: employeeEmp.id,
        annualDays: 2,
        approvalLevels: 2,
      });

      const empToken = await loginForToken(app, employeeUser.email, employeeUser.password);
      const mgrToken = await loginForToken(app, managerUser.email, managerUser.password);

      // Submit a 3-day request.
      const submitted = await request(app)
        .post('/api/attendance/leave-requests')
        .set('Authorization', `Bearer ${empToken}`)
        .send({ leaveTypeId, startDate: '2026-08-10', endDate: '2026-08-12' });
      const requestId = (submitted.body as { request: { id: string } }).request.id;

      // Manager level 1 succeeds (2-level flow does not deduct at this stage).
      await request(app)
        .post(`/api/attendance/leave-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({ comment: 'Approved' })
        .expect(200);

      // HR final approval exceeds the 2-day balance -> 400.
      const hrApprove = await request(app)
        .post(`/api/attendance/leave-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ comment: 'Final' });
      expect(hrApprove.status).toBe(400);

      // The transaction rolled back: the request stays pending HR and balance is untouched.
      const stored = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
      expect(stored?.status).toBe(LeaveRequestStatus.PENDING_HR_APPROVAL);
      const balance = await prisma.leaveBalance.findFirst({
        where: { employee_id: employeeEmp.id, leave_type_id: leaveTypeId },
      });
      expect(balance?.used_days ?? 0).toBe(0);
    });

    it('auto-approves an urgent sick leave (1-2 days) without HR', async () => {
      const { employeeEmp, employeeUser } = await seedHierarchy();

      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);

      // Sick leave type with auto-approve for 1-2 days, single approval level.
      const leaveType = await request(app)
        .post('/api/attendance/leave-types')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          name: 'Sick Leave',
          accrualRate: 0,
          carryForwardPolicy: 'none',
          approvalLevels: 1,
          autoApproveSickDays: 2,
        });
      const sickLeaveTypeId = (leaveType.body as { id: string }).id;
      await seedLeaveTypeAndEntitlement(app, hrToken, {
        employeeId: employeeEmp.id,
        annualDays: 5,
        approvalLevels: 1,
        leaveTypeId: sickLeaveTypeId,
      });

      const empToken = await loginForToken(app, employeeUser.email, employeeUser.password);

      // 1-day sick leave request.
      const submitted = await request(app)
        .post('/api/attendance/leave-requests')
        .set('Authorization', `Bearer ${empToken}`)
        .send({ leaveTypeId: sickLeaveTypeId, startDate: '2026-08-10', endDate: '2026-08-10' });
      expect(submitted.status).toBe(201);
      const requestId = (submitted.body as { request: { id: string } }).request.id;

      // Approve (auto-approve path): no comment so the auto-approve comment is recorded.
      const approve = await request(app)
        .post(`/api/attendance/leave-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({});
      expect(approve.status).toBe(200);

      const stored = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
      expect(stored?.status).toBe(LeaveRequestStatus.APPROVED);

      const approval = await prisma.leaveApproval.findFirst({
        where: { leave_request_id: requestId },
      });
      expect(approval?.comment).toContain('Auto-approved');
    });
  });
});
