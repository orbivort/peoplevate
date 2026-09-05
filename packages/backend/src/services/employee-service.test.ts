import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmploymentStatus, EmploymentType, Gender } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    employmentChange: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../utils/crypto.js', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => `dec:${v}`),
  maskValue: vi.fn((v: string) => `masked:${v}`),
}));

vi.mock('../services/audit-service.js', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/env.js', () => ({
  env: { UPLOAD_DIR: '/uploads' },
}));

vi.mock('node:fs/promises', () => ({
  default: { unlink: vi.fn().mockResolvedValue(undefined) },
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:path', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: typeof import('node:path') };
  return {
    ...actual,
    default: {
      ...actual.default,
      join: (...segments: string[]) => segments.filter(Boolean).join('/'),
    },
  };
});

import { prisma } from '../config/prisma.js';
import { encrypt, decrypt, maskValue } from '../utils/crypto.js';
import { logAuditEvent } from '../services/audit-service.js';
import fsp from 'node:fs/promises';
import {
  createEmployee,
  getEmployee,
  getAvatarPath,
  listEmployees,
  removeAvatar,
  selfUpdateEmployee,
  setAvatar,
  transitionStatus,
  updateEmployee,
} from './employee-service.js';

const mocked = {
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  employeeFindMany: vi.mocked(prisma.employee.findMany),
  employeeFindFirst: vi.mocked(prisma.employee.findFirst),
  employeeCreate: vi.mocked(prisma.employee.create),
  employeeUpdate: vi.mocked(prisma.employee.update),
  employeeCount: vi.mocked(prisma.employee.count),
  employmentChangeCreate: vi.mocked(prisma.employmentChange.create),
  encrypt: vi.mocked(encrypt),
  decrypt: vi.mocked(decrypt),
  maskValue: vi.mocked(maskValue),
  logAuditEvent: vi.mocked(logAuditEvent),
  fsUnlink: vi.mocked(fsp.unlink),
};

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  message?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect((err as { status: number }).status).toBe(status);
    if (message) {
      expect((err as Error).message).toContain(message);
    }
    return;
  }
  throw new Error(`Expected HTTP error ${status} but promise resolved`);
}

/** A fully-populated employee row, so every formatter branch has data. */
function employeeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'e1',
    employee_no: 'E-001',
    first_name: 'Ann',
    last_name: 'Lee',
    date_of_birth: new Date('1990-01-01'),
    gender: Gender.FEMALE,
    email: 'ann@example.com',
    phone: '123',
    address: 'Somewhere',
    department: { id: 'd1', name: 'Eng' },
    position: { id: 'p1', name: 'Dev' },
    manager: null,
    manager_id: null,
    hire_date: new Date('2024-01-01'),
    employment_type: EmploymentType.FULL_TIME,
    status: EmploymentStatus.ACTIVE,
    deactivation_date: null,
    avatar_url: null,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-02'),
    national_id_encrypted: 'nid-enc',
    salary_encrypted: 'sal-enc',
    emergency_contact_name: 'Bob',
    emergency_contact_relationship: 'Spouse',
    emergency_contact_phone: '999',
    user: null,
    ...overrides,
  };
}

describe('employee-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listEmployees', () => {
    it('returns an empty array when an EMPLOYEE has no linked employeeId', async () => {
      const result = await listEmployees({ role: 'EMPLOYEE', userId: 'u-1' });
      expect(result).toEqual([]);
      expect(mocked.employeeFindMany).not.toHaveBeenCalled();
    });

    it('scopes to self for EMPLOYEE role with an employeeId', async () => {
      mocked.employeeFindMany.mockResolvedValue([{ id: 'emp-1' }] as never);

      await listEmployees({ role: 'EMPLOYEE', userId: 'u-1', employeeId: 'emp-1' });

      expect(mocked.employeeFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'emp-1' }),
        }),
      );
    });

    it('scopes to direct reports + self for MANAGER role', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-mgr' } as never);
      mocked.employeeFindMany.mockResolvedValue([] as never);

      await listEmployees({ role: 'MANAGER', userId: 'u-1' });

      expect(mocked.employeeFindUnique).toHaveBeenCalledWith({
        where: { user_id: 'u-1' },
        select: { id: true },
      });
      expect(mocked.employeeFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ manager_id: 'emp-mgr' }, { id: 'emp-mgr' }],
          }),
        }),
      );
    });

    it('returns all for HR/ADMIN roles', async () => {
      mocked.employeeFindMany.mockResolvedValue([] as never);

      await listEmployees({ role: 'HR_MANAGER', userId: 'u-1' });

      expect(mocked.employeeFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null } }),
      );
    });

    it('applies search, status and department filters', async () => {
      mocked.employeeFindMany.mockResolvedValue([] as never);

      await listEmployees({
        role: 'ADMIN',
        userId: 'u-1',
        search: 'john',
        status: 'ACTIVE',
        departmentId: 'dep-1',
      });

      const where = mocked.employeeFindMany.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.status).toBe('ACTIVE');
      expect(where.department_id).toBe('dep-1');
      expect(Array.isArray(where.OR)).toBe(true);
    });

    it('combines search, status, and department filters with a full OR clause', async () => {
      mocked.employeeFindMany.mockResolvedValue([] as never);

      await listEmployees({
        role: 'ADMIN',
        userId: 'u1',
        search: 'ann',
        status: EmploymentStatus.ACTIVE,
        departmentId: 'd1',
      });

      const where = mocked.employeeFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where.status).toBe(EmploymentStatus.ACTIVE);
      expect(where.department_id).toBe('d1');
      expect((where.OR as unknown[]).length).toBe(5);
    });

    it('appends search clauses onto an existing manager scope', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr' } as never);
      mocked.employeeFindMany.mockResolvedValue([] as never);

      await listEmployees({ role: 'MANAGER', userId: 'u1', search: 'ann' });

      const where = mocked.employeeFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      // 2 manager-scope clauses + 5 search clauses.
      expect((where.OR as unknown[]).length).toBe(7);
    });

    it('returns an empty list when a MANAGER has no employee record', async () => {
      mocked.employeeFindUnique.mockResolvedValue(null as never);

      expect(await listEmployees({ role: 'MANAGER', userId: 'u1' })).toEqual([]);
      expect(mocked.employeeFindMany).not.toHaveBeenCalled();
    });

    it('masks sensitive fields in the list for a non-privileged role', async () => {
      mocked.employeeFindMany.mockResolvedValue([employeeRow()] as never);

      const result = (await listEmployees({
        role: 'EMPLOYEE',
        userId: 'u1',
        employeeId: 'e1',
      })) as { salary: string; nationalId: string }[];

      expect(result[0]?.salary).toBe('Restricted');
      expect(result[0]?.nationalId).toBe('masked:dec:nid-enc');
    });

    it('decrypts sensitive fields in the list for HR', async () => {
      mocked.employeeFindMany.mockResolvedValue([employeeRow()] as never);

      const result = (await listEmployees({ role: 'HR_MANAGER', userId: 'u1' })) as {
        salary: string;
        nationalId: string;
      }[];

      expect(result[0]?.salary).toBe('dec:sal-enc');
      expect(result[0]?.nationalId).toBe('dec:nid-enc');
    });

    it('returns nulls when encrypted list fields are absent', async () => {
      mocked.employeeFindMany.mockResolvedValue([
        employeeRow({ salary_encrypted: null, national_id_encrypted: null }),
      ] as never);

      const asHr = (await listEmployees({ role: 'ADMIN', userId: 'u1' })) as {
        salary: string | null;
        nationalId: string | null;
      }[];
      expect(asHr[0]?.salary).toBeNull();
      expect(asHr[0]?.nationalId).toBeNull();

      const asEmp = (await listEmployees({
        role: 'EMPLOYEE',
        userId: 'u1',
        employeeId: 'e1',
      })) as { nationalId: string | null }[];
      expect(asEmp[0]?.nationalId).toBeNull();
    });
  });

  describe('getEmployee', () => {
    it('throws 404 when the employee does not exist', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);

      await expectHttpError(getEmployee('emp-x', 'ADMIN', 'u-1'), 404, 'Employee not found');
    });

    it('throws 403 when an EMPLOYEE views someone else', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'emp-1', manager_id: null } as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-other' } as never);

      await expectHttpError(getEmployee('emp-1', 'EMPLOYEE', 'u-1'), 403, 'your own profile');
    });

    it('allows an EMPLOYEE to view their own profile', async () => {
      mocked.employeeFindFirst.mockResolvedValue(employeeRow() as never);
      mocked.employeeFindUnique.mockResolvedValue({ id: 'e1' } as never);

      const profile = (await getEmployee('e1', 'EMPLOYEE', 'u1')) as { id: string };

      expect(profile.id).toBe('e1');
    });

    it('blocks a MANAGER from viewing an unrelated employee', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr' } as never);
      mocked.employeeFindFirst.mockResolvedValue(
        employeeRow({ manager_id: 'someone-else' }) as never,
      );

      await expectHttpError(getEmployee('e1', 'MANAGER', 'u1'), 403);
    });

    it('allows a MANAGER to view a direct report', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr' } as never);
      mocked.employeeFindFirst.mockResolvedValue(employeeRow({ manager_id: 'mgr' }) as never);

      const profile = (await getEmployee('e1', 'MANAGER', 'u1')) as { id: string };

      expect(profile.id).toBe('e1');
    });

    it('restricts sensitive profile fields for a MANAGER', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr' } as never);
      mocked.employeeFindFirst.mockResolvedValue(employeeRow({ manager_id: 'mgr' }) as never);

      const profile = (await getEmployee('e1', 'MANAGER', 'u1')) as Record<string, unknown>;

      expect(profile.salary).toBe('Restricted');
      expect(profile.emergencyContactName).toBe('Restricted');
      expect(profile.nationalId).toBe('masked:dec:nid-enc');
    });

    it('returns the profile with decrypted sensitive fields for HR', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'emp-1',
        first_name: 'Jane',
        national_id_encrypted: 'enc:123',
        salary_encrypted: 'enc:5000',
        _count: { documents: 2 },
      } as never);
      mocked.employeeFindUnique.mockResolvedValue(null);

      const profile = (await getEmployee('emp-1', 'HR_MANAGER', 'u-1')) as Record<string, unknown>;
      expect(mocked.decrypt).toHaveBeenCalledWith('enc:123');
      expect(profile.nationalId).toBe('dec:enc:123');
    });

    it('exposes decrypted profile fields for ADMIN and counts documents', async () => {
      mocked.employeeFindFirst.mockResolvedValue(
        employeeRow({ _count: { documents: 4 } }) as never,
      );

      const profile = (await getEmployee('e1', 'ADMIN', 'u1')) as Record<string, unknown>;

      expect(profile.salary).toBe('dec:sal-enc');
      expect(profile.nationalId).toBe('dec:nid-enc');
      expect(profile.emergencyContactName).toBe('Bob');
      expect(profile.documentCount).toBe(4);
    });

    it('defaults documentCount to zero when _count is absent or empty', async () => {
      mocked.employeeFindFirst.mockResolvedValue(employeeRow() as never);
      const withoutCount = (await getEmployee('e1', 'ADMIN', 'u1')) as { documentCount: number };
      expect(withoutCount.documentCount).toBe(0);

      mocked.employeeFindFirst.mockResolvedValue(employeeRow({ _count: {} }) as never);
      const emptyCount = (await getEmployee('e1', 'ADMIN', 'u1')) as { documentCount: number };
      expect(emptyCount.documentCount).toBe(0);
    });

    it('returns null profile secrets when nothing is encrypted', async () => {
      mocked.employeeFindFirst.mockResolvedValue(
        employeeRow({ national_id_encrypted: null, salary_encrypted: null }) as never,
      );

      const asAdmin = (await getEmployee('e1', 'ADMIN', 'u1')) as Record<string, unknown>;
      expect(asAdmin.nationalId).toBeNull();
      expect(asAdmin.salary).toBeNull();

      mocked.employeeFindUnique.mockResolvedValue({ id: 'e1' } as never);
      const asEmp = (await getEmployee('e1', 'EMPLOYEE', 'u1')) as Record<string, unknown>;
      expect(asEmp.nationalId).toBeNull();
    });
  });

  describe('createEmployee', () => {
    it('throws 409 when the national ID already exists', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'existing' } as never);

      await expectHttpError(
        createEmployee({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          nationalId: 'ID123',
          departmentId: 'dep-1',
          positionId: 'pos-1',
          hireDate: new Date(),
          employmentType: EmploymentType.FULL_TIME,
        }),
        409,
        'national ID already exists',
      );
      expect(mocked.employeeCreate).not.toHaveBeenCalled();
    });

    it('creates an employee with encrypted national ID and salary', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);
      mocked.employeeCount.mockResolvedValue(0);
      mocked.employeeCreate.mockResolvedValue({
        id: 'emp-1',
        employee_no: 'EMP-2026-0001',
      } as never);

      const result = await createEmployee({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'Jane@Example.com',
        nationalId: 'ID123',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        hireDate: new Date(),
        employmentType: EmploymentType.FULL_TIME,
        salary: 5000,
      });

      expect(result).toEqual({ id: 'emp-1', employeeNo: 'EMP-2026-0001' });
      expect(mocked.encrypt).toHaveBeenCalledWith('ID123');
      expect(mocked.encrypt).toHaveBeenCalledWith('5000');
      expect(mocked.employeeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'jane@example.com',
          national_id_encrypted: 'enc:ID123',
          salary_encrypted: 'enc:5000',
          status: EmploymentStatus.NEW_HIRE,
        }),
      });
    });
  });

  describe('updateEmployee', () => {
    it('updates basic fields only for non-HR roles', async () => {
      mocked.employeeUpdate.mockResolvedValue({} as never);

      await updateEmployee('emp-1', { firstName: 'New', salary: 9999 }, 'EMPLOYEE');

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { first_name: 'New' },
      });
    });

    it('maps every non-sensitive field', async () => {
      mocked.employeeUpdate.mockResolvedValue({ id: 'e1' } as never);
      const hireDate = new Date('2025-05-05');
      const dob = new Date('1991-02-02');

      await updateEmployee(
        'e1',
        {
          firstName: 'New',
          lastName: 'Name',
          dateOfBirth: dob,
          gender: Gender.MALE,
          email: 'MiXeD@example.com',
          phone: '555',
          address: 'Elsewhere',
          departmentId: 'd2',
          positionId: 'p2',
          managerId: 'mgr2',
          hireDate,
          employmentType: EmploymentType.PART_TIME,
          status: EmploymentStatus.ON_LEAVE,
        },
        'EMPLOYEE',
      );

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: {
          first_name: 'New',
          last_name: 'Name',
          date_of_birth: dob,
          gender: Gender.MALE,
          email: 'mixed@example.com',
          phone: '555',
          address: 'Elsewhere',
          department_id: 'd2',
          position_id: 'p2',
          manager_id: 'mgr2',
          hire_date: hireDate,
          employment_type: EmploymentType.PART_TIME,
          status: EmploymentStatus.ON_LEAVE,
        },
      });
    });

    it('ignores sensitive fields for a non-privileged role', async () => {
      mocked.employeeUpdate.mockResolvedValue({ id: 'e1' } as never);

      await updateEmployee(
        'e1',
        { nationalId: 'A123', salary: 5000, emergencyContactName: 'Bob' },
        'MANAGER',
      );

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({ where: { id: 'e1' }, data: {} });
    });

    it('updates sensitive fields for HR/Admin roles', async () => {
      mocked.employeeUpdate.mockResolvedValue({} as never);

      await updateEmployee(
        'emp-1',
        { nationalId: 'NEWID', salary: 8000, emergencyContactName: 'Bob' },
        'HR_MANAGER',
      );

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: {
          national_id_encrypted: 'enc:NEWID',
          salary_encrypted: 'enc:8000',
          emergency_contact_name: 'Bob',
          emergency_contact_relationship: undefined,
          emergency_contact_phone: undefined,
        },
      });
    });

    it('encrypts sensitive fields for HR with all emergency contacts', async () => {
      mocked.employeeUpdate.mockResolvedValue({ id: 'e1' } as never);

      await updateEmployee(
        'e1',
        {
          nationalId: 'A123',
          salary: 5000,
          emergencyContactName: 'Bob',
          emergencyContactRelationship: 'Spouse',
          emergencyContactPhone: '999',
        },
        'HR_MANAGER',
      );

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: {
          national_id_encrypted: 'enc:A123',
          salary_encrypted: 'enc:5000',
          emergency_contact_name: 'Bob',
          emergency_contact_relationship: 'Spouse',
          emergency_contact_phone: '999',
        },
      });
    });

    it('clears sensitive fields when explicitly set to empty or null', async () => {
      mocked.employeeUpdate.mockResolvedValue({ id: 'e1' } as never);

      await updateEmployee('e1', { nationalId: '', salary: null as never }, 'ADMIN');

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { national_id_encrypted: null, salary_encrypted: null },
      });
    });

    it('sends an empty payload when nothing is provided', async () => {
      mocked.employeeUpdate.mockResolvedValue({ id: 'e1' } as never);

      await updateEmployee('e1', {}, 'ADMIN');

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({ where: { id: 'e1' }, data: {} });
    });
  });

  describe('transitionStatus', () => {
    it('throws 404 when the employee is missing', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);

      await expectHttpError(
        transitionStatus({
          employeeId: 'emp-x',
          newStatus: EmploymentStatus.ACTIVE,
          effectiveDate: new Date(),
          recordedBy: 'u-1',
        }),
        404,
        'Employee not found',
      );
    });

    it('throws 400 for an invalid transition', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'emp-1', status: 'TERMINATED' } as never);

      await expectHttpError(
        transitionStatus({
          employeeId: 'emp-1',
          newStatus: EmploymentStatus.ACTIVE,
          effectiveDate: new Date(),
          recordedBy: 'u-1',
        }),
        400,
        'Invalid status transition',
      );
    });

    it('rejects an invalid transition', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', status: 'ACTIVE' } as never);

      await expectHttpError(
        transitionStatus({
          employeeId: 'e1',
          newStatus: EmploymentStatus.PROBATION,
          effectiveDate: new Date(),
          recordedBy: 'u1',
        }),
        400,
      );
    });

    it('rejects any transition out of TERMINATED', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', status: 'TERMINATED' } as never);

      await expectHttpError(
        transitionStatus({
          employeeId: 'e1',
          newStatus: EmploymentStatus.ACTIVE,
          effectiveDate: new Date(),
          recordedBy: 'u1',
        }),
        400,
      );
    });

    it('rejects a transition from an unknown status', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', status: 'UNKNOWN' } as never);

      await expectHttpError(
        transitionStatus({
          employeeId: 'e1',
          newStatus: EmploymentStatus.ACTIVE,
          effectiveDate: new Date(),
          recordedBy: 'u1',
        }),
        400,
      );
    });

    it('records a deactivation date when terminating', async () => {
      mocked.employeeUpdate.mockResolvedValue({} as never);
      mocked.employmentChangeCreate.mockResolvedValue({} as never);
      const effectiveDate = new Date('2026-04-01');
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', status: 'ACTIVE' } as never);

      await transitionStatus({
        employeeId: 'e1',
        newStatus: EmploymentStatus.TERMINATED,
        effectiveDate,
        reason: 'Resigned',
        recordedBy: 'u1',
      });

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: EmploymentStatus.TERMINATED, deactivation_date: effectiveDate },
      });
    });

    it('omits the deactivation date for a non-terminating transition', async () => {
      mocked.employeeUpdate.mockResolvedValue({} as never);
      mocked.employmentChangeCreate.mockResolvedValue({} as never);
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', status: 'NEW_HIRE' } as never);

      await transitionStatus({
        employeeId: 'e1',
        newStatus: EmploymentStatus.PROBATION,
        effectiveDate: new Date(),
        recordedBy: 'u1',
      });

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: EmploymentStatus.PROBATION },
      });
      expect(mocked.employmentChangeCreate).toHaveBeenCalled();
    });

    it('records the status change and updates the employee for a valid transition', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'emp-1', status: 'PROBATION' } as never);
      mocked.employeeUpdate.mockResolvedValue({} as never);
      mocked.employmentChangeCreate.mockResolvedValue({} as never);

      await transitionStatus({
        employeeId: 'emp-1',
        newStatus: EmploymentStatus.ACTIVE,
        effectiveDate: new Date(),
        recordedBy: 'u-1',
      });

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { status: EmploymentStatus.ACTIVE },
      });
      expect(mocked.employmentChangeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          change_type: 'STATUS_CHANGE',
          old_value: { status: 'PROBATION' },
          new_value: { status: EmploymentStatus.ACTIVE },
          status: 'APPLIED',
          recorded_by: 'u-1',
        }),
      });
    });
  });

  describe('createEmployee', () => {
    it('uses NEW_HIRE status and skips national ID check when absent', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);
      mocked.employeeCount.mockResolvedValue(3);
      mocked.employeeCreate.mockResolvedValue({
        id: 'emp-2',
        employee_no: 'EMP-2026-0004',
      } as never);

      const result = await createEmployee({
        firstName: 'Bob',
        lastName: 'Smith',
        email: 'bob@example.com',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        hireDate: new Date('2026-01-01'),
        employmentType: EmploymentType.CONTRACTOR,
      });

      expect(result).toEqual({ id: 'emp-2', employeeNo: 'EMP-2026-0004' });
      // No duplicate-national-id lookup happened because nationalId was omitted.
      expect(mocked.employeeFindFirst).not.toHaveBeenCalled();
      expect(mocked.employeeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employee_no: 'EMP-2026-0004',
          status: EmploymentStatus.NEW_HIRE,
          national_id_encrypted: null,
          salary_encrypted: null,
        }),
      });
    });

    it('generates the employee number based on the current year count', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);
      mocked.employeeCount.mockResolvedValue(41);
      mocked.employeeCreate.mockResolvedValue({ id: 'emp-3', employee_no: 'EMP-' } as never);

      await createEmployee({
        firstName: 'Carol',
        lastName: 'Ng',
        email: 'carol@example.com',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        hireDate: new Date(),
        employmentType: EmploymentType.FULL_TIME,
      });

      const expectedYear = new Date().getFullYear();
      expect(mocked.employeeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ employee_no: `EMP-${expectedYear}-0042` }),
      });
    });

    it('lowercases the email when persisting', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);
      mocked.employeeCount.mockResolvedValue(0);
      mocked.employeeCreate.mockResolvedValue({
        id: 'emp-4',
        employee_no: 'EMP-2026-0001',
      } as never);

      await createEmployee({
        firstName: 'Dan',
        lastName: 'Brown',
        email: 'Dan.Brown@Example.COM',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        hireDate: new Date(),
        employmentType: EmploymentType.FULL_TIME,
      });

      expect(mocked.employeeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: 'dan.brown@example.com' }),
      });
    });
  });

  describe('listEmployees', () => {
    it('applies the manager scope plus search filter for a MANAGER without dropping scope', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr' } as never);
      mocked.employeeFindMany.mockResolvedValue([] as never);

      await listEmployees({ role: 'MANAGER', userId: 'u1', search: 'lee' });

      const where = mocked.employeeFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(Array.isArray(where.OR)).toBe(true);
      // 2 scope clauses remain and 5 search clauses are appended.
      expect((where.OR as unknown[]).length).toBe(7);
      expect(where.OR).toContainEqual({ manager_id: 'mgr' });
      expect(where.OR).toContainEqual({ id: 'mgr' });
    });

    it('maps manager scope into empty result when no employee record for MANAGER', async () => {
      mocked.employeeFindUnique.mockResolvedValue(null as never);

      const result = await listEmployees({ role: 'MANAGER', userId: 'u1', departmentId: 'd1' });
      expect(result).toEqual([]);
      expect(mocked.employeeFindMany).not.toHaveBeenCalled();
    });
  });

  describe('selfUpdateEmployee', () => {
    const baseSelfParams = {
      employeeId: 'e1',
      userId: 'u1',
      userEmail: 'me@example.com',
    };

    function selfRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'e1',
        user_id: 'u1',
        phone: '',
        address: '',
        emergency_contact_name: '',
        emergency_contact_relationship: '',
        emergency_contact_phone: '',
        ...overrides,
      };
    }

    it('throws 404 when the employee does not exist', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);

      await expectHttpError(
        selfUpdateEmployee({ ...baseSelfParams, fields: { phone: '1234567' } }),
        404,
        'Employee not found',
      );
      expect(mocked.employeeUpdate).not.toHaveBeenCalled();
    });

    it('throws 403 when the employee belongs to another user', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow({ user_id: 'other' }));

      await expectHttpError(
        selfUpdateEmployee({ ...baseSelfParams, fields: { phone: '1234567' } }),
        403,
        'your own profile',
      );
      expect(mocked.employeeUpdate).not.toHaveBeenCalled();
    });

    it('returns early without an update when no fields are supplied', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow());

      await selfUpdateEmployee({ ...baseSelfParams, fields: {} });

      expect(mocked.employeeUpdate).not.toHaveBeenCalled();
      expect(mocked.logAuditEvent).not.toHaveBeenCalled();
    });

    it('rejects an invalid phone number format', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow());

      await expectHttpError(
        selfUpdateEmployee({ ...baseSelfParams, fields: { phone: 'abc' } }),
        400,
        'Phone number format is invalid',
      );
    });

    it('rejects emptying a previously-set phone number', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow({ phone: '1234567' }));

      await expectHttpError(
        selfUpdateEmployee({ ...baseSelfParams, fields: { phone: '   ' } }),
        400,
        'Phone cannot be emptied',
      );
    });

    it('rejects emptying a previously-set address', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow({ address: 'Old St' }));

      await expectHttpError(
        selfUpdateEmployee({ ...baseSelfParams, fields: { address: '' } }),
        400,
        'Address cannot be emptied',
      );
    });

    it('rejects emptying a previously-set emergency contact name', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow({ emergency_contact_name: 'Bob' }));

      await expectHttpError(
        selfUpdateEmployee({ ...baseSelfParams, fields: { emergencyContactName: '' } }),
        400,
        'Emergency contact name cannot be emptied',
      );
    });

    it('rejects emptying a previously-set emergency contact relationship', async () => {
      mocked.employeeFindFirst.mockResolvedValue(
        selfRow({ emergency_contact_relationship: 'Spouse' }),
      );

      await expectHttpError(
        selfUpdateEmployee({ ...baseSelfParams, fields: { emergencyContactRelationship: ' ' } }),
        400,
        'Emergency contact relationship cannot be emptied',
      );
    });

    it('rejects emptying a previously-set emergency contact phone', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow({ emergency_contact_phone: '1234567' }));

      await expectHttpError(
        selfUpdateEmployee({ ...baseSelfParams, fields: { emergencyContactPhone: ' ' } }),
        400,
        'Emergency contact phone cannot be emptied',
      );
    });

    it('rejects an invalid emergency contact phone format', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow());

      await expectHttpError(
        selfUpdateEmployee({ ...baseSelfParams, fields: { emergencyContactPhone: 'xx' } }),
        400,
        'Emergency contact phone format is invalid',
      );
    });

    it('accepts setting phone from empty when previously unset', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow());
      mocked.employeeUpdate.mockResolvedValue({} as never);

      await selfUpdateEmployee({ ...baseSelfParams, fields: { phone: '+1 (555) 123-4567' } });

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { phone: '+1 (555) 123-4567' },
      });
      expect(mocked.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'e1',
          oldValue: { phone: '' },
          newValue: { phone: '+1 (555) 123-4567' },
        }),
      );
    });

    it('clears a phone value to null when set to whitespace after being empty', async () => {
      mocked.employeeFindFirst.mockResolvedValue(selfRow());
      mocked.employeeUpdate.mockResolvedValue({} as never);

      await selfUpdateEmployee({ ...baseSelfParams, fields: { phone: '   ' } });

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { phone: null },
      });
    });

    it('updates multiple self-service fields and logs old/new values', async () => {
      mocked.employeeFindFirst.mockResolvedValue(
        selfRow({ phone: '111', address: 'Old', emergency_contact_name: 'Bob' }),
      );
      mocked.employeeUpdate.mockResolvedValue({} as never);

      await selfUpdateEmployee({
        ...baseSelfParams,
        fields: {
          phone: '2223333',
          address: 'New',
          emergencyContactName: 'Alice',
          emergencyContactRelationship: 'Friend',
          emergencyContactPhone: '4445555',
        },
      });

      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: {
          phone: '2223333',
          address: 'New',
          emergency_contact_name: 'Alice',
          emergency_contact_relationship: 'Friend',
          emergency_contact_phone: '4445555',
        },
      });
      expect(mocked.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          oldValue: expect.objectContaining({ phone: '111', address: 'Old' }),
          newValue: expect.objectContaining({ phone: '2223333', address: 'New' }),
        }),
      );
    });
  });

  describe('setAvatar', () => {
    const baseAvatarParams = {
      employeeId: 'e1',
      userId: 'u1',
      userEmail: 'me@example.com',
      filePath: '/tmp/avatar.png',
      storedFilename: 'avatar-123.png',
    };

    it('throws 404 when the employee does not exist', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);

      await expectHttpError(setAvatar(baseAvatarParams), 404, 'Employee not found');
      expect(mocked.employeeUpdate).not.toHaveBeenCalled();
    });

    it('throws 403 when the avatar belongs to another user', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', user_id: 'other', avatar_url: null });

      await expectHttpError(setAvatar(baseAvatarParams), 403, 'your own avatar');
      expect(mocked.employeeUpdate).not.toHaveBeenCalled();
    });

    it('sets the avatar url without deleting when none existed before', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', user_id: 'u1', avatar_url: null });
      mocked.employeeUpdate.mockResolvedValue({} as never);

      const avatarUrl = await setAvatar(baseAvatarParams);

      expect(avatarUrl).toBe('/api/employees/e1/avatar');
      expect(mocked.fsUnlink).not.toHaveBeenCalled();
      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { avatar_url: '/api/employees/e1/avatar' },
      });
      expect(mocked.logAuditEvent).toHaveBeenCalled();
    });

    it('deletes the previous avatar file when one existed', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'u1',
        avatar_url: '/api/employees/e1/avatar/old-9.png',
      });
      mocked.employeeUpdate.mockResolvedValue({} as never);

      await setAvatar(baseAvatarParams);

      expect(mocked.fsUnlink).toHaveBeenCalledWith('/uploads/avatars/old-9.png');
    });

    it('ignores a file-delete error for the previous avatar', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'u1',
        avatar_url: '/api/employees/e1/avatar/old-9.png',
      });
      mocked.employeeUpdate.mockResolvedValue({} as never);
      mocked.fsUnlink.mockRejectedValueOnce(new Error('ENOENT'));

      // Should not throw.
      const avatarUrl = await setAvatar(baseAvatarParams);
      expect(avatarUrl).toBe('/api/employees/e1/avatar');
    });
  });

  describe('removeAvatar', () => {
    const baseRemoveParams = {
      employeeId: 'e1',
      userId: 'u1',
      userEmail: 'me@example.com',
    };

    it('throws 404 when the employee does not exist', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);

      await expectHttpError(removeAvatar(baseRemoveParams), 404, 'Employee not found');
      expect(mocked.employeeUpdate).not.toHaveBeenCalled();
    });

    it('throws 403 when removing another user avatar', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', user_id: 'other', avatar_url: 'x' });

      await expectHttpError(removeAvatar(baseRemoveParams), 403, 'your own avatar');
      expect(mocked.employeeUpdate).not.toHaveBeenCalled();
    });

    it('returns without changes when there is no avatar to remove', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', user_id: 'u1', avatar_url: null });

      await removeAvatar(baseRemoveParams);

      expect(mocked.employeeUpdate).not.toHaveBeenCalled();
      expect(mocked.fsUnlink).not.toHaveBeenCalled();
    });

    it('removes the avatar and deletes the file for a self-owned avatar', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'u1',
        avatar_url: '/api/employees/e1/avatar/pic-1.jpg',
      });
      mocked.employeeUpdate.mockResolvedValue({} as never);

      await removeAvatar(baseRemoveParams);

      expect(mocked.fsUnlink).toHaveBeenCalledWith('/uploads/avatars/pic-1.jpg');
      expect(mocked.employeeUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { avatar_url: null },
      });
      expect(mocked.logAuditEvent).toHaveBeenCalled();
    });

    it('ignores a file-delete error during removal', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'u1',
        avatar_url: '/api/employees/e1/avatar/pic-1.jpg',
      });
      mocked.employeeUpdate.mockResolvedValue({} as never);
      mocked.fsUnlink.mockRejectedValueOnce(new Error('ENOENT'));

      await removeAvatar(baseRemoveParams);
      expect(mocked.employeeUpdate).toHaveBeenCalled();
    });
  });

  describe('getAvatarPath', () => {
    const baseGetParams = { employeeId: 'e1', userId: 'u1', role: 'ADMIN' };

    it('returns null when the employee is missing', async () => {
      mocked.employeeFindFirst.mockResolvedValue(null);

      expect(await getAvatarPath(baseGetParams)).toBeNull();
    });

    it('returns null when the employee has no avatar', async () => {
      mocked.employeeFindFirst.mockResolvedValue({ id: 'e1', user_id: 'u1', avatar_url: null });

      expect(await getAvatarPath(baseGetParams)).toBeNull();
    });

    it('throws 403 when an EMPLOYEE views another employee avatar', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'other',
        avatar_url: '/api/employees/e1/avatar/pic.png',
      });

      await expectHttpError(
        getAvatarPath({ ...baseGetParams, role: 'EMPLOYEE' }),
        403,
        'Access denied',
      );
    });

    it('allows an EMPLOYEE to view their own avatar', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'u1',
        avatar_url: '/api/employees/e1/avatar/pic.png',
      });

      const result = await getAvatarPath({ ...baseGetParams, role: 'EMPLOYEE' });
      expect(result).toEqual({ filePath: '/uploads/avatars/pic.png', mimeType: 'image/png' });
    });

    it('throws 403 for a MANAGER viewing an unrelated employee', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'someone',
        avatar_url: '/api/employees/e1/avatar/pic.jpg',
        manager_id: 'another',
      });
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr' });

      await expectHttpError(
        getAvatarPath({ ...baseGetParams, role: 'MANAGER' }),
        403,
        'Access denied',
      );
    });

    it('allows a MANAGER to view a direct report avatar', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'report',
        avatar_url: '/api/employees/e1/avatar/pic.webp',
        manager_id: 'mgr',
      });
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr' });

      const result = await getAvatarPath({ ...baseGetParams, role: 'MANAGER' });
      expect(result).toEqual({ filePath: '/uploads/avatars/pic.webp', mimeType: 'image/webp' });
    });

    it('blocks a MANAGER from viewing their own avatar when not a direct report', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'mgr',
        avatar_url: '/api/employees/e1/avatar/pic.png',
        manager_id: undefined,
      });
      mocked.employeeFindUnique.mockResolvedValue({ id: 'mgr' });

      await expectHttpError(
        getAvatarPath({ ...baseGetParams, role: 'MANAGER' }),
        403,
        'Access denied',
      );
    });

    it('maps jpg extension to image/jpeg and handles no extension gracefully', async () => {
      mocked.employeeFindFirst.mockResolvedValue({
        id: 'e1',
        user_id: 'u1',
        avatar_url: '/api/employees/e1/avatar/pic.JPG',
      });

      const result = await getAvatarPath(baseGetParams);
      expect(result?.mimeType).toBe('image/jpeg');
    });
  });
});
