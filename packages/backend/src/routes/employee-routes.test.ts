import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { EmploymentStatus, EmploymentType } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = {
      userId: 'u-1',
      email: 'jane@example.com',
      role: 'HR_MANAGER',
      employeeId: 'emp-1',
    };
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireHR: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  requireHRorManager: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../utils/audit-context.js', () => ({
  withAuditContext: vi.fn(
    (_prisma: unknown, _actorId: string, _actorName: string, cb: () => unknown) => cb(),
  ),
}));

vi.mock('multer', () => {
  const mockMulter = vi.fn(() => ({
    single:
      () => (req: Request & { file?: Express.Multer.File }, _res: unknown, next: () => void) => {
        // Simulate a file being uploaded
        req.file = {
          fieldname: 'file',
          originalname: 'test.png',
          encoding: '7bit',
          mimetype: 'image/png',
          destination: '/tmp/uploads/avatars',
          filename: 'test-uuid.png',
          path: '/tmp/uploads/avatars/test-uuid.png',
          size: 1024,
          stream: null as never,
          buffer: Buffer.from(''),
        };
        next();
      },
  }));
  // multer.diskStorage is called at module load time; return a no-op stub
  (mockMulter as unknown as { diskStorage: () => unknown }).diskStorage = () => ({});
  return { default: mockMulter };
});

vi.mock('../services/employee-service.js', () => ({
  listEmployees: vi.fn(),
  getEmployee: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  transitionStatus: vi.fn(),
  selfUpdateEmployee: vi.fn(),
  setAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  getAvatarPath: vi.fn(),
}));

import { getAuthUser } from '../middleware/auth.js';
import { prisma } from '../config/prisma.js';
import * as employeeService from '../services/employee-service.js';
import { employeeRoutes } from './employee-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  listEmployees: vi.mocked(employeeService.listEmployees),
  getEmployee: vi.mocked(employeeService.getEmployee),
  createEmployee: vi.mocked(employeeService.createEmployee),
  updateEmployee: vi.mocked(employeeService.updateEmployee),
  transitionStatus: vi.mocked(employeeService.transitionStatus),
  selfUpdateEmployee: vi.mocked(employeeService.selfUpdateEmployee),
  setAvatar: vi.mocked(employeeService.setAvatar),
  removeAvatar: vi.mocked(employeeService.removeAvatar),
  getAvatarPath: vi.mocked(employeeService.getAvatarPath),
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  employeeFindFirst: vi.mocked(prisma.employee.findFirst),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/employees', employeeRoutes);
  app.use(errorHandler);
  return app;
}

function setUser(user: Record<string, unknown>) {
  vi.mocked(getAuthUser).mockReturnValue(user as never);
}

const MANAGER_USER = {
  userId: 'u-mgr',
  email: 'mgr@example.com',
  role: 'MANAGER',
  employeeId: 'mgr-emp',
};

describe('employee-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default HR user before each test so MANAGER overrides do not leak.
    vi.mocked(getAuthUser).mockImplementation((req: { user?: unknown }) => req.user);
    mocked.listEmployees.mockResolvedValue([]);
    mocked.getEmployee.mockResolvedValue({ id: 'emp-1' });
    mocked.createEmployee.mockResolvedValue({ employeeNo: 'EMP-1' });
    mocked.updateEmployee.mockResolvedValue(undefined);
    mocked.transitionStatus.mockResolvedValue(undefined);
  });

  describe('GET /api/employees', () => {
    it('lists employees with only status filter (HR path)', async () => {
      mocked.listEmployees.mockResolvedValue([{ id: 'emp-1' }]);

      const res = await request(buildApp()).get('/api/employees?status=ACTIVE');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ employees: [{ id: 'emp-1' }] });
      expect(mocked.listEmployees).toHaveBeenCalledWith({
        role: 'HR_MANAGER',
        userId: 'u-1',
        employeeId: 'emp-1',
        search: undefined,
        status: 'ACTIVE',
        departmentId: undefined,
      });
    });

    it('passes search and departmentId query params (branch coverage)', async () => {
      const res = await request(buildApp()).get(
        '/api/employees?search=Jane&departmentId=dep-2&status=INACTIVE',
      );

      expect(res.status).toBe(200);
      expect(mocked.listEmployees).toHaveBeenCalledWith({
        role: 'HR_MANAGER',
        userId: 'u-1',
        employeeId: 'emp-1',
        search: 'Jane',
        status: 'INACTIVE',
        departmentId: 'dep-2',
      });
    });

    it('works with no query params (all undefined branches)', async () => {
      const res = await request(buildApp()).get('/api/employees');

      expect(res.status).toBe(200);
      expect(mocked.listEmployees).toHaveBeenCalledWith({
        role: 'HR_MANAGER',
        userId: 'u-1',
        employeeId: 'emp-1',
        search: undefined,
        status: undefined,
        departmentId: undefined,
      });
    });

    it('forwards service errors', async () => {
      mocked.listEmployees.mockRejectedValue(
        Object.assign(new Error('list failed'), { status: 500 }),
      );

      const res = await request(buildApp()).get('/api/employees');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('GET /api/employees/:id', () => {
    it('returns a single employee', async () => {
      const res = await request(buildApp()).get('/api/employees/emp-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 'emp-1' });
      expect(mocked.getEmployee).toHaveBeenCalledWith('emp-1', 'HR_MANAGER', 'u-1');
    });

    it('forwards service errors (404 branch)', async () => {
      mocked.getEmployee.mockRejectedValue(
        Object.assign(new Error('Employee not found'), { status: 404 }),
      );

      const res = await request(buildApp()).get('/api/employees/missing');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Employee not found');
    });
  });

  describe('POST /api/employees', () => {
    it('creates an employee (HR path via requireHR)', async () => {
      const res = await request(buildApp()).post('/api/employees').send({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        hireDate: '2026-01-01',
        employmentType: EmploymentType.FULL_TIME,
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ employeeNo: 'EMP-1' });
      expect(mocked.createEmployee).toHaveBeenCalled();
    });

    it('returns 400 on invalid body (Zod parse fail branch)', async () => {
      const res = await request(buildApp()).post('/api/employees').send({ firstName: 'Jane' });

      expect(res.status).toBe(400);
      expect(mocked.createEmployee).not.toHaveBeenCalled();
    });

    it('supports optional/coercible fields in create body', async () => {
      const res = await request(buildApp()).post('/api/employees').send({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        hireDate: '2026-01-01',
        employmentType: EmploymentType.PART_TIME,
        nationalId: 'N123',
        phone: '123',
        gender: 'FEMALE',
        dateOfBirth: '1990-05-05',
        salary: 50000,
        status: EmploymentStatus.ACTIVE,
      });

      expect(res.status).toBe(201);
      expect(mocked.createEmployee).toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.createEmployee.mockRejectedValue(
        Object.assign(new Error('create failed'), { status: 409 }),
      );

      const res = await request(buildApp()).post('/api/employees').send({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        hireDate: '2026-01-01',
        employmentType: EmploymentType.FULL_TIME,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('create failed');
    });
  });

  describe('PUT /api/employees/:id', () => {
    it('updates an employee (HR path, no manager check)', async () => {
      const res = await request(buildApp())
        .put('/api/employees/emp-1')
        .send({ firstName: 'Janet' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Employee updated' });
      expect(mocked.updateEmployee).toHaveBeenCalledWith(
        'emp-1',
        { firstName: 'Janet' },
        'HR_MANAGER',
      );
      // HR role skips the employee/manager lookups
      expect(mocked.employeeFindUnique).not.toHaveBeenCalled();
      expect(mocked.employeeFindFirst).not.toHaveBeenCalled();
    });

    it('converts explicit managerId to the value passed (?? defined branch)', async () => {
      const res = await request(buildApp())
        .put('/api/employees/emp-1')
        .send({ managerId: 'mgr-x' });

      expect(res.status).toBe(200);
      expect(mocked.updateEmployee).toHaveBeenCalledWith(
        'emp-1',
        { managerId: 'mgr-x' },
        'HR_MANAGER',
      );
    });

    it('converts nullable managerId (null) to undefined (?? undefined branch)', async () => {
      const res = await request(buildApp()).put('/api/employees/emp-1').send({ managerId: null });

      expect(res.status).toBe(200);
      expect(mocked.updateEmployee).toHaveBeenCalledWith(
        'emp-1',
        { managerId: undefined },
        'HR_MANAGER',
      );
    });

    it('allows a manager to edit a direct report (MANAGER branch, allowed)', async () => {
      setUser(MANAGER_USER);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-emp' });
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'mgr-emp' });

      const res = await request(buildApp())
        .put('/api/employees/direct-report')
        .send({ firstName: 'Rep' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Employee updated' });
      expect(mocked.updateEmployee).toHaveBeenCalledWith(
        'direct-report',
        { firstName: 'Rep' },
        'MANAGER',
      );
    });

    it('forbids a manager from editing a non-direct report (manager_id mismatch)', async () => {
      setUser(MANAGER_USER);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-emp' });
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'someone-else' });

      const res = await request(buildApp())
        .put('/api/employees/not-my-report')
        .send({ firstName: 'Rep' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'You can only edit your direct reports' });
      expect(mocked.updateEmployee).not.toHaveBeenCalled();
    });

    it('forbids a manager when the target employee is not found (target null branch)', async () => {
      setUser(MANAGER_USER);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr-emp' });
      mocked.employeeFindFirst.mockResolvedValue(null);

      const res = await request(buildApp())
        .put('/api/employees/missing')
        .send({ firstName: 'Rep' });

      expect(res.status).toBe(403);
      expect(mocked.updateEmployee).not.toHaveBeenCalled();
    });

    it('forbids a manager who has no linked employee record (selfEmployee undefined branch)', async () => {
      setUser({ ...MANAGER_USER, employeeId: null });
      mocked.employeeFindUnique.mockResolvedValue(null);
      mocked.employeeFindFirst.mockResolvedValue({ manager_id: 'mgr-emp' });

      const res = await request(buildApp())
        .put('/api/employees/direct-report')
        .send({ firstName: 'Rep' });

      expect(res.status).toBe(403);
      expect(mocked.updateEmployee).not.toHaveBeenCalled();
    });

    it('returns 400 on invalid update body (Zod parse fail branch)', async () => {
      const res = await request(buildApp()).put('/api/employees/emp-1').send({ firstName: '' }); // min(1) fails

      expect(res.status).toBe(400);
      expect(mocked.updateEmployee).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.updateEmployee.mockRejectedValue(
        Object.assign(new Error('update failed'), { status: 400 }),
      );

      const res = await request(buildApp())
        .put('/api/employees/emp-1')
        .send({ firstName: 'Janet' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('update failed');
    });
  });

  describe('PATCH /api/employees/:id/status', () => {
    it('transitions the status (reason undefined branch)', async () => {
      const res = await request(buildApp())
        .patch('/api/employees/emp-1/status')
        .send({ status: 'ACTIVE', effectiveDate: '2026-02-01' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Status transitioned' });
      expect(mocked.transitionStatus).toHaveBeenCalledWith({
        employeeId: 'emp-1',
        newStatus: 'ACTIVE',
        effectiveDate: expect.any(Date),
        reason: undefined,
        recordedBy: 'u-1',
      });
    });

    it('passes the provided reason (reason defined branch)', async () => {
      const res = await request(buildApp())
        .patch('/api/employees/emp-1/status')
        .send({ status: 'ON_LEAVE', effectiveDate: '2026-03-01', reason: 'Maternity' });

      expect(res.status).toBe(200);
      expect(mocked.transitionStatus).toHaveBeenCalledWith({
        employeeId: 'emp-1',
        newStatus: 'ON_LEAVE',
        effectiveDate: expect.any(Date),
        reason: 'Maternity',
        recordedBy: 'u-1',
      });
    });

    it('returns 400 on invalid body (Zod parse fail branch)', async () => {
      const res = await request(buildApp())
        .patch('/api/employees/emp-1/status')
        .send({ effectiveDate: '2026-03-01' }); // missing status

      expect(res.status).toBe(400);
      expect(mocked.transitionStatus).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.transitionStatus.mockRejectedValue(
        Object.assign(new Error('transition failed'), { status: 409 }),
      );

      const res = await request(buildApp())
        .patch('/api/employees/emp-1/status')
        .send({ status: 'ACTIVE', effectiveDate: '2026-02-01' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('transition failed');
    });
  });

  describe('PUT /api/employees/:id/self', () => {
    const EMPLOYEE_USER = {
      userId: 'u-emp',
      email: 'emp@example.com',
      role: 'EMPLOYEE',
      employeeId: 'emp-self',
    };

    it('updates own profile successfully', async () => {
      setUser(EMPLOYEE_USER);
      mocked.selfUpdateEmployee.mockResolvedValue(undefined);

      const res = await request(buildApp())
        .put('/api/employees/emp-self/self')
        .send({ phone: '+1234567890', address: '123 Main St' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Profile updated' });
      expect(mocked.selfUpdateEmployee).toHaveBeenCalledWith({
        employeeId: 'emp-self',
        userId: 'u-emp',
        userEmail: 'emp@example.com',
        fields: { phone: '+1234567890', address: '123 Main St' },
      });
    });

    it('forwards 403 when editing another employee', async () => {
      setUser(EMPLOYEE_USER);
      mocked.selfUpdateEmployee.mockRejectedValue(
        Object.assign(new Error('You can only edit your own profile.'), { status: 403 }),
      );

      const res = await request(buildApp())
        .put('/api/employees/emp-other/self')
        .send({ phone: '+1234567890' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('You can only edit your own profile');
    });

    it('forwards 400 on invalid phone format', async () => {
      setUser(EMPLOYEE_USER);
      mocked.selfUpdateEmployee.mockRejectedValue(
        Object.assign(new Error('Phone number format is invalid.'), { status: 400 }),
      );

      const res = await request(buildApp())
        .put('/api/employees/emp-self/self')
        .send({ phone: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Phone number format is invalid');
    });

    it('forwards 400 when emptying a previously set field', async () => {
      setUser(EMPLOYEE_USER);
      mocked.selfUpdateEmployee.mockRejectedValue(
        Object.assign(new Error('Phone cannot be emptied. It was previously set.'), {
          status: 400,
        }),
      );

      const res = await request(buildApp()).put('/api/employees/emp-self/self').send({ phone: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Phone cannot be emptied');
    });

    it('ignores disallowed fields in the request body', async () => {
      setUser(EMPLOYEE_USER);
      mocked.selfUpdateEmployee.mockResolvedValue(undefined);

      const res = await request(buildApp()).put('/api/employees/emp-self/self').send({
        phone: '+1234567890',
        firstName: 'ShouldBeIgnored',
        salary: 99999,
      });

      expect(res.status).toBe(200);
      // The Zod schema strips unknown keys, so only `phone` is passed through
      expect(mocked.selfUpdateEmployee).toHaveBeenCalledWith({
        employeeId: 'emp-self',
        userId: 'u-emp',
        userEmail: 'emp@example.com',
        fields: { phone: '+1234567890' },
      });
    });

    it('returns 400 on Zod parse failure (address too long)', async () => {
      setUser(EMPLOYEE_USER);

      const res = await request(buildApp())
        .put('/api/employees/emp-self/self')
        .send({ address: 'x'.repeat(501) });

      expect(res.status).toBe(400);
      expect(mocked.selfUpdateEmployee).not.toHaveBeenCalled();
    });

    it('updates emergency contact fields successfully', async () => {
      setUser(EMPLOYEE_USER);
      mocked.selfUpdateEmployee.mockResolvedValue(undefined);

      const res = await request(buildApp()).put('/api/employees/emp-self/self').send({
        emergencyContactName: 'Jane Doe',
        emergencyContactRelationship: 'Spouse',
        emergencyContactPhone: '+9876543210',
      });

      expect(res.status).toBe(200);
      expect(mocked.selfUpdateEmployee).toHaveBeenCalledWith({
        employeeId: 'emp-self',
        userId: 'u-emp',
        userEmail: 'emp@example.com',
        fields: {
          emergencyContactName: 'Jane Doe',
          emergencyContactRelationship: 'Spouse',
          emergencyContactPhone: '+9876543210',
        },
      });
    });
  });

  describe('POST /api/employees/:id/avatar', () => {
    const EMPLOYEE_USER = {
      userId: 'u-emp',
      email: 'emp@example.com',
      role: 'EMPLOYEE',
      employeeId: 'emp-self',
    };

    it('uploads avatar successfully', async () => {
      setUser(EMPLOYEE_USER);
      mocked.setAvatar.mockResolvedValue('/api/employees/emp-self/avatar');

      const res = await request(buildApp())
        .post('/api/employees/emp-self/avatar')
        .attach('file', Buffer.from('fake-image'), 'test.png');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: 'Avatar uploaded',
        avatarUrl: '/api/employees/emp-self/avatar',
      });
      expect(mocked.setAvatar).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp-self',
          userId: 'u-emp',
          userEmail: 'emp@example.com',
        }),
      );
    });

    it('forwards 403 when uploading for another employee', async () => {
      setUser(EMPLOYEE_USER);
      mocked.setAvatar.mockRejectedValue(
        Object.assign(new Error('You can only update your own avatar.'), { status: 403 }),
      );

      const res = await request(buildApp())
        .post('/api/employees/emp-other/avatar')
        .attach('file', Buffer.from('fake-image'), 'test.png');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('You can only update your own avatar');
    });
  });

  describe('DELETE /api/employees/:id/avatar', () => {
    const EMPLOYEE_USER = {
      userId: 'u-emp',
      email: 'emp@example.com',
      role: 'EMPLOYEE',
      employeeId: 'emp-self',
    };

    it('removes avatar successfully', async () => {
      setUser(EMPLOYEE_USER);
      mocked.removeAvatar.mockResolvedValue(undefined);

      const res = await request(buildApp()).delete('/api/employees/emp-self/avatar');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Avatar removed' });
      expect(mocked.removeAvatar).toHaveBeenCalledWith({
        employeeId: 'emp-self',
        userId: 'u-emp',
        userEmail: 'emp@example.com',
      });
    });

    it('forwards 403 when removing another employee avatar', async () => {
      setUser(EMPLOYEE_USER);
      mocked.removeAvatar.mockRejectedValue(
        Object.assign(new Error('You can only remove your own avatar.'), { status: 403 }),
      );

      const res = await request(buildApp()).delete('/api/employees/emp-other/avatar');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('You can only remove your own avatar');
    });
  });

  describe('GET /api/employees/:id/avatar', () => {
    const EMPLOYEE_USER = {
      userId: 'u-emp',
      email: 'emp@example.com',
      role: 'EMPLOYEE',
      employeeId: 'emp-self',
    };

    it('returns 404 when no avatar exists', async () => {
      setUser(EMPLOYEE_USER);
      mocked.getAvatarPath.mockResolvedValue(null);

      const res = await request(buildApp()).get('/api/employees/emp-self/avatar');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'No avatar found' });
    });

    it('forwards 403 when accessing another employee avatar', async () => {
      setUser(EMPLOYEE_USER);
      mocked.getAvatarPath.mockRejectedValue(
        Object.assign(new Error('Access denied'), { status: 403 }),
      );

      const res = await request(buildApp()).get('/api/employees/emp-other/avatar');

      expect(res.status).toBe(403);
    });
  });
});
