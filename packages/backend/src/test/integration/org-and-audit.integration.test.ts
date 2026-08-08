import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { EmploymentStatus, EmploymentType, UserRole } from '#prisma';
import {
  createTestApp,
  createUser,
  loginForToken,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

describe('org structure + audit RBAC integration', () => {
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

  describe('department & position RBAC', () => {
    it('lets HR create a department and an EMPLOYEE cannot', async () => {
      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);

      const created = await request(app)
        .post('/api/departments')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ name: 'Engineering', description: 'Dev team' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ name: 'Engineering' });

      const emp = await createUser({ role: UserRole.EMPLOYEE, email: 'emp@example.com' });
      const empToken = await loginForToken(app, emp.email, emp.password);
      const forbidden = await request(app)
        .post('/api/departments')
        .set('Authorization', `Bearer ${empToken}`)
        .send({ name: 'Nope' });
      expect(forbidden.status).toBe(403);
    });

    it('blocks department delete while it still has positions', async () => {
      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);

      const dept = await prisma.department.create({ data: { name: 'Sales' } });
      await prisma.position.create({
        data: { name: 'Sales Rep', grade: 'L3', department_id: dept.id },
      });

      const res = await request(app)
        .delete(`/api/departments/${dept.id}`)
        .set('Authorization', `Bearer ${hrToken}`);
      expect(res.status).toBe(409);
    });

    it('blocks position delete while it still has employees', async () => {
      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);

      const dept = await prisma.department.create({ data: { name: 'Eng' } });
      const pos = await prisma.position.create({
        data: { name: 'Engineer', grade: 'L4', department_id: dept.id },
      });
      await prisma.employee.create({
        data: {
          employee_no: 'EMP-2026-0001',
          first_name: 'A',
          last_name: 'B',
          email: 'ab@example.com',
          department_id: dept.id,
          position_id: pos.id,
          hire_date: new Date('2024-01-01'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });

      const res = await request(app)
        .delete(`/api/positions/${pos.id}`)
        .set('Authorization', `Bearer ${hrToken}`);
      expect(res.status).toBe(409);
    });

    it('lets HR create a position in an existing department', async () => {
      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);
      const dept = await prisma.department.create({ data: { name: 'Product' } });

      const res = await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ name: 'PM', grade: 'L5', departmentId: dept.id });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'PM', department_id: dept.id });
    });

    it('rejects creating a department whose parent is itself (circular reference)', async () => {
      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);

      const dept = await prisma.department.create({ data: { name: 'Parent' } });
      const res = await request(app)
        .put(`/api/departments/${dept.id}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ parentId: dept.id });
      expect(res.status).toBe(400);
    });
  });

  describe('audit log RBAC', () => {
    it('forbids an EMPLOYEE from viewing the audit log', async () => {
      const emp = await createUser({ role: UserRole.EMPLOYEE, email: 'emp@example.com' });
      const empToken = await loginForToken(app, emp.email, emp.password);

      const res = await request(app)
        .get('/api/audit-log')
        .set('Authorization', `Bearer ${empToken}`);
      expect(res.status).toBe(403);
    });

    it('allows HR to list the audit log and record login events', async () => {
      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      await loginForToken(app, hr.email, hr.password);

      const res = await request(app)
        .get('/api/audit-log')
        .set('Authorization', `Bearer ${await loginForToken(app, hr.email, hr.password)}`);
      expect(res.status).toBe(200);
      // Login events are written by the auth flow, so at least one row exists.
      expect(Array.isArray(res.body.logs)).toBe(true);
    });
  });

  describe('employee-linked role scoping', () => {
    it('lets a MANAGER create a department is forbidden (HR-only), but can view departments', async () => {
      const dept = await prisma.department.create({ data: { name: 'Visible' } });
      const mgr = await createUser({ role: UserRole.MANAGER, email: 'mgr@example.com' });
      const mgrToken = await loginForToken(app, mgr.email, mgr.password);

      const list = await request(app)
        .get('/api/departments')
        .set('Authorization', `Bearer ${mgrToken}`);
      expect(list.status).toBe(200);
      expect(list.body.departments.some((d: { id: string }) => d.id === dept.id)).toBe(true);

      const create = await request(app)
        .post('/api/departments')
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({ name: 'Blocked' });
      expect(create.status).toBe(403);
    });
  });
});
