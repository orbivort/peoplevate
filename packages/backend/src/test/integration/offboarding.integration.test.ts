import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { EmploymentType, EmploymentStatus, OffboardingStatus, SeparationType } from '#prisma';
import { runDeactivationCheck } from '../../services/offboarding-service.js';
import {
  createTestApp,
  createUser,
  loginForToken,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

/**
 * Seeds an org structure and returns an ACTIVE employee plus a user account
 * linked to that employee (so `user.employeeId` is resolved by the middleware).
 */
async function seedEmployeeLinkedUser(role: 'EMPLOYEE' | 'HR_MANAGER' | 'MANAGER', email: string) {
  const department = await prisma.department.create({
    data: { name: 'Sales', description: 'Sales team' },
  });
  const position = await prisma.position.create({
    data: { name: 'Sales Rep', grade: 'L3', department_id: department.id },
  });
  const employee = await prisma.employee.create({
    data: {
      employee_no: 'EMP-2026-0001',
      first_name: 'Sam',
      last_name: 'Stone',
      email: 'sam@example.com',
      department_id: department.id,
      position_id: position.id,
      hire_date: new Date('2024-01-15'),
      employment_type: EmploymentType.FULL_TIME,
      status: EmploymentStatus.ACTIVE,
    },
  });

  const user = await createUser({ role, email, employeeId: employee.id });

  return { employee, department, position, user };
}

describe('offboarding integration', () => {
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

  describe('resignation → clearance → close lifecycle', () => {
    it('submits a resignation, generates clearance items, completes them, and closes', async () => {
      const { employee, user } = await seedEmployeeLinkedUser('EMPLOYEE', 'sam@example.com');
      const token = await loginForToken(app, user.email, user.password);

      // Employee submits resignation.
      const resign = await request(app)
        .post('/api/offboarding/resignations')
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Personal reasons', lastWorkingDay: '2026-09-30' });
      expect(resign.status).toBe(201);
      const offboardingId = (resign.body as { offboarding: { id: string } }).offboarding.id;
      expect(resign.body).toMatchObject({ noticeWarning: expect.any(Boolean) });

      const record = await prisma.offboardingRecord.findUnique({
        where: { id: offboardingId },
      });
      expect(record?.status).toBe(OffboardingStatus.INITIATED);
      expect(record?.separation_type).toBe(SeparationType.RESIGNATION);
      expect(record?.employee_id).toBe(employee.id);

      // 4 default clearance items auto-generated.
      const items = await prisma.clearanceItem.findMany({
        where: { offboarding_id: offboardingId },
      });
      expect(items).toHaveLength(4);
      expect(items.every((i) => i.status === 'PENDING')).toBe(true);

      // HR completes all clearance items.
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);
      for (const item of items) {
        const res = await request(app)
          .patch(`/api/offboarding/clearance-items/${item.id}`)
          .set('Authorization', `Bearer ${hrToken}`)
          .send({ status: 'COMPLETE' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'COMPLETE', completed_at: expect.any(String) });
      }

      // Conduct exit interview.
      const interview = await request(app)
        .post(`/api/offboarding/${offboardingId}/exit-interview`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ responses: { culture: 'Great', management: 'Fair' } });
      expect(interview.status).toBe(201);
      const storedInterview = await prisma.exitInterview.findFirst({
        where: { offboarding_id: offboardingId },
      });
      expect(storedInterview?.declined).toBe(false);

      // Close offboarding -> employee terminated.
      const close = await request(app)
        .post(`/api/offboarding/${offboardingId}/close`)
        .set('Authorization', `Bearer ${hrToken}`)
        .expect(200);
      expect(close.body).toMatchObject({ status: OffboardingStatus.CLOSED });

      const updatedEmployee = await prisma.employee.findUnique({
        where: { id: employee.id },
      });
      expect(updatedEmployee?.status).toBe(EmploymentStatus.TERMINATED);
      expect(updatedEmployee?.deactivation_date).not.toBeNull();
    });

    it('blocks closing while clearance items are still pending', async () => {
      const { employee, user } = await seedEmployeeLinkedUser('EMPLOYEE', 'sam@example.com');
      const token = await loginForToken(app, user.email, user.password);

      const resign = await request(app)
        .post('/api/offboarding/resignations')
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Moving on', lastWorkingDay: '2026-10-01' });
      const offboardingId = (resign.body as { offboarding: { id: string } }).offboarding.id;

      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);

      // Complete only one of the four items.
      const items = await prisma.clearanceItem.findMany({
        where: { offboarding_id: offboardingId },
      });
      await request(app)
        .patch(`/api/offboarding/clearance-items/${items[0].id}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ status: 'COMPLETE' })
        .expect(200);

      const close = await request(app)
        .post(`/api/offboarding/${offboardingId}/close`)
        .set('Authorization', `Bearer ${hrToken}`);
      expect(close.status).toBe(400);

      // Employee must remain non-terminated.
      const employeeAfter = await prisma.employee.findUnique({ where: { id: employee.id } });
      expect(employeeAfter?.status).not.toBe(EmploymentStatus.TERMINATED);
    });

    it('rejects a second offboarding for the same employee', async () => {
      const { user } = await seedEmployeeLinkedUser('EMPLOYEE', 'sam@example.com');
      const token = await loginForToken(app, user.email, user.password);

      await request(app)
        .post('/api/offboarding/resignations')
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'First', lastWorkingDay: '2026-10-01' })
        .expect(201);

      const second = await request(app)
        .post('/api/offboarding/resignations')
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Second', lastWorkingDay: '2026-11-01' });
      expect(second.status).toBe(400);
    });
  });

  describe('clearance item permissions', () => {
    it('forbids a non-HR employee from waiving a clearance item', async () => {
      const { user } = await seedEmployeeLinkedUser('EMPLOYEE', 'sam@example.com');
      const token = await loginForToken(app, user.email, user.password);

      const resign = await request(app)
        .post('/api/offboarding/resignations')
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Leaving', lastWorkingDay: '2026-10-01' });
      const offboardingId = (resign.body as { offboarding: { id: string } }).offboarding.id;

      const items = await prisma.clearanceItem.findMany({
        where: { offboarding_id: offboardingId },
      });

      const waive = await request(app)
        .patch(`/api/offboarding/clearance-items/${items[0].id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'WAIVED', waivedReason: 'Not applicable' });
      expect(waive.status).toBe(403);
    });

    it('allows HR to waive a clearance item', async () => {
      const { user } = await seedEmployeeLinkedUser('EMPLOYEE', 'sam@example.com');
      const token = await loginForToken(app, user.email, user.password);

      const resign = await request(app)
        .post('/api/offboarding/resignations')
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Leaving', lastWorkingDay: '2026-10-01' });
      const offboardingId = (resign.body as { offboarding: { id: string } }).offboarding.id;

      const items = await prisma.clearanceItem.findMany({
        where: { offboarding_id: offboardingId },
      });

      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);

      const waive = await request(app)
        .patch(`/api/offboarding/clearance-items/${items[0].id}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ status: 'WAIVED', waivedReason: 'Device not issued' });
      expect(waive.status).toBe(200);
      expect(waive.body).toMatchObject({ status: 'WAIVED', waived_reason: 'Device not issued' });
    });
  });

  describe('deactivation check (cron)', () => {
    it('deactivates the user and terminates the employee once deactivation_date passes', async () => {
      const { employee, user } = await seedEmployeeLinkedUser('EMPLOYEE', 'sam@example.com');
      const token = await loginForToken(app, user.email, user.password);

      // Resignation with a past deactivation date so the cron picks it up.
      const resign = await request(app)
        .post('/api/offboarding/resignations')
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Leaving', lastWorkingDay: '2020-01-01' });
      expect(resign.status).toBe(201);

      // Force the deactivation date to the past (resignation sets it to last working day).
      const record = await prisma.offboardingRecord.findFirst({
        where: { employee_id: employee.id },
      });
      expect(record?.deactivation_date.getTime()).toBeLessThanOrEqual(Date.now());

      await runDeactivationCheck();

      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updatedUser?.status).toBe('DEACTIVATED');

      const updatedEmployee = await prisma.employee.findUnique({ where: { id: employee.id } });
      expect(updatedEmployee?.status).toBe(EmploymentStatus.TERMINATED);
    });
  });
});
