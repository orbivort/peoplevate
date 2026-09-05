import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

/**
 * Every repository method the data layer touches is mocked here so the tests
 * exercise data-layer logic (mode resolution, fallback, enum mapping, payload
 * shaping) without any network access.
 */
const hoisted = vi.hoisted(() => ({
  employeeList: vi.fn(),
  employeeCreate: vi.fn(),
  employeeUpdate: vi.fn(),
  departmentList: vi.fn(),
  departmentCreate: vi.fn(),
  departmentUpdate: vi.fn(),
  departmentDelete: vi.fn(),
  positionList: vi.fn(),
  positionCreate: vi.fn(),
  positionUpdate: vi.fn(),
  positionDelete: vi.fn(),
  userList: vi.fn(),
  userInvite: vi.fn(),
  userChangeRole: vi.fn(),
  userChangeStatus: vi.fn(),
  userResetPassword: vi.fn(),
  userDelete: vi.fn(),
  auditLogList: vi.fn(),
  alertList: vi.fn(),
  documentListByEmployee: vi.fn(),
  retentionListPolicies: vi.fn(),
  retentionUpsertPolicy: vi.fn(),
  retentionPurge: vi.fn(),
  retentionPlaceLegalHold: vi.fn(),
  retentionReleaseLegalHold: vi.fn(),
  dsarList: vi.fn(),
  dsarCreate: vi.fn(),
  dsarUpdateStatus: vi.fn(),
  breachList: vi.fn(),
  breachGet: vi.fn(),
  breachCreate: vi.fn(),
  breachUpdate: vi.fn(),
  breachRecordNotification: vi.fn(),
  breachGetTemplate: vi.fn(),
  anomalyList: vi.fn(),
  anomalyDismiss: vi.fn(),
  consentList: vi.fn(),
  consentRecord: vi.fn(),
  consentWithdraw: vi.fn(),
  keyListVersions: vi.fn(),
  keyStatus: vi.fn(),
  keyRotate: vi.fn(),
}));

vi.mock('@/lib/api/repositories', () => ({
  employeeRepo: {
    list: (...args: unknown[]) => hoisted.employeeList(...args),
    create: (...args: unknown[]) => hoisted.employeeCreate(...args),
    update: (...args: unknown[]) => hoisted.employeeUpdate(...args),
  },
  departmentRepo: {
    list: (...args: unknown[]) => hoisted.departmentList(...args),
    create: (...args: unknown[]) => hoisted.departmentCreate(...args),
    update: (...args: unknown[]) => hoisted.departmentUpdate(...args),
    delete: (...args: unknown[]) => hoisted.departmentDelete(...args),
  },
  positionRepo: {
    list: (...args: unknown[]) => hoisted.positionList(...args),
    create: (...args: unknown[]) => hoisted.positionCreate(...args),
    update: (...args: unknown[]) => hoisted.positionUpdate(...args),
    delete: (...args: unknown[]) => hoisted.positionDelete(...args),
  },
  userRepo: {
    list: (...args: unknown[]) => hoisted.userList(...args),
    invite: (...args: unknown[]) => hoisted.userInvite(...args),
    changeRole: (...args: unknown[]) => hoisted.userChangeRole(...args),
    changeStatus: (...args: unknown[]) => hoisted.userChangeStatus(...args),
    resetPassword: (...args: unknown[]) => hoisted.userResetPassword(...args),
    delete: (...args: unknown[]) => hoisted.userDelete(...args),
  },
  auditLogRepo: { list: (...args: unknown[]) => hoisted.auditLogList(...args) },
  alertRepo: { list: (...args: unknown[]) => hoisted.alertList(...args) },
  documentRepo: {
    listByEmployee: (...args: unknown[]) => hoisted.documentListByEmployee(...args),
  },
  retentionRepo: {
    listPolicies: (...args: unknown[]) => hoisted.retentionListPolicies(...args),
    upsertPolicy: (...args: unknown[]) => hoisted.retentionUpsertPolicy(...args),
    purge: (...args: unknown[]) => hoisted.retentionPurge(...args),
    placeLegalHold: (...args: unknown[]) => hoisted.retentionPlaceLegalHold(...args),
    releaseLegalHold: (...args: unknown[]) => hoisted.retentionReleaseLegalHold(...args),
  },
  dsarRepo: {
    list: (...args: unknown[]) => hoisted.dsarList(...args),
    create: (...args: unknown[]) => hoisted.dsarCreate(...args),
    updateStatus: (...args: unknown[]) => hoisted.dsarUpdateStatus(...args),
  },
  breachRepo: {
    list: (...args: unknown[]) => hoisted.breachList(...args),
    get: (...args: unknown[]) => hoisted.breachGet(...args),
    create: (...args: unknown[]) => hoisted.breachCreate(...args),
    update: (...args: unknown[]) => hoisted.breachUpdate(...args),
    recordNotification: (...args: unknown[]) => hoisted.breachRecordNotification(...args),
    getTemplate: (...args: unknown[]) => hoisted.breachGetTemplate(...args),
  },
  anomalyRepo: {
    list: (...args: unknown[]) => hoisted.anomalyList(...args),
    dismiss: (...args: unknown[]) => hoisted.anomalyDismiss(...args),
  },
  consentRepo: {
    list: (...args: unknown[]) => hoisted.consentList(...args),
    record: (...args: unknown[]) => hoisted.consentRecord(...args),
    withdraw: (...args: unknown[]) => hoisted.consentWithdraw(...args),
  },
  keyRepo: {
    listVersions: (...args: unknown[]) => hoisted.keyListVersions(...args),
    status: (...args: unknown[]) => hoisted.keyStatus(...args),
    rotate: (...args: unknown[]) => hoisted.keyRotate(...args),
  },
}));

import {
  adminResetPassword,
  changeUserRole,
  changeUserStatus,
  createDepartment,
  createEmployee,
  createPosition,
  deleteDepartment,
  deletePosition,
  deleteUser,
  getAuditLog,
  getDepartments,
  getDocuments,
  getEmployees,
  getExpiryAlerts,
  getPositions,
  getUsers,
  inviteUser,
  isRealBackend,
  mapRole,
  toBackendRole,
  toBackendStatus,
  updateDepartment,
  updateEmployee,
  updatePosition,
  useAuditLog,
  useData,
  useDepartments,
  useDocuments,
  useEmployees,
  useExpiryAlerts,
  usePositions,
  useUsers,
  getRetentionPolicies,
  upsertRetentionPolicy,
  runRetentionPurge,
  placeLegalHold,
  releaseLegalHold,
  getDsars,
  createDsar,
  updateDsarStatus,
  getBreaches,
  createBreach,
  updateBreach,
  recordBreachNotification,
  getAnomalyAlerts,
  dismissAnomaly,
  getConsentRecords,
  recordConsent,
  withdrawConsent,
  getKeyVersions,
  rotateKey,
} from './data-layer';
import { config } from '@/lib/config';
import { ApiError } from '@/lib/api-client';
import {
  documents as mockDocuments,
  mockRetentionPolicies,
  mockDsars,
  mockBreaches,
  mockAnomalyAlerts,
  mockConsentRecords,
  mockKeyVersions,
} from '@/data/mock-data';

/** `config` is declared `as const`, so tests cast it to flip the mock flag. */
const mutableConfig = config as { useMock: boolean };

describe('data-layer mappers', () => {
  it('mapRole maps backend roles', () => {
    expect(mapRole('ADMIN')).toBe('Admin');
    expect(mapRole('HR_MANAGER')).toBe('HR Manager');
    expect(mapRole('MANAGER')).toBe('Manager');
    expect(mapRole('EMPLOYEE')).toBe('Employee');
    expect(mapRole('unknown')).toBe('Employee');
    expect(mapRole(null)).toBe('Employee');
  });

  it('mapRole is case-insensitive and tolerates undefined/empty input', () => {
    expect(mapRole('admin')).toBe('Admin');
    expect(mapRole('hr_manager')).toBe('HR Manager');
    expect(mapRole(undefined)).toBe('Employee');
    expect(mapRole('')).toBe('Employee');
  });

  it('mapRole also accepts frontend label formats (used by mock mode)', () => {
    expect(mapRole('HR Manager')).toBe('HR Manager');
    expect(mapRole('HR MANAGER')).toBe('HR Manager');
    expect(mapRole('hr manager')).toBe('HR Manager');
    expect(mapRole('Admin')).toBe('Admin');
    expect(mapRole('Manager')).toBe('Manager');
    expect(mapRole('Employee')).toBe('Employee');
  });

  it('toBackendRole maps labels', () => {
    expect(toBackendRole('Admin')).toBe('ADMIN');
    expect(toBackendRole('HR Manager')).toBe('HR_MANAGER');
    expect(toBackendRole('Manager')).toBe('MANAGER');
    expect(toBackendRole('Employee')).toBe('EMPLOYEE');
    expect(toBackendRole('Weird' as never)).toBe('EMPLOYEE');
  });

  it('toBackendStatus maps statuses', () => {
    expect(toBackendStatus('active')).toBe('ACTIVE');
    expect(toBackendStatus('deactivated')).toBe('DEACTIVATED');
    expect(toBackendStatus('pending_setup')).toBe('PENDING_SETUP');
    expect(toBackendStatus('weird' as never)).toBe('ACTIVE');
  });

  it('mapRole and toBackendRole round-trip every known role', () => {
    for (const backend of ['ADMIN', 'HR_MANAGER', 'MANAGER', 'EMPLOYEE']) {
      expect(toBackendRole(mapRole(backend))).toBe(backend);
    }
  });

  it('isRealBackend reflects config', () => {
    const prev = config.useMock;
    mutableConfig.useMock = true;
    expect(isRealBackend()).toBe(false);
    mutableConfig.useMock = false;
    expect(isRealBackend()).toBe(true);
    mutableConfig.useMock = prev;
  });
});

describe('data-layer getters (mock mode)', () => {
  const prev = config.useMock;
  beforeEach(() => {
    mutableConfig.useMock = true;
    vi.clearAllMocks();
    // In mock mode the data layer calls the repository (the MSW-intercepted
    // path). In unit tests MSW is not running, so the repos reject and the
    // layer falls back to the static mock array.
    hoisted.employeeList.mockRejectedValue(new Error('msw not running'));
    hoisted.departmentList.mockRejectedValue(new Error('msw not running'));
    hoisted.positionList.mockRejectedValue(new Error('msw not running'));
    hoisted.userList.mockRejectedValue(new Error('msw not running'));
    hoisted.auditLogList.mockRejectedValue(new Error('msw not running'));
    hoisted.alertList.mockRejectedValue(new Error('msw not running'));
    hoisted.documentListByEmployee.mockRejectedValue(new Error('msw not running'));
  });
  afterEach(() => {
    mutableConfig.useMock = prev;
  });

  it('getEmployees returns mock data', async () => {
    const { data, mode } = await getEmployees();
    expect(mode).toBe('mock');
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('getDepartments returns mock data', async () => {
    const { mode, data } = await getDepartments();
    expect(mode).toBe('mock');
    expect(data.length).toBeGreaterThan(0);
  });

  it('getPositions returns mock data', async () => {
    const { mode, data } = await getPositions();
    expect(mode).toBe('mock');
    expect(data.length).toBeGreaterThan(0);
  });

  it('getUsers returns mock data', async () => {
    const { mode, data } = await getUsers();
    expect(mode).toBe('mock');
    expect(data.length).toBeGreaterThan(0);
  });

  it('getAuditLog returns mock data', async () => {
    const { mode, data } = await getAuditLog({ page: 1, pageSize: 25 });
    expect(mode).toBe('mock');
    expect(data.logs.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);
  });

  it('getAuditLog filters mock data by user', async () => {
    const { data } = await getAuditLog({ page: 1, pageSize: 25, user: 'emily' });
    expect(data.logs.length).toBeGreaterThan(0);
    // Every returned entry belongs to Emily Doe (by name or id u-hr).
    expect(data.logs.every((e) => e.actorName.toLowerCase().includes('emily'))).toBe(true);
  });

  it('getAuditLog filters mock data by date range', async () => {
    // No entries fall within 2019; the result must be empty.
    const { data } = await getAuditLog({
      page: 1,
      pageSize: 25,
      from: '2019-01-01',
      to: '2019-12-31',
    });
    expect(data.logs).toHaveLength(0);
    expect(data.total).toBe(0);
  });

  it('getExpiryAlerts returns mock data', async () => {
    const { mode, data } = await getExpiryAlerts();
    expect(mode).toBe('mock');
    expect(Array.isArray(data)).toBe(true);
  });

  it('getDocuments filters by employee', async () => {
    const { mode, data } = await getDocuments('1');
    expect(mode).toBe('mock');
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((d) => d.employeeId === '1')).toBe(true);
    expect(data).toHaveLength(mockDocuments.filter((d) => d.employeeId === '1').length);
  });

  it('getDocuments returns an empty list for an unknown employee', async () => {
    const { mode, data } = await getDocuments('no-such-employee');
    expect(mode).toBe('mock');
    expect(data).toEqual([]);
  });

  it('calls the repository in mock mode and falls back to mock data when MSW is not running', async () => {
    await Promise.all([
      getEmployees(),
      getDepartments(),
      getPositions(),
      getUsers(),
      getAuditLog({ page: 1, pageSize: 25 }),
      getExpiryAlerts(),
      getDocuments('1'),
    ]);
    // In mock mode the data layer routes through the repository (the
    // MSW-intercepted path). When MSW is not running (unit tests), the repos
    // reject and the layer falls back to the static mock array.
    expect(hoisted.employeeList).toHaveBeenCalled();
    expect(hoisted.departmentList).toHaveBeenCalled();
    expect(hoisted.positionList).toHaveBeenCalled();
    expect(hoisted.userList).toHaveBeenCalled();
    expect(hoisted.auditLogList).toHaveBeenCalled();
    expect(hoisted.alertList).toHaveBeenCalled();
    expect(hoisted.documentListByEmployee).toHaveBeenCalled();
  });
});

describe('data-layer getters (api mode)', () => {
  const prev = config.useMock;

  beforeEach(() => {
    mutableConfig.useMock = false;
    vi.clearAllMocks();
  });
  afterEach(() => {
    mutableConfig.useMock = prev;
    vi.restoreAllMocks();
  });

  it('getEmployees returns api mode on success', async () => {
    hoisted.employeeList.mockResolvedValueOnce([{ id: '1', firstName: 'Ada' }]);
    const { mode, data } = await getEmployees();
    expect(mode).toBe('api');
    expect(data).toEqual([{ id: '1', firstName: 'Ada' }]);
    expect(hoisted.employeeList).toHaveBeenCalledTimes(1);
  });

  it('getDepartments returns api mode on success', async () => {
    hoisted.departmentList.mockResolvedValueOnce([{ id: 1, name: 'X' }]);
    const { mode, data } = await getDepartments();
    expect(mode).toBe('api');
    expect(data[0]?.name).toBe('X');
  });

  it('getPositions returns api mode on success', async () => {
    hoisted.positionList.mockResolvedValueOnce([{ id: 'p1', title: 'Engineer' }]);
    const { mode, data } = await getPositions();
    expect(mode).toBe('api');
    expect(data).toHaveLength(1);
  });

  it('getUsers returns api mode on success', async () => {
    hoisted.userList.mockResolvedValueOnce([{ id: 'u1', email: 'a@example.com' }]);
    const { mode, data } = await getUsers();
    expect(mode).toBe('api');
    expect(data).toHaveLength(1);
  });

  it('getAuditLog returns api mode on success', async () => {
    hoisted.auditLogList.mockResolvedValueOnce({
      logs: [{ id: 'a1', action: 'CREATE' }],
      total: 1,
    });
    const { mode, data } = await getAuditLog({ page: 1, pageSize: 25 });
    expect(mode).toBe('api');
    expect(data.logs).toHaveLength(1);
    expect(data.total).toBe(1);
  });

  it('getExpiryAlerts returns api mode on success', async () => {
    hoisted.alertList.mockResolvedValueOnce([{ id: 'al1', type: 'contract' }]);
    const { mode, data } = await getExpiryAlerts();
    expect(mode).toBe('api');
    expect(data).toHaveLength(1);
  });

  it('getDocuments passes the employee id through to the repository', async () => {
    hoisted.documentListByEmployee.mockResolvedValueOnce([{ id: 'd1', employeeId: '7' }]);
    const { mode, data } = await getDocuments('7');
    expect(mode).toBe('api');
    expect(data).toHaveLength(1);
    expect(hoisted.documentListByEmployee).toHaveBeenCalledWith('7');
  });

  it('returns an empty api result without falling back to mock data', async () => {
    hoisted.employeeList.mockResolvedValueOnce([]);
    const { mode, data } = await getEmployees();
    expect(mode).toBe('api');
    expect(data).toEqual([]);
  });
});

describe('data-layer getters (fallback behaviour)', () => {
  const prev = config.useMock;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mutableConfig.useMock = false;
    vi.clearAllMocks();
    // The fallback path logs a warning; silence it to keep test output clean.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    mutableConfig.useMock = prev;
    vi.restoreAllMocks();
  });

  it('falls back to mock when API throws non-auth error', async () => {
    hoisted.employeeList.mockRejectedValueOnce(new Error('network down'));
    const { mode, data } = await getEmployees();
    expect(mode).toBe('fallback');
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('falls back on a 500 ApiError (genuine server unavailability)', async () => {
    hoisted.departmentList.mockRejectedValueOnce(new ApiError(500, 'server error'));
    const { mode, data } = await getDepartments();
    expect(mode).toBe('fallback');
    expect(data.length).toBeGreaterThan(0);
  });

  it('falls back on a network-level ApiError (status 0)', async () => {
    hoisted.positionList.mockRejectedValueOnce(new ApiError(0, 'unreachable'));
    const { mode } = await getPositions();
    expect(mode).toBe('fallback');
  });

  it('falls back on a 404 ApiError (missing endpoint)', async () => {
    hoisted.auditLogList.mockRejectedValueOnce(new ApiError(404, 'not found'));
    const { mode, data } = await getAuditLog({ page: 1, pageSize: 25 });
    expect(mode).toBe('fallback');
    expect(data.logs.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);
  });

  it('getDocuments falls back to the employee-filtered mock slice', async () => {
    hoisted.documentListByEmployee.mockRejectedValueOnce(new Error('boom'));
    const { mode, data } = await getDocuments('1');
    expect(mode).toBe('fallback');
    expect(data.every((d) => d.employeeId === '1')).toBe(true);
  });

  it('propagates auth errors (401) without fallback', async () => {
    hoisted.employeeList.mockRejectedValueOnce(new ApiError(401, 'unauthorized'));
    await expect(getEmployees()).rejects.toThrow('unauthorized');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('propagates auth errors (403) without fallback', async () => {
    hoisted.userList.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    await expect(getUsers()).rejects.toBeInstanceOf(ApiError);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back for a plain Error carrying a 401 status (not an ApiError)', async () => {
    // Only genuine ApiError instances are treated as auth failures.
    const err = Object.assign(new Error('unauthorized'), { status: 401 });
    hoisted.alertList.mockRejectedValueOnce(err);
    const { mode } = await getExpiryAlerts();
    expect(mode).toBe('fallback');
  });
});

describe('data-layer write operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('employees', () => {
    it('createEmployee forwards the payload and returns the created identifiers', async () => {
      const created = { id: 'e1', employeeNo: 'EMP-001' };
      hoisted.employeeCreate.mockResolvedValueOnce(created);
      const payload = {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        departmentId: 'd1',
        positionId: 'p1',
        hireDate: '2024-01-15',
        employmentType: 'FULL_TIME',
      };
      await expect(createEmployee(payload)).resolves.toEqual(created);
      expect(hoisted.employeeCreate).toHaveBeenCalledWith(payload);
    });

    it('createEmployee propagates repository errors (no mock fallback for writes)', async () => {
      hoisted.employeeCreate.mockRejectedValueOnce(new ApiError(400, 'validation failed'));
      await expect(
        createEmployee({
          firstName: 'A',
          lastName: 'B',
          email: 'bad',
          departmentId: 'd1',
          positionId: 'p1',
          hireDate: '2024-01-01',
          employmentType: 'FULL_TIME',
        }),
      ).rejects.toThrow('validation failed');
    });

    it('updateEmployee forwards id and payload and resolves to undefined', async () => {
      hoisted.employeeUpdate.mockResolvedValueOnce({ message: 'ok' });
      await expect(updateEmployee('e1', { firstName: 'Emily' })).resolves.toBeUndefined();
      expect(hoisted.employeeUpdate).toHaveBeenCalledWith('e1', { firstName: 'Emily' });
    });

    it('updateEmployee propagates repository errors', async () => {
      hoisted.employeeUpdate.mockRejectedValueOnce(new Error('conflict'));
      await expect(updateEmployee('e1', {})).rejects.toThrow('conflict');
    });
  });

  describe('departments', () => {
    it('createDepartment returns the created department', async () => {
      const created = { id: 'd9', name: 'R&D' };
      hoisted.departmentCreate.mockResolvedValueOnce(created);
      await expect(createDepartment({ name: 'R&D' })).resolves.toEqual(created);
      expect(hoisted.departmentCreate).toHaveBeenCalledWith({ name: 'R&D' });
    });

    it('createDepartment propagates repository errors', async () => {
      hoisted.departmentCreate.mockRejectedValueOnce(new ApiError(409, 'duplicate name'));
      await expect(createDepartment({ name: 'Dup' })).rejects.toThrow('duplicate name');
    });

    it('updateDepartment forwards id and payload', async () => {
      hoisted.departmentUpdate.mockResolvedValueOnce({});
      await expect(
        updateDepartment('d1', { name: 'Ops', parentId: null }),
      ).resolves.toBeUndefined();
      expect(hoisted.departmentUpdate).toHaveBeenCalledWith('d1', { name: 'Ops', parentId: null });
    });

    it('deleteDepartment forwards the id', async () => {
      hoisted.departmentDelete.mockResolvedValueOnce({ message: 'deleted' });
      await expect(deleteDepartment('d1')).resolves.toBeUndefined();
      expect(hoisted.departmentDelete).toHaveBeenCalledWith('d1');
    });

    it('deleteDepartment propagates repository errors', async () => {
      hoisted.departmentDelete.mockRejectedValueOnce(new ApiError(409, 'has children'));
      await expect(deleteDepartment('d1')).rejects.toThrow('has children');
    });
  });

  describe('positions', () => {
    it('createPosition returns the created position', async () => {
      const created = { id: 'p9', title: 'Architect' };
      hoisted.positionCreate.mockResolvedValueOnce(created);
      await expect(createPosition({ name: 'Architect', departmentId: 'd1' })).resolves.toEqual(
        created,
      );
      expect(hoisted.positionCreate).toHaveBeenCalledWith({
        name: 'Architect',
        departmentId: 'd1',
      });
    });

    it('updatePosition forwards id and payload', async () => {
      hoisted.positionUpdate.mockResolvedValueOnce({});
      await expect(updatePosition('p1', { grade: 'L5' })).resolves.toBeUndefined();
      expect(hoisted.positionUpdate).toHaveBeenCalledWith('p1', { grade: 'L5' });
    });

    it('deletePosition forwards the id', async () => {
      hoisted.positionDelete.mockResolvedValueOnce({ message: 'deleted' });
      await expect(deletePosition('p1')).resolves.toBeUndefined();
      expect(hoisted.positionDelete).toHaveBeenCalledWith('p1');
    });

    it('deletePosition propagates repository errors', async () => {
      hoisted.positionDelete.mockRejectedValueOnce(new Error('in use'));
      await expect(deletePosition('p1')).rejects.toThrow('in use');
    });
  });

  describe('users', () => {
    it('inviteUser converts the frontend role to the backend enum', async () => {
      hoisted.userInvite.mockResolvedValueOnce({ message: 'invited' });
      await expect(
        inviteUser({ email: 'new@example.com', role: 'HR Manager', employeeId: 'e1' }),
      ).resolves.toBeUndefined();
      expect(hoisted.userInvite).toHaveBeenCalledWith({
        email: 'new@example.com',
        role: 'HR_MANAGER',
        employeeId: 'e1',
      });
    });

    it('inviteUser passes an undefined employeeId through when omitted', async () => {
      hoisted.userInvite.mockResolvedValueOnce({ message: 'invited' });
      await inviteUser({ email: 'solo@example.com', role: 'Admin' });
      expect(hoisted.userInvite).toHaveBeenCalledWith({
        email: 'solo@example.com',
        role: 'ADMIN',
        employeeId: undefined,
      });
    });

    it('inviteUser propagates repository errors', async () => {
      hoisted.userInvite.mockRejectedValueOnce(new ApiError(409, 'email already exists'));
      await expect(inviteUser({ email: 'dup@example.com', role: 'Employee' })).rejects.toThrow(
        'email already exists',
      );
    });

    it('changeUserRole converts the role to the backend enum', async () => {
      hoisted.userChangeRole.mockResolvedValueOnce({ message: 'ok' });
      await expect(changeUserRole('u1', 'Manager')).resolves.toBeUndefined();
      expect(hoisted.userChangeRole).toHaveBeenCalledWith('u1', 'MANAGER');
    });

    it('changeUserStatus converts the status to the backend enum', async () => {
      hoisted.userChangeStatus.mockResolvedValueOnce({ message: 'ok' });
      await changeUserStatus('u1', 'deactivated');
      expect(hoisted.userChangeStatus).toHaveBeenCalledWith('u1', 'DEACTIVATED');

      await changeUserStatus('u2', 'active');
      expect(hoisted.userChangeStatus).toHaveBeenLastCalledWith('u2', 'ACTIVE');
    });

    it('changeUserStatus propagates repository errors', async () => {
      hoisted.userChangeStatus.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
      await expect(changeUserStatus('u1', 'active')).rejects.toThrow('forbidden');
    });

    it('adminResetPassword forwards the id', async () => {
      hoisted.userResetPassword.mockResolvedValueOnce({ message: 'sent' });
      await expect(adminResetPassword('u1')).resolves.toBeUndefined();
      expect(hoisted.userResetPassword).toHaveBeenCalledWith('u1');
    });

    it('deleteUser forwards the id', async () => {
      hoisted.userDelete.mockResolvedValueOnce({ message: 'deleted' });
      await expect(deleteUser('u1')).resolves.toBeUndefined();
      expect(hoisted.userDelete).toHaveBeenCalledWith('u1');
    });

    it('deleteUser propagates repository errors', async () => {
      hoisted.userDelete.mockRejectedValueOnce(new ApiError(404, 'not found'));
      await expect(deleteUser('missing')).rejects.toThrow('not found');
    });
  });

  it('write operations ignore config.useMock and always hit the repository', async () => {
    const prev = config.useMock;
    mutableConfig.useMock = true;
    hoisted.userDelete.mockResolvedValueOnce({ message: 'deleted' });
    await deleteUser('u1');
    expect(hoisted.userDelete).toHaveBeenCalledWith('u1');
    mutableConfig.useMock = prev;
  });
});

describe('useData hook', () => {
  it('exposes loaded data and the resolver mode', async () => {
    const loader = vi.fn().mockResolvedValue({ data: [1, 2, 3], mode: 'api' as const });
    const { result } = renderHook(() => useData(loader, [] as number[]));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([1, 2, 3]);
    expect(result.current.mode).toBe('api');
    expect(result.current.error).toBeNull();
  });

  it('starts in a loading state with the provided initial data', () => {
    const loader = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useData(loader, ['seed']));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual(['seed']);
    expect(result.current.mode).toBe('mock');
  });

  it('captures the Error message when the loader rejects', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useData(loader, [] as number[]));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.mode).toBe('mock');
    expect(result.current.data).toEqual([]);
  });

  it('uses a generic message when the loader rejects with a non-Error value', async () => {
    const loader = vi.fn().mockRejectedValue('just a string');
    const { result } = renderHook(() => useData(loader, [] as number[]));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load data.');
  });

  it('reload re-invokes the loader and clears a previous error', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ data: ['ok'], mode: 'api' as const });

    const { result } = renderHook(() => useData(loader, [] as string[]));
    await waitFor(() => expect(result.current.error).toBe('transient'));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(['ok']);
  });

  it('re-runs when the loader identity changes', async () => {
    const first = vi.fn().mockResolvedValue({ data: 'a', mode: 'api' as const });
    const second = vi.fn().mockResolvedValue({ data: 'b', mode: 'api' as const });

    const { result, rerender } = renderHook(({ loader }) => useData(loader, ''), {
      initialProps: { loader: first },
    });
    await waitFor(() => expect(result.current.data).toBe('a'));

    rerender({ loader: second });
    await waitFor(() => expect(result.current.data).toBe('b'));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('ignores a resolution that lands after unmount', async () => {
    let resolveLoader: (value: { data: string; mode: 'api' }) => void = () => {};
    const loader = vi.fn().mockReturnValue(
      new Promise<{ data: string; mode: 'api' }>((resolve) => {
        resolveLoader = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useData(loader, 'initial'));

    unmount();
    await act(async () => {
      resolveLoader({ data: 'late', mode: 'api' });
    });

    // State is frozen at unmount time; no update (or React warning) occurs.
    expect(result.current.data).toBe('initial');
  });

  it('ignores a rejection that lands after unmount', async () => {
    let rejectLoader: (reason: Error) => void = () => {};
    const loader = vi.fn().mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLoader = reject;
      }),
    );
    const { result, unmount } = renderHook(() => useData(loader, 'initial'));

    unmount();
    await act(async () => {
      rejectLoader(new Error('late failure'));
    });

    expect(result.current.error).toBeNull();
  });
});

describe('data-layer hooks (mock mode)', () => {
  const prev = config.useMock;
  beforeEach(() => {
    mutableConfig.useMock = true;
    vi.clearAllMocks();
    // In mock mode the data layer calls the repository (the MSW-intercepted
    // path). In unit tests MSW is not running, so the repos reject and the
    // layer falls back to the static mock array.
    hoisted.employeeList.mockRejectedValue(new Error('msw not running'));
    hoisted.departmentList.mockRejectedValue(new Error('msw not running'));
    hoisted.positionList.mockRejectedValue(new Error('msw not running'));
    hoisted.userList.mockRejectedValue(new Error('msw not running'));
    hoisted.auditLogList.mockRejectedValue(new Error('msw not running'));
    hoisted.alertList.mockRejectedValue(new Error('msw not running'));
    hoisted.documentListByEmployee.mockRejectedValue(new Error('msw not running'));
  });
  afterEach(() => {
    mutableConfig.useMock = prev;
  });

  it('useEmployees loads data', async () => {
    const { result } = renderHook(() => useEmployees());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
    expect(result.current.mode).toBe('mock');
  });

  it('useDepartments loads data and supports reload', async () => {
    const { result } = renderHook(() => useDepartments());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it('usePositions loads data', async () => {
    const { result } = renderHook(() => usePositions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
    expect(result.current.mode).toBe('mock');
  });

  it('useUsers loads data', async () => {
    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it('useAuditLog loads data', async () => {
    const { result } = renderHook(() => useAuditLog({ page: 1, pageSize: 25 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.logs.length).toBeGreaterThan(0);
    expect(result.current.data.total).toBeGreaterThan(0);
  });

  it('useExpiryAlerts loads data', async () => {
    const { result } = renderHook(() => useExpiryAlerts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('useDocuments filters by employee id', async () => {
    const { result } = renderHook(() => useDocuments('1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data.every((d) => d.employeeId === '1')).toBe(true);
  });

  it('useDocuments reloads when the employee id changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useDocuments(id), {
      initialProps: { id: '1' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ id: 'no-such-employee' });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it('useDocuments keeps a stable loader across re-renders with the same id', async () => {
    const { result, rerender } = renderHook(({ id }) => useDocuments(id), {
      initialProps: { id: '1' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const firstData = result.current.data;

    rerender({ id: '1' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(firstData);
  });
});

describe('data-layer hooks (api mode)', () => {
  const prev = config.useMock;
  beforeEach(() => {
    mutableConfig.useMock = false;
    vi.clearAllMocks();
  });
  afterEach(() => {
    mutableConfig.useMock = prev;
    vi.restoreAllMocks();
  });

  it('useEmployees surfaces api mode and repository data', async () => {
    hoisted.employeeList.mockResolvedValue([{ id: '1', firstName: 'Ada' }]);
    const { result } = renderHook(() => useEmployees());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('api');
    expect(result.current.data).toHaveLength(1);
  });

  it('useUsers surfaces fallback mode when the repository fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hoisted.userList.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('fallback');
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it('useEmployees surfaces an error when an auth failure propagates', async () => {
    hoisted.employeeList.mockRejectedValue(new ApiError(401, 'session expired'));
    const { result } = renderHook(() => useEmployees());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('session expired');
    expect(result.current.mode).toBe('mock');
    expect(result.current.data).toEqual([]);
  });
});

// ===========================================================================
// GDPR functions — mock mode (read functions only; writers delegate to API)
// ===========================================================================
describe('GDPR data-layer functions (mock mode)', () => {
  const prev = config.useMock;
  beforeEach(() => {
    mutableConfig.useMock = true;
    vi.clearAllMocks();
    // In mock mode the data layer calls the repository (the MSW-intercepted
    // path). In unit tests MSW is not running, so the repos reject and the
    // layer falls back to the static mock array.
    hoisted.retentionListPolicies.mockRejectedValue(new Error('msw not running'));
    hoisted.dsarList.mockRejectedValue(new Error('msw not running'));
    hoisted.breachList.mockRejectedValue(new Error('msw not running'));
    hoisted.anomalyList.mockRejectedValue(new Error('msw not running'));
    hoisted.consentList.mockRejectedValue(new Error('msw not running'));
    hoisted.keyListVersions.mockRejectedValue(new Error('msw not running'));
  });
  afterEach(() => {
    mutableConfig.useMock = prev;
  });

  it('getRetentionPolicies returns mock data', async () => {
    const { mode, data } = await getRetentionPolicies();
    expect(mode).toBe('mock');
    expect(data).toHaveLength(mockRetentionPolicies.length);
  });

  it('getDsars returns mock data (no status filter)', async () => {
    const { mode, data } = await getDsars();
    expect(mode).toBe('mock');
    expect(data).toHaveLength(mockDsars.length);
  });

  it('getDsars filters mock data by status', async () => {
    const { data } = await getDsars('COMPLETED');
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('dsar-003');
  });

  it('getDsars returns empty when status has no matches', async () => {
    const { data } = await getDsars('NON_EXISTENT');
    expect(data).toHaveLength(0);
  });

  it('getBreaches returns mock data (no status filter)', async () => {
    const { mode, data } = await getBreaches();
    expect(mode).toBe('mock');
    expect(data).toHaveLength(mockBreaches.length);
  });

  it('getBreaches filters mock data by containmentStatus', async () => {
    const { data } = await getBreaches('RESOLVED');
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('br-002');
  });

  it('getAnomalyAlerts returns mock data', async () => {
    const { mode, data } = await getAnomalyAlerts();
    expect(mode).toBe('mock');
    expect(data).toHaveLength(mockAnomalyAlerts.length);
  });

  it('getConsentRecords returns mock data (no params)', async () => {
    const { mode, data } = await getConsentRecords();
    expect(mode).toBe('mock');
    expect(data).toHaveLength(mockConsentRecords.length);
  });

  it('getConsentRecords passes userId to the repo loader but does not mock-filter', async () => {
    // In mock mode the userId param is forwarded to the repo loader (used only in api mode);
    // the mock data is returned unfiltered by userId.
    const { mode, data } = await getConsentRecords({ dataSubjectUserId: 'u-003' });
    expect(mode).toBe('mock');
    expect(data).toHaveLength(mockConsentRecords.length);
  });

  it('getConsentRecords filters mock data by email', async () => {
    const { data } = await getConsentRecords({ dataSubjectEmail: 'alice.doe@example.com' });
    expect(data).toHaveLength(1);
    expect(data[0].dataSubjectEmail).toBe('alice.doe@example.com');
  });

  it('getConsentRecords returns empty when no subject matches', async () => {
    const { data } = await getConsentRecords({ dataSubjectEmail: 'nobody@example.com' });
    expect(data).toHaveLength(0);
  });

  it('getKeyVersions returns mock data (no purpose filter)', async () => {
    const { mode, data } = await getKeyVersions();
    expect(mode).toBe('mock');
    expect(data).toHaveLength(mockKeyVersions.length);
  });

  it('getKeyVersions filters mock data by purpose', async () => {
    const { data } = await getKeyVersions('DATA_ENCRYPTION');
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((k) => k.purpose === 'DATA_ENCRYPTION')).toBe(true);
  });

  it('getKeyVersions returns empty when purpose has no matches', async () => {
    const { data } = await getKeyVersions('BACKUP_ENCRYPTION');
    expect(data).toHaveLength(0);
  });
});

// ===========================================================================
// GDPR functions — api mode (delegation + fallback)
// ===========================================================================
describe('GDPR data-layer functions (api mode)', () => {
  const prev = config.useMock;
  beforeEach(() => {
    mutableConfig.useMock = false;
    vi.clearAllMocks();
  });
  afterEach(() => {
    mutableConfig.useMock = prev;
    vi.restoreAllMocks();
  });

  it('getRetentionPolicies delegates to retentionRepo.listPolicies', async () => {
    hoisted.retentionListPolicies.mockResolvedValueOnce(mockRetentionPolicies);
    const { mode, data } = await getRetentionPolicies();
    expect(mode).toBe('api');
    expect(data).toHaveLength(mockRetentionPolicies.length);
    expect(hoisted.retentionListPolicies).toHaveBeenCalledTimes(1);
  });

  it('upsertRetentionPolicy delegates to retentionRepo.upsertPolicy', async () => {
    const payload = {
      dataCategory: 'PAYROLL_RECORDS',
      retentionYears: 7,
      action: 'ANONYMIZE',
      description: 'd',
      isDefault: false,
    };
    hoisted.retentionUpsertPolicy.mockResolvedValueOnce({ policy: { id: 'rp-9' } });
    await upsertRetentionPolicy(payload);
    expect(hoisted.retentionUpsertPolicy).toHaveBeenCalledWith(payload);
  });

  it('runRetentionPurge delegates to retentionRepo.purge with dryRun flag', async () => {
    hoisted.retentionPurge.mockResolvedValueOnce({ removed: 0 });
    await runRetentionPurge(true);
    expect(hoisted.retentionPurge).toHaveBeenCalledWith(true);
  });

  it('runRetentionPurge delegates with dryRun=false', async () => {
    hoisted.retentionPurge.mockResolvedValueOnce({ removed: 3 });
    await runRetentionPurge(false);
    expect(hoisted.retentionPurge).toHaveBeenCalledWith(false);
  });

  it('placeLegalHold delegates to retentionRepo.placeLegalHold', async () => {
    const payload = { entityType: 'Employee', entityId: 'e-004', reason: 'r' };
    hoisted.retentionPlaceLegalHold.mockResolvedValueOnce({ hold: { id: 'lh-9' } });
    await placeLegalHold(payload);
    expect(hoisted.retentionPlaceLegalHold).toHaveBeenCalledWith(payload);
  });

  it('releaseLegalHold delegates to retentionRepo.releaseLegalHold', async () => {
    hoisted.retentionReleaseLegalHold.mockResolvedValueOnce({ hold: { id: 'lh-9' } });
    await releaseLegalHold('lh-9');
    expect(hoisted.retentionReleaseLegalHold).toHaveBeenCalledWith('lh-9');
  });

  it('getDsars delegates to dsarRepo.list', async () => {
    hoisted.dsarList.mockResolvedValueOnce(mockDsars);
    const { mode, data } = await getDsars('IN_PROGRESS');
    expect(mode).toBe('api');
    expect(data).toHaveLength(mockDsars.length);
    expect(hoisted.dsarList).toHaveBeenCalledWith('IN_PROGRESS');
  });

  it('createDsar delegates to dsarRepo.create', async () => {
    const payload = { requestType: 'ACCESS', dataSubjectEmail: 'x@example.com' };
    hoisted.dsarCreate.mockResolvedValueOnce({ dsar: { id: 'dsar-9' } });
    await createDsar(payload);
    expect(hoisted.dsarCreate).toHaveBeenCalledWith(payload);
  });

  it('updateDsarStatus delegates to dsarRepo.updateStatus', async () => {
    const payload = { status: 'COMPLETED' };
    hoisted.dsarUpdateStatus.mockResolvedValueOnce({ dsar: { id: 'dsar-9' } });
    await updateDsarStatus('dsar-9', payload);
    expect(hoisted.dsarUpdateStatus).toHaveBeenCalledWith('dsar-9', payload);
  });

  it('getBreaches delegates to breachRepo.list', async () => {
    hoisted.breachList.mockResolvedValueOnce(mockBreaches);
    const { mode, data } = await getBreaches();
    expect(mode).toBe('api');
    expect(data).toHaveLength(mockBreaches.length);
    expect(hoisted.breachList).toHaveBeenCalledWith(undefined);
  });

  it('createBreach delegates to breachRepo.create', async () => {
    const payload = {
      title: 't',
      description: 'd',
      detectionAt: '2026-08-07T00:00:00Z',
      severity: 'HIGH',
      isHighRisk: true,
      dataCategoriesAffected: ['SALARY_RECORDS'],
      affectedSubjectsCount: 1,
    };
    hoisted.breachCreate.mockResolvedValueOnce({ breach: { id: 'br-9' } });
    await createBreach(payload);
    expect(hoisted.breachCreate).toHaveBeenCalledWith(payload);
  });

  it('updateBreach delegates to breachRepo.update', async () => {
    hoisted.breachUpdate.mockResolvedValueOnce({ breach: { id: 'br-9' } });
    await updateBreach('br-9', { containmentStatus: 'CONTAINED' });
    expect(hoisted.breachUpdate).toHaveBeenCalledWith('br-9', { containmentStatus: 'CONTAINED' });
  });

  it('recordBreachNotification delegates to breachRepo.recordNotification', async () => {
    const payload = { notificationType: 'SUBJECT', method: 'Email' };
    hoisted.breachRecordNotification.mockResolvedValueOnce({ notification: {} });
    await recordBreachNotification('br-9', payload);
    expect(hoisted.breachRecordNotification).toHaveBeenCalledWith('br-9', payload);
  });

  it('getAnomalyAlerts delegates to anomalyRepo.list', async () => {
    hoisted.anomalyList.mockResolvedValueOnce(mockAnomalyAlerts);
    const { mode, data } = await getAnomalyAlerts();
    expect(mode).toBe('api');
    expect(data).toHaveLength(mockAnomalyAlerts.length);
    expect(hoisted.anomalyList).toHaveBeenCalledTimes(1);
  });

  it('dismissAnomaly delegates to anomalyRepo.dismiss', async () => {
    hoisted.anomalyDismiss.mockResolvedValueOnce({ alert: { id: 'an-9' } });
    await dismissAnomaly('an-9', 'fp');
    expect(hoisted.anomalyDismiss).toHaveBeenCalledWith('an-9', 'fp');
  });

  it('getConsentRecords delegates to consentRepo.list', async () => {
    hoisted.consentList.mockResolvedValueOnce(mockConsentRecords);
    const { mode, data } = await getConsentRecords({ dataSubjectUserId: 'u-003' });
    expect(mode).toBe('api');
    expect(data).toHaveLength(mockConsentRecords.length);
    expect(hoisted.consentList).toHaveBeenCalledWith({ dataSubjectUserId: 'u-003' });
  });

  it('recordConsent delegates to consentRepo.record', async () => {
    const payload = {
      dataSubjectEmail: 'x@example.com',
      processingPurpose: 'marketing',
      consentText: 'I consent',
      noticeVersion: 'v2',
      mechanism: 'CHECKBOX',
    };
    hoisted.consentRecord.mockResolvedValueOnce({ consent: { id: 'cs-9' } });
    await recordConsent(payload);
    expect(hoisted.consentRecord).toHaveBeenCalledWith(payload);
  });

  it('withdrawConsent delegates to consentRepo.withdraw with lawful basis override', async () => {
    hoisted.consentWithdraw.mockResolvedValueOnce({ withdrawal: { id: 'w-9' } });
    await withdrawConsent('cs-9', 'legitimate-interest');
    expect(hoisted.consentWithdraw).toHaveBeenCalledWith('cs-9', 'legitimate-interest');
  });

  it('withdrawConsent delegates without lawful basis when omitted', async () => {
    hoisted.consentWithdraw.mockResolvedValueOnce({ withdrawal: { id: 'w-9' } });
    await withdrawConsent('cs-9');
    expect(hoisted.consentWithdraw).toHaveBeenCalledWith('cs-9', undefined);
  });

  it('getKeyVersions delegates to keyRepo.listVersions', async () => {
    hoisted.keyListVersions.mockResolvedValueOnce(mockKeyVersions);
    const { mode, data } = await getKeyVersions('DATA_ENCRYPTION');
    expect(mode).toBe('api');
    expect(data).toHaveLength(mockKeyVersions.length);
    expect(hoisted.keyListVersions).toHaveBeenCalledWith('DATA_ENCRYPTION');
  });

  it('rotateKey delegates to keyRepo.rotate', async () => {
    hoisted.keyRotate.mockResolvedValueOnce({ message: 'ok', newVersion: {} });
    await rotateKey('DATA_ENCRYPTION');
    expect(hoisted.keyRotate).toHaveBeenCalledWith('DATA_ENCRYPTION');
  });

  it('writer functions propagate repo errors (no mock fallback)', async () => {
    hoisted.retentionUpsertPolicy.mockRejectedValueOnce(new Error('boom'));
    await expect(
      upsertRetentionPolicy({ dataCategory: 'X', retentionYears: 1, action: 'DELETE' }),
    ).rejects.toThrow('boom');
  });

  it('falls back to mock data when getRetentionPolicies API call fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hoisted.retentionListPolicies.mockRejectedValueOnce(new Error('network down'));
    const { mode, data } = await getRetentionPolicies();
    expect(mode).toBe('fallback');
    expect(data).toHaveLength(mockRetentionPolicies.length);
  });

  it('falls back to mock data when getDsars API call fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hoisted.dsarList.mockRejectedValueOnce(new ApiError(500, 'server error'));
    const { mode, data } = await getDsars();
    expect(mode).toBe('fallback');
    expect(data).toHaveLength(mockDsars.length);
  });

  it('falls back to mock data when getBreaches API call fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hoisted.breachList.mockRejectedValueOnce(new ApiError(0, 'unreachable'));
    const { mode, data } = await getBreaches();
    expect(mode).toBe('fallback');
    expect(data).toHaveLength(mockBreaches.length);
  });

  it('falls back to mock data when getAnomalyAlerts API call fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hoisted.anomalyList.mockRejectedValueOnce(new ApiError(404, 'not found'));
    const { mode, data } = await getAnomalyAlerts();
    expect(mode).toBe('fallback');
    expect(data).toHaveLength(mockAnomalyAlerts.length);
  });

  it('falls back to mock data when getConsentRecords API call fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hoisted.consentList.mockRejectedValueOnce(new Error('boom'));
    const { mode, data } = await getConsentRecords();
    expect(mode).toBe('fallback');
    expect(data).toHaveLength(mockConsentRecords.length);
  });

  it('falls back to mock data when getKeyVersions API call fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hoisted.keyListVersions.mockRejectedValueOnce(new Error('boom'));
    const { mode, data } = await getKeyVersions();
    expect(mode).toBe('fallback');
    expect(data).toHaveLength(mockKeyVersions.length);
  });
});
