import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  AttendanceType,
  EmploymentStatus,
  EmploymentType,
  LeaveRequestStatus,
  UserRole,
} from '#prisma';
import {
  createTestApp,
  createUser,
  loginForToken,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

const todayStart = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();
const todayEnd = (() => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
})();

async function seedEmployee(role: UserRole, email: string) {
  const department = await prisma.department.create({ data: { name: 'Operations' } });
  const position = await prisma.position.create({
    data: { name: 'Ops', grade: 'L3', department_id: department.id },
  });
  const employee = await prisma.employee.create({
    data: {
      employee_no: 'EMP-2026-0001',
      first_name: 'Casey',
      last_name: 'Work',
      email,
      department_id: department.id,
      position_id: position.id,
      hire_date: new Date('2024-01-15'),
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
    },
  });
  const user = await createUser({ role, email, employeeId: employee.id });
  return { employee, user };
}

describe('attendance clock-in/out integration', () => {
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

  it('clocks in and out, creating both records', async () => {
    const { employee, user } = await seedEmployee(UserRole.EMPLOYEE, 'casey@example.com');
    const token = await loginForToken(app, user.email, user.password);

    const inRes = await request(app)
      .post('/api/attendance/clock')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: AttendanceType.IN });
    expect(inRes.status).toBe(201);
    expect(inRes.body).toMatchObject({ duplicateWarning: false, missingClockInFlag: false });

    const outRes = await request(app)
      .post('/api/attendance/clock')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: AttendanceType.OUT });
    expect(outRes.status).toBe(201);

    const records = await prisma.attendanceRecord.findMany({
      where: { employee_id: employee.id, timestamp: { gte: todayStart, lte: todayEnd } },
    });
    expect(records.map((r) => r.type).sort()).toEqual([AttendanceType.IN, AttendanceType.OUT]);
  });

  it('rejects a duplicate clock-in with 400', async () => {
    const { user } = await seedEmployee(UserRole.EMPLOYEE, 'casey@example.com');
    const token = await loginForToken(app, user.email, user.password);

    await request(app)
      .post('/api/attendance/clock')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: AttendanceType.IN })
      .expect(201);

    const dup = await request(app)
      .post('/api/attendance/clock')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: AttendanceType.IN });
    expect(dup.status).toBe(400);
  });

  it('blocks clock-in while the employee is on approved leave', async () => {
    const { employee, user } = await seedEmployee(UserRole.EMPLOYEE, 'casey@example.com');
    const token = await loginForToken(app, user.email, user.password);

    // Seed an approved leave request covering today.
    await prisma.leaveRequest.create({
      data: {
        employee_id: employee.id,
        leave_type_id: (
          await prisma.leaveType.create({
            data: { name: 'Annual', accrual_rate: 0, carry_forward_policy: 'none' },
          })
        ).id,
        status: LeaveRequestStatus.APPROVED,
        start_date: new Date(todayStart.getTime() - 86400000),
        end_date: new Date(todayEnd.getTime() + 86400000),
        days: 1,
        reason: 'Vacation',
        submitted_by: user.id,
      },
    });

    const res = await request(app)
      .post('/api/attendance/clock')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: AttendanceType.IN });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toMatch(/approved leave/i);
  });

  it('auto-creates a missing clock-in when clocking out first (missingClockInFlag)', async () => {
    const { employee, user } = await seedEmployee(UserRole.EMPLOYEE, 'casey@example.com');
    const token = await loginForToken(app, user.email, user.password);

    // Clock OUT with no prior IN -> synthetic 09:00 IN + flag.
    const outRes = await request(app)
      .post('/api/attendance/clock')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: AttendanceType.OUT });
    expect(outRes.status).toBe(201);
    expect(outRes.body).toMatchObject({ missingClockInFlag: true });

    const records = await prisma.attendanceRecord.findMany({
      where: { employee_id: employee.id, timestamp: { gte: todayStart, lte: todayEnd } },
    });
    expect(records).toHaveLength(2);
    expect(records.some((r) => r.type === AttendanceType.IN)).toBe(true);
  });

  it('marks the summary HOLIDAY when today is a holiday, overriding ABSENT', async () => {
    const { user } = await seedEmployee(UserRole.EMPLOYEE, 'casey@example.com');
    const token = await loginForToken(app, user.email, user.password);

    await prisma.holiday.create({
      data: { name: 'Test Holiday', date: new Date(), year: new Date().getFullYear() },
    });

    const summary = await request(app)
      .get('/api/attendance/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(summary.status).toBe(200);
    expect(summary.body.summaries).toHaveLength(1);
    expect(summary.body.summaries[0]).toMatchObject({ status: 'HOLIDAY' });
  });
});
