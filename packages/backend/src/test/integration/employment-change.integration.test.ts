import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ChangeStatus, ChangeType, EmploymentStatus, EmploymentType, UserRole } from '#prisma';
import { decrypt } from '../../utils/crypto.js';
import {
  createTestApp,
  createUser,
  loginForToken,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

/** Seeds a department, position, and an ACTIVE employee linked to a user account. */
async function seedEmployee(role: UserRole, email: string) {
  const department = await prisma.department.create({ data: { name: 'Engineering' } });
  const position = await prisma.position.create({
    data: { name: 'Engineer', grade: 'L4', department_id: department.id },
  });
  const employee = await prisma.employee.create({
    data: {
      employee_no: 'EMP-2026-0001',
      first_name: 'Kim',
      last_name: 'Taylor',
      email: 'kim@example.com',
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

describe('employment-change integration', () => {
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

  describe('HR immediate apply (encryption)', () => {
    it('records a SALARY_ADJUSTMENT with immediate effect and encrypts the salary', async () => {
      const { employee, user } = await seedEmployee(UserRole.EMPLOYEE, 'kim@example.com');
      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);
      void user;

      const res = await request(app)
        .post(`/api/employees/${employee.id}/changes`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          changeType: ChangeType.SALARY_ADJUSTMENT,
          newValue: { salary: 150000 },
          effectiveDate: new Date().toISOString(),
          reason: 'Annual review',
        });
      expect(res.status).toBe(201);

      const change = await prisma.employmentChange.findFirst({
        where: { employee_id: employee.id, change_type: ChangeType.SALARY_ADJUSTMENT },
      });
      expect(change?.status).toBe(ChangeStatus.APPLIED);

      // Salary stored encrypted and decrypts to the recorded value.
      const updated = await prisma.employee.findUnique({ where: { id: employee.id } });
      expect(updated?.salary_encrypted).not.toBeNull();
      expect(updated?.salary_encrypted).not.toContain('150000');
      expect(decrypt(updated?.salary_encrypted as string)).toBe('150000');
    });
  });

  describe('manager records pending change, HR applies', () => {
    it('records a MANAGER_CHANGE as PENDING and applies it via HR', async () => {
      // Manager employee + direct-report employee.
      const department = await prisma.department.create({ data: { name: 'Ops' } });
      const position = await prisma.position.create({
        data: { name: 'Ops', grade: 'L3', department_id: department.id },
      });
      const mgrEmployee = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2026-0001',
          first_name: 'Manny',
          last_name: 'Manager',
          email: 'manager@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2022-01-01'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });
      const reportEmployee = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2026-0002',
          first_name: 'Ree',
          last_name: 'Port',
          email: 'report@example.com',
          department_id: department.id,
          position_id: position.id,
          manager_id: mgrEmployee.id,
          hire_date: new Date('2024-01-01'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });

      const mgr = await createUser({
        role: UserRole.MANAGER,
        email: 'manager@example.com',
        employeeId: mgrEmployee.id,
      });
      const mgrToken = await loginForToken(app, mgr.email, mgr.password);
      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);

      const newMgrEmployee = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2026-0003',
          first_name: 'New',
          last_name: 'Manager',
          email: 'newmgr@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2021-01-01'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });

      const rec = await request(app)
        .post(`/api/employees/${reportEmployee.id}/changes`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({
          changeType: ChangeType.MANAGER_CHANGE,
          newValue: { managerId: newMgrEmployee.id },
          effectiveDate: new Date(Date.now() + 7 * 86400000).toISOString(),
          reason: 'Re-org',
        });
      expect(rec.status).toBe(201);

      const change = await prisma.employmentChange.findFirst({
        where: { employee_id: reportEmployee.id },
      });
      expect(change?.status).toBe(ChangeStatus.PENDING);
      expect(change?.recorded_by).toBe(mgr.id);

      // Employee not yet updated.
      const before = await prisma.employee.findUnique({ where: { id: reportEmployee.id } });
      expect(before?.manager_id).toBe(mgrEmployee.id);

      // HR applies the pending change.
      const apply = await request(app)
        .patch(`/api/employees/${reportEmployee.id}/changes/${change?.id}/apply`)
        .set('Authorization', `Bearer ${hrToken}`);
      expect(apply.status).toBe(200);

      const after = await prisma.employee.findUnique({ where: { id: reportEmployee.id } });
      expect(after?.manager_id).toBe(newMgrEmployee.id);

      const applied = await prisma.employmentChange.findUnique({ where: { id: change?.id } });
      expect(applied?.status).toBe(ChangeStatus.APPLIED);
    });
  });

  describe('RBAC and validation', () => {
    it('forbids a MANAGER from recording a SALARY_ADJUSTMENT', async () => {
      const { employee } = await seedEmployee(UserRole.EMPLOYEE, 'kim@example.com');
      // Manager who is the direct manager of the employee.
      const mgrEmployee = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2026-0002',
          first_name: 'M',
          last_name: 'G',
          email: 'mgr@example.com',
          department_id: employee.department_id,
          position_id: employee.position_id,
          hire_date: new Date('2022-01-01'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });
      await prisma.employee.update({
        where: { id: employee.id },
        data: { manager_id: mgrEmployee.id },
      });
      const mgr = await createUser({
        role: UserRole.MANAGER,
        email: 'mgr@example.com',
        employeeId: mgrEmployee.id,
      });
      const mgrToken = await loginForToken(app, mgr.email, mgr.password);

      const res = await request(app)
        .post(`/api/employees/${employee.id}/changes`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({
          changeType: ChangeType.SALARY_ADJUSTMENT,
          newValue: { salary: 999999 },
          effectiveDate: new Date().toISOString(),
        });
      expect(res.status).toBe(403);
    });

    it('forbids a MANAGER from recording changes for a non-direct-report', async () => {
      const department = await prisma.department.create({ data: { name: 'R&D' } });
      const position = await prisma.position.create({
        data: { name: 'R&D', grade: 'L3', department_id: department.id },
      });
      // Manager employee with no relationship to the target.
      const mgrEmployee = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2026-0001',
          first_name: 'Solo',
          last_name: 'Manager',
          email: 'solo@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2022-01-01'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });
      const target = await prisma.employee.create({
        data: {
          employee_no: 'EMP-2026-0002',
          first_name: 'Target',
          last_name: 'Person',
          email: 'target@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2024-01-01'),
          employment_type: EmploymentType.FULL_TIME,
          status: EmploymentStatus.ACTIVE,
        },
      });
      const mgr = await createUser({
        role: UserRole.MANAGER,
        email: 'solo@example.com',
        employeeId: mgrEmployee.id,
      });
      const mgrToken = await loginForToken(app, mgr.email, mgr.password);

      const res = await request(app)
        .post(`/api/employees/${target.id}/changes`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({
          changeType: ChangeType.MANAGER_CHANGE,
          newValue: { managerId: mgrEmployee.id },
          effectiveDate: new Date().toISOString(),
        });
      expect(res.status).toBe(403);
    });

    it('rejects applying a non-pending change', async () => {
      const { employee, user } = await seedEmployee(UserRole.EMPLOYEE, 'kim@example.com');
      const hr = await createUser({ role: UserRole.HR_MANAGER, email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);
      void user;

      // HR records an immediate change -> APPLIED.
      const rec = await request(app)
        .post(`/api/employees/${employee.id}/changes`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          changeType: ChangeType.STATUS_CHANGE,
          newValue: { status: EmploymentStatus.PROBATION },
          effectiveDate: new Date().toISOString(),
        });
      expect(rec.status).toBe(201);
      const change = await prisma.employmentChange.findFirst({
        where: { employee_id: employee.id },
      });
      expect(change?.status).toBe(ChangeStatus.APPLIED);

      // Applying an already-applied change must fail.
      const apply = await request(app)
        .patch(`/api/employees/${employee.id}/changes/${change?.id}/apply`)
        .set('Authorization', `Bearer ${hrToken}`);
      expect(apply.status).toBe(400);
    });
  });
});
