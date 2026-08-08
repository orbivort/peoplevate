import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { EmploymentStatus, EmploymentType } from '#prisma';
import {
  createTestApp,
  createUser,
  loginForToken,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

/**
 * Creates a minimal org structure (one department + one position) that an
 * employee record can reference via foreign keys.
 */
async function seedOrg() {
  const department = await prisma.department.create({
    data: { name: 'Engineering', description: 'Dev team' },
  });
  const position = await prisma.position.create({
    data: { name: 'Software Developer', grade: 'L4', department_id: department.id },
  });
  return { department, position };
}

describe('employee integration', () => {
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

  describe('authentication guard', () => {
    it('returns 401 without a Bearer token', async () => {
      const res = await request(app).get('/api/employees');
      expect(res.status).toBe(401);
    });

    it('returns 401 with an invalid token', async () => {
      const res = await request(app)
        .get('/api/employees')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/employees (RBAC)', () => {
    it('allows HR to create an employee', async () => {
      const { department, position } = await seedOrg();
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);

      const res = await request(app)
        .post('/api/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
          departmentId: department.id,
          positionId: position.id,
          hireDate: '2025-01-15',
          employmentType: EmploymentType.FULL_TIME,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: expect.any(String), employeeNo: expect.any(String) });

      // The record really exists in the DB.
      const created = await prisma.employee.findUnique({ where: { id: res.body.id } });
      expect(created).not.toBeNull();
      expect(created?.email).toBe('alice@example.com');
      expect(created?.status).toBe(EmploymentStatus.NEW_HIRE);
    });

    it('forbids an EMPLOYEE from creating an employee', async () => {
      await seedOrg();
      const emp = await createUser({ role: 'EMPLOYEE', email: 'emp@example.com' });
      const token = await loginForToken(app, emp.email, emp.password);

      const res = await request(app)
        .post('/api/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Bob',
          lastName: 'Jones',
          email: 'bob@example.com',
          departmentId: 'dept',
          positionId: 'pos',
          hireDate: '2025-01-15',
          employmentType: EmploymentType.FULL_TIME,
        });

      expect(res.status).toBe(403);
    });

    it('forbids a MANAGER from creating an employee', async () => {
      await seedOrg();
      const mgr = await createUser({ role: 'MANAGER', email: 'mgr@example.com' });
      const token = await loginForToken(app, mgr.email, mgr.password);

      const res = await request(app)
        .post('/api/employees')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Bob',
          lastName: 'Jones',
          email: 'bob@example.com',
          departmentId: 'dept',
          positionId: 'pos',
          hireDate: '2025-01-15',
          employmentType: EmploymentType.FULL_TIME,
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/employees (role-scoped visibility)', () => {
    it('HR sees all employees', async () => {
      const { department, position } = await seedOrg();
      await prisma.employee.create({
        data: {
          employee_no: 'EMP-2025-0001',
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2025-01-15'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });
      await prisma.employee.create({
        data: {
          employee_no: 'EMP-2025-0002',
          first_name: 'Bob',
          last_name: 'Jones',
          email: 'bob@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2025-01-16'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });

      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);

      const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.employees).toHaveLength(2);
    });

    it('EMPLOYEE sees only their own profile', async () => {
      const { department, position } = await seedOrg();
      const emp = await createUser({ role: 'EMPLOYEE', email: 'emp@example.com' });

      const self = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2025-0001',
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'emp@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2025-01-15'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
          user_id: emp.id,
        },
      });
      await prisma.employee.create({
        data: {
          employee_no: 'EMP-2025-0002',
          first_name: 'Bob',
          last_name: 'Jones',
          email: 'bob@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2025-01-16'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });

      const token = await loginForToken(app, emp.email, emp.password);
      const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.employees).toHaveLength(1);
      expect(res.body.employees[0].id).toBe(self.id);
    });
  });

  describe('GET /api/employees/:id (RBAC + sensitive fields)', () => {
    it('HR can view a profile with decrypted sensitive fields', async () => {
      const { department, position } = await seedOrg();
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });

      const employee = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2025-0001',
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2025-01-15'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });

      const token = await loginForToken(app, hr.email, hr.password);
      const res = await request(app)
        .get(`/api/employees/${employee.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.firstName).toBe('Alice');
      expect(res.body.salary).toBeDefined();
    });

    it('forbids an EMPLOYEE from viewing another employee', async () => {
      const { department, position } = await seedOrg();
      const emp = await createUser({ role: 'EMPLOYEE', email: 'emp@example.com' });

      const other = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2025-0001',
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2025-01-15'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });

      const token = await loginForToken(app, emp.email, emp.password);
      const res = await request(app)
        .get(`/api/employees/${other.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('returns 404 for a missing employee', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);

      const res = await request(app)
        .get('/api/employees/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/employees/:id/status', () => {
    it('transitions an employee status and records the change', async () => {
      const { department, position } = await seedOrg();
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });

      const employee = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2025-0001',
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2025-01-15'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.NEW_HIRE,
        },
      });

      const token = await loginForToken(app, hr.email, hr.password);
      const res = await request(app)
        .patch(`/api/employees/${employee.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: EmploymentStatus.ACTIVE, effectiveDate: '2025-06-01' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Status transitioned' });

      const updated = await prisma.employee.findUnique({ where: { id: employee.id } });
      expect(updated?.status).toBe(EmploymentStatus.ACTIVE);

      const change = await prisma.employmentChange.findFirst({
        where: { employee_id: employee.id },
      });
      expect(change?.change_type).toBe('STATUS_CHANGE');
      expect(change?.status).toBe('APPLIED');
    });

    it('rejects an invalid status transition', async () => {
      const { department, position } = await seedOrg();
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });

      const employee = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2025-0001',
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2025-01-15'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.TERMINATED,
        },
      });

      const token = await loginForToken(app, hr.email, hr.password);
      const res = await request(app)
        .patch(`/api/employees/${employee.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: EmploymentStatus.ACTIVE, effectiveDate: '2025-06-01' });

      expect(res.status).toBe(400);
    });
  });
});
