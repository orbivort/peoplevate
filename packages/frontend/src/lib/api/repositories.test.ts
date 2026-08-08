import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiMock, apiRequestMock, authStorageMock, configMock, fetchMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  apiRequestMock: vi.fn(),
  authStorageMock: {
    getAccessToken: vi.fn(),
    getRefreshToken: vi.fn(),
    getStoredUser: vi.fn(),
    setSession: vi.fn(),
    clear: vi.fn(),
  },
  configMock: {
    useMock: false,
    apiBase: 'http://localhost:4000',
  },
  // jsdom provides fetch as global; we capture it here so it can be spied on.
  fetchMock: vi.fn(),
}));

vi.mock('../api-client', () => ({
  api: apiMock,
  apiRequest: apiRequestMock,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

vi.mock('../auth-storage', () => ({
  authStorage: authStorageMock,
}));

vi.mock('../config', () => ({
  config: configMock,
}));

// Provide identity-passthrough adapters so wrappers run without throwing.
vi.mock('./adapters', () => ({
  adaptAnomalyAlert: (r: Record<string, unknown>) => r,
  adaptAuditLog: (r: Record<string, unknown>) => r,
  adaptBreach: (r: Record<string, unknown>) => r,
  adaptConsent: (r: Record<string, unknown>) => r,
  adaptDepartment: (r: Record<string, unknown>) => r,
  adaptDocument: (r: Record<string, unknown>) => r,
  adaptDsar: (r: Record<string, unknown>) => r,
  adaptEmployee: (r: Record<string, unknown>) => r,
  adaptExpiryAlert: (r: Record<string, unknown>) => r,
  adaptKeyVersion: (r: Record<string, unknown>) => r,
  adaptPosition: (r: Record<string, unknown>) => r,
  adaptRetentionPolicy: (r: Record<string, unknown>) => r,
  adaptUser: (r: Record<string, unknown>) => r,
}));

import {
  employeeRepo,
  departmentRepo,
  positionRepo,
  userRepo,
  documentRepo,
  auditLogRepo,
  alertRepo,
  retentionRepo,
  dsarRepo,
  breachRepo,
  anomalyRepo,
  consentRepo,
  keyRepo,
  dataSubjectRightsRepo,
  authRepo,
} from './repositories';
import { ApiError } from '../api-client';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the global fetch spy used by dataSubjectRightsRepo.exportData.
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

describe('repositories (real backend wrappers)', () => {
  it('employeeRepo.list builds query string only for provided params', async () => {
    apiMock.get.mockResolvedValueOnce({ employees: [{ id: 'e1' }] });
    await employeeRepo.list({ search: 'ali', status: 'Active', departmentId: 'd1' });
    expect(apiMock.get).toHaveBeenCalledWith(
      '/api/employees?search=ali&status=Active&departmentId=d1',
    );

    apiMock.get.mockResolvedValueOnce({ employees: [] });
    const result = await employeeRepo.list();
    expect(apiMock.get).toHaveBeenCalledWith('/api/employees');
    expect(result).toEqual([]);
  });

  it('employeeRepo.get, create, update, listChanges, recordChange, applyChange', async () => {
    apiMock.get.mockResolvedValueOnce({ id: 'e1' });
    expect(await employeeRepo.get('e1')).toEqual({ id: 'e1' });

    apiMock.post.mockResolvedValueOnce({ id: 'e1', employeeNo: 'EMP-1' });
    await employeeRepo.create({
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.com',
      departmentId: 'd1',
      positionId: 'p1',
      hireDate: '2026-01-01',
      employmentType: 'FullTime',
    });
    expect(apiMock.post).toHaveBeenCalled();

    apiMock.put.mockResolvedValueOnce({ message: 'ok' });
    await employeeRepo.update('e1', { firstName: 'C' });

    apiMock.get.mockResolvedValueOnce({ changes: [{ id: 'c1' }] });
    expect(await employeeRepo.listChanges('e1')).toEqual([{ id: 'c1' }]);

    apiMock.get.mockResolvedValueOnce({});
    expect(await employeeRepo.listChanges('e1')).toEqual([]);

    apiMock.post.mockResolvedValueOnce({ id: 'c1' });
    await employeeRepo.recordChange('e1', {
      changeType: 'Title',
      newValue: 'Senior',
      effectiveDate: '2026-01-01',
    });

    apiMock.patch.mockResolvedValueOnce({});
    await employeeRepo.applyChange('e1', 'c1');
  });

  it('employeeRepo.selfUpdate, uploadAvatar, removeAvatar, changePassword', async () => {
    apiMock.put.mockResolvedValueOnce({ message: 'saved' });
    await employeeRepo.selfUpdate('e1', { phone: '123', address: 'addr' });
    expect(apiMock.put).toHaveBeenCalledWith('/api/employees/e1/self', {
      phone: '123',
      address: 'addr',
    });

    const file = new File(['x'], 'avatar.png', { type: 'image/png' });
    apiRequestMock.mockResolvedValueOnce({ message: 'ok', avatarUrl: 'http://x/a.png' });
    await employeeRepo.uploadAvatar('e1', file);
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/api/employees/e1/avatar',
      expect.objectContaining({ method: 'POST', json: false }),
    );
    const callBody = (apiRequestMock.mock.calls[0] as unknown[])[1] as { body: FormData };
    expect(callBody.body).toBeInstanceOf(FormData);
    expect(callBody.body.get('file')).toBe(file);

    apiMock.del.mockResolvedValueOnce({ message: 'removed' });
    await employeeRepo.removeAvatar('e1');
    expect(apiMock.del).toHaveBeenCalledWith('/api/employees/e1/avatar');

    apiMock.post.mockResolvedValueOnce({ message: 'changed' });
    await authRepo.changePassword('old', 'new');
    expect(apiMock.post).toHaveBeenCalledWith('/api/auth/change-password', {
      currentPassword: 'old',
      newPassword: 'new',
    });
  });

  it('departmentRepo.list/create/update/delete with optional fields', async () => {
    apiMock.get.mockResolvedValueOnce({ departments: [{ id: 'd1' }] });
    expect(await departmentRepo.list()).toEqual([{ id: 'd1' }]);

    apiMock.get.mockResolvedValueOnce({});
    expect(await departmentRepo.list()).toEqual([]);

    apiMock.post.mockResolvedValueOnce({ id: 'd1', name: 'Eng' });
    await departmentRepo.create({ name: 'Eng' });
    expect(apiMock.post).toHaveBeenCalledWith('/api/departments', { name: 'Eng' });

    apiMock.post.mockResolvedValueOnce({ id: 'd1' });
    await departmentRepo.create({ name: 'Eng', description: 'desc', parentId: 'p0' });
    expect(apiMock.post).toHaveBeenCalledWith('/api/departments', {
      name: 'Eng',
      description: 'desc',
      parentId: 'p0',
    });

    apiMock.put.mockResolvedValueOnce({ id: 'd1' });
    await departmentRepo.update('d1', { name: 'New' });
    expect(apiMock.put).toHaveBeenCalledWith('/api/departments/d1', { name: 'New' });

    apiMock.put.mockResolvedValueOnce({ id: 'd1' });
    await departmentRepo.update('d1', { description: undefined, parentId: null });
    expect(apiMock.put).toHaveBeenCalledWith('/api/departments/d1', { parentId: null });

    apiMock.del.mockResolvedValueOnce({ message: 'ok' });
    await departmentRepo.delete('d1');
    expect(apiMock.del).toHaveBeenCalledWith('/api/departments/d1');
  });

  it('positionRepo.list/create/update/delete with optional fields', async () => {
    apiMock.get.mockResolvedValueOnce({ positions: [{ id: 'p1' }] });
    await positionRepo.list();
    expect(apiMock.get).toHaveBeenCalledWith('/api/positions');

    apiMock.get.mockResolvedValueOnce({ positions: [] });
    expect(await positionRepo.list('d1')).toEqual([]);
    expect(apiMock.get).toHaveBeenCalledWith('/api/positions?departmentId=d1');

    apiMock.post.mockResolvedValueOnce({ id: 'p1', name: 'P' });
    await positionRepo.create({ name: 'P', departmentId: 'd1' });
    expect(apiMock.post).toHaveBeenCalledWith('/api/positions', { name: 'P', departmentId: 'd1' });

    apiMock.post.mockResolvedValueOnce({ id: 'p1' });
    await positionRepo.create({ name: 'P', grade: 'G7', description: 'd', departmentId: 'd1' });
    expect(apiMock.post).toHaveBeenCalledWith('/api/positions', {
      name: 'P',
      departmentId: 'd1',
      grade: 'G7',
      description: 'd',
    });

    apiMock.put.mockResolvedValueOnce({});
    await positionRepo.update('p1', { grade: 'G8' });
    expect(apiMock.put).toHaveBeenCalledWith('/api/positions/p1', { grade: 'G8' });

    apiMock.del.mockResolvedValueOnce({ message: 'ok' });
    await positionRepo.delete('p1');
    expect(apiMock.del).toHaveBeenCalledWith('/api/positions/p1');
  });

  it('userRepo.list and mutations handle optional params', async () => {
    apiMock.get.mockResolvedValueOnce({ users: [{ id: 'u1' }] });
    await userRepo.list({ search: 'a', role: 'Admin' });
    expect(apiMock.get).toHaveBeenCalledWith('/api/users?search=a&role=Admin');

    apiMock.get.mockResolvedValueOnce({ users: [] });
    const r = await userRepo.list();
    expect(apiMock.get).toHaveBeenCalledWith('/api/users');
    expect(r).toEqual([]);

    apiMock.post.mockResolvedValueOnce({ message: 'ok' });
    await userRepo.invite({ email: 'a@b.com', role: 'Admin', employeeId: 'e1' });
    apiMock.patch.mockResolvedValueOnce({ message: 'ok' });
    await userRepo.changeRole('u1', 'Admin');
    expect(apiMock.patch).toHaveBeenCalledWith('/api/users/u1/role', { role: 'Admin' });
    await userRepo.changeStatus('u1', 'Active');
    expect(apiMock.patch).toHaveBeenCalledWith('/api/users/u1/status', { status: 'Active' });
    apiMock.post.mockResolvedValueOnce({ message: 'ok' });
    await userRepo.resetPassword('u1');
    apiMock.del.mockResolvedValueOnce({ message: 'ok' });
    await userRepo.delete('u1');
  });

  it('documentRepo.listByEmployee and auditLogRepo.list', async () => {
    apiMock.get.mockResolvedValueOnce({ documents: [{ id: 'doc1' }] });
    expect(await documentRepo.listByEmployee('e1')).toEqual([{ id: 'doc1' }]);

    apiMock.get.mockResolvedValueOnce({
      logs: [{ id: 'l1' }],
      pagination: { page: 2, pageSize: 50, total: 100, totalPages: 2 },
    });
    const res = await auditLogRepo.list({
      action: 'CREATE',
      entity: 'Employee',
      search: 'x',
      from: '2026-01-01',
      to: '2026-01-31',
      user: 'grace',
      page: 2,
      pageSize: 50,
    });
    expect(apiMock.get).toHaveBeenCalledWith(
      '/api/audit-log?action=CREATE&entity=Employee&search=x&from=2026-01-01&to=2026-01-31&user=grace&page=2&pageSize=50',
    );
    expect(res).toEqual({ logs: [{ id: 'l1' }], total: 100 });

    apiMock.get.mockResolvedValueOnce({ logs: [], pagination: { total: 0 } });
    const empty = await auditLogRepo.list({ page: 1, pageSize: 25 });
    expect(apiMock.get).toHaveBeenCalledWith('/api/audit-log?page=1&pageSize=25');
    expect(empty).toEqual({ logs: [], total: 0 });
  });

  it('auditLogRepo.list falls back to 0 total when pagination missing', async () => {
    apiMock.get.mockResolvedValueOnce({ logs: [{ id: 'l2' }] });
    const res = await auditLogRepo.list({ page: 1, pageSize: 10 });
    expect(res).toEqual({ logs: [{ id: 'l2' }], total: 0 });
  });

  it('authRepo login/logout/refresh', async () => {
    apiMock.post.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', user: { id: 'u' } });
    await authRepo.login('a@b.com', 'pw');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/auth/login',
      { email: 'a@b.com', password: 'pw' },
      { auth: false },
    );
    await authRepo.refresh('r');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/auth/refresh',
      { refreshToken: 'r' },
      { auth: false },
    );
    await authRepo.logout('r');
    expect(apiMock.post).toHaveBeenCalledWith('/api/auth/logout', { refreshToken: 'r' });
  });

  it('alertRepo.list with and without acknowledged filter', async () => {
    apiMock.get.mockResolvedValueOnce({ alerts: [{ id: 'a1' }] });
    await alertRepo.list(true);
    expect(apiMock.get).toHaveBeenCalledWith('/api/alerts?acknowledged=true');

    apiMock.get.mockResolvedValueOnce({ alerts: [{ id: 'a2' }] });
    await alertRepo.list(false);
    expect(apiMock.get).toHaveBeenCalledWith('/api/alerts?acknowledged=false');

    apiMock.get.mockResolvedValueOnce({ alerts: [{ id: 'a3' }] });
    await alertRepo.list();
    expect(apiMock.get).toHaveBeenCalledWith('/api/alerts');

    apiMock.get.mockResolvedValueOnce({});
    expect(await alertRepo.list()).toEqual([]);
  });

  it('retentionRepo policy/purge/legal-hold lifecycle', async () => {
    apiMock.get.mockResolvedValueOnce({ policies: [{ id: 'pol1' }] });
    expect(await retentionRepo.listPolicies()).toEqual([{ id: 'pol1' }]);

    apiMock.put.mockResolvedValueOnce({ policy: { id: 'pol1' } });
    await retentionRepo.upsertPolicy({
      dataCategory: 'HR',
      retentionYears: 7,
      action: 'ANONYMIZE',
      description: 'desc',
      isDefault: true,
    });
    expect(apiMock.put).toHaveBeenCalledWith('/api/retention/policies', {
      dataCategory: 'HR',
      retentionYears: 7,
      action: 'ANONYMIZE',
      description: 'desc',
      isDefault: true,
    });

    apiMock.post.mockResolvedValueOnce({ purged: 3 });
    await retentionRepo.purge(true);
    expect(apiMock.post).toHaveBeenCalledWith('/api/retention/purge?dryRun=true');

    apiMock.post.mockResolvedValueOnce({ purged: 3 });
    await retentionRepo.purge(false);
    expect(apiMock.post).toHaveBeenCalledWith('/api/retention/purge');

    apiMock.post.mockResolvedValueOnce({ hold: { id: 'h1' } });
    await retentionRepo.placeLegalHold({
      entityType: 'Employee',
      entityId: 'e1',
      reason: 'litigation',
    });
    expect(apiMock.post).toHaveBeenCalledWith('/api/retention/legal-hold', {
      entityType: 'Employee',
      entityId: 'e1',
      reason: 'litigation',
    });

    apiMock.del.mockResolvedValueOnce({ hold: { id: 'h1' } });
    await retentionRepo.releaseLegalHold('h1');
    expect(apiMock.del).toHaveBeenCalledWith('/api/retention/legal-hold/h1');
  });

  it('dsarRepo list/create/updateStatus', async () => {
    apiMock.get.mockResolvedValueOnce({ dsars: [{ id: 'd1' }] });
    await dsarRepo.list('OPEN');
    expect(apiMock.get).toHaveBeenCalledWith('/api/dsar?status=OPEN');

    apiMock.get.mockResolvedValueOnce({ dsars: [{ id: 'd2' }] });
    await dsarRepo.list();
    expect(apiMock.get).toHaveBeenCalledWith('/api/dsar');

    apiMock.get.mockResolvedValueOnce({});
    expect(await dsarRepo.list()).toEqual([]);

    apiMock.post.mockResolvedValueOnce({ dsar: { id: 'd3' } });
    await dsarRepo.create({
      requestType: 'ACCESS',
      dataSubjectEmail: 'a@b.com',
      description: 'need my data',
    });
    expect(apiMock.post).toHaveBeenCalledWith('/api/dsar', {
      requestType: 'ACCESS',
      dataSubjectEmail: 'a@b.com',
      description: 'need my data',
    });

    apiMock.patch.mockResolvedValueOnce({ dsar: { id: 'd3' } });
    await dsarRepo.updateStatus('d3', {
      status: 'COMPLETED',
      rejectionReason: undefined,
      assignedToId: 'u1',
    });
    expect(apiMock.patch).toHaveBeenCalledWith('/api/dsar/d3/status', {
      status: 'COMPLETED',
      rejectionReason: undefined,
      assignedToId: 'u1',
    });
  });

  it('breachRepo list/get/create/update/notification/template', async () => {
    apiMock.get.mockResolvedValueOnce({ breaches: [{ id: 'b1' }] });
    await breachRepo.list('OPEN');
    expect(apiMock.get).toHaveBeenCalledWith('/api/breach?status=OPEN');

    apiMock.get.mockResolvedValueOnce({ breaches: [{ id: 'b2' }] });
    await breachRepo.list();
    expect(apiMock.get).toHaveBeenCalledWith('/api/breach');

    apiMock.get.mockResolvedValueOnce({});
    expect(await breachRepo.list()).toEqual([]);

    apiMock.get.mockResolvedValueOnce({ breach: { id: 'b1' } });
    expect(await breachRepo.get('b1')).toEqual({ id: 'b1' });

    apiMock.post.mockResolvedValueOnce({ breach: { id: 'b1' } });
    await breachRepo.create({
      title: 'Leak',
      description: 'db exposed',
      detectionAt: '2026-01-01',
      severity: 'HIGH',
      isHighRisk: true,
      dataCategoriesAffected: ['HR'],
      affectedSubjectsCount: 10,
    });
    expect(apiMock.post).toHaveBeenCalled();

    apiMock.patch.mockResolvedValueOnce({ breach: { id: 'b1' } });
    await breachRepo.update('b1', { severity: 'LOW' });
    expect(apiMock.patch).toHaveBeenCalledWith('/api/breach/b1', { severity: 'LOW' });

    apiMock.post.mockResolvedValueOnce({ notification: { id: 'n1' } });
    await breachRepo.recordNotification('b1', {
      notificationType: 'SUPERVISORY_AUTHORITY',
      method: 'EMAIL',
      reference: 'ref-1',
    });
    expect(apiMock.post).toHaveBeenCalledWith('/api/breach/b1/notification', {
      notificationType: 'SUPERVISORY_AUTHORITY',
      method: 'EMAIL',
      reference: 'ref-1',
    });

    apiMock.get.mockResolvedValueOnce({ template: 'Dear authority...' });
    expect(await breachRepo.getTemplate('b1')).toBe('Dear authority...');
  });

  it('anomalyRepo list/dismiss/review', async () => {
    apiMock.get.mockResolvedValueOnce({ alerts: [{ id: 'an1' }] });
    expect(await anomalyRepo.list()).toEqual([{ id: 'an1' }]);

    apiMock.get.mockResolvedValueOnce({});
    expect(await anomalyRepo.list()).toEqual([]);

    apiMock.patch.mockResolvedValueOnce({ alert: { id: 'an1' } });
    await anomalyRepo.dismiss('an1', 'false positive');
    expect(apiMock.patch).toHaveBeenCalledWith('/api/anomalies/an1/dismiss', {
      dismissalReason: 'false positive',
    });

    apiMock.patch.mockResolvedValueOnce({ alert: { id: 'an1' } });
    await anomalyRepo.review('an1');
    expect(apiMock.patch).toHaveBeenCalledWith('/api/anomalies/an1/review', {});
  });

  it('consentRepo list/record/withdraw', async () => {
    apiMock.get.mockResolvedValueOnce({ consents: [{ id: 'c1' }] });
    await consentRepo.list({ dataSubjectUserId: 'u1', dataSubjectEmail: 'a@b.com' });
    expect(apiMock.get).toHaveBeenCalledWith(
      '/api/consent?dataSubjectUserId=u1&dataSubjectEmail=a%40b.com',
    );

    apiMock.get.mockResolvedValueOnce({ consents: [{ id: 'c2' }] });
    await consentRepo.list();
    expect(apiMock.get).toHaveBeenCalledWith('/api/consent');

    apiMock.get.mockResolvedValueOnce({});
    expect(await consentRepo.list()).toEqual([]);

    apiMock.post.mockResolvedValueOnce({ consent: { id: 'c3' } });
    await consentRepo.record({
      dataSubjectEmail: 'a@b.com',
      processingPurpose: 'marketing',
      consentText: 'I agree',
      noticeVersion: 'v1',
      mechanism: 'OPT_IN',
    });
    expect(apiMock.post).toHaveBeenCalled();

    apiMock.post.mockResolvedValueOnce({ withdrawal: { id: 'w1' } });
    await consentRepo.withdraw('c3');
    expect(apiMock.post).toHaveBeenCalledWith('/api/consent/withdraw', {
      originalConsentId: 'c3',
    });

    apiMock.post.mockResolvedValueOnce({ withdrawal: { id: 'w2' } });
    await consentRepo.withdraw('c3', 'LEGITIMATE_INTEREST');
    expect(apiMock.post).toHaveBeenCalledWith('/api/consent/withdraw', {
      originalConsentId: 'c3',
      lawfulBasisOverride: 'LEGITIMATE_INTEREST',
    });
  });

  it('keyRepo listVersions/status/rotate', async () => {
    apiMock.get.mockResolvedValueOnce({ versions: [{ id: 'k1' }] });
    await keyRepo.listVersions('FIELD_ENCRYPTION');
    expect(apiMock.get).toHaveBeenCalledWith('/api/keys?purpose=FIELD_ENCRYPTION');

    apiMock.get.mockResolvedValueOnce({ versions: [{ id: 'k2' }] });
    await keyRepo.listVersions();
    expect(apiMock.get).toHaveBeenCalledWith('/api/keys');

    apiMock.get.mockResolvedValueOnce({});
    expect(await keyRepo.listVersions()).toEqual([]);

    apiMock.get.mockResolvedValueOnce({ statuses: [{ purpose: 'FIELD_ENCRYPTION' }] });
    expect(await keyRepo.status()).toEqual([{ purpose: 'FIELD_ENCRYPTION' }]);

    apiMock.get.mockResolvedValueOnce({});
    expect(await keyRepo.status()).toEqual([]);

    apiMock.post.mockResolvedValueOnce({ message: 'rotated', newVersion: { id: 'k3' } });
    await keyRepo.rotate('FIELD_ENCRYPTION');
    expect(apiMock.post).toHaveBeenCalledWith('/api/keys/rotate', { purpose: 'FIELD_ENCRYPTION' });
  });

  it('dataSubjectRightsRepo access/erasure', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { id: 'e1', name: 'A' } });
    expect(await dataSubjectRightsRepo.access('u1')).toEqual({ id: 'e1', name: 'A' });

    apiMock.post.mockResolvedValueOnce({ erased: true });
    await dataSubjectRightsRepo.erasure('u1');
    expect(apiMock.post).toHaveBeenCalledWith('/api/data-subject-rights/erasure/u1');
  });

  it('dataSubjectRightsRepo.exportData performs a browser download (json)', async () => {
    authStorageMock.getAccessToken.mockReturnValue('token-123');
    const blob = new Blob(['{}'], { type: 'application/json' });
    const fakeRes = {
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(blob),
      headers: {
        get: (h: string) =>
          h === 'Content-Disposition' ? 'attachment; filename="export.json"' : null,
      },
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(fakeRes);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await dataSubjectRightsRepo.exportData('u1', 'json');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/data-subject-rights/export/u1?format=json',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer token-123' },
      }),
    );
    expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock');

    clickSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it('dataSubjectRightsRepo.exportData honors csv format and filename fallback', async () => {
    authStorageMock.getAccessToken.mockReturnValue(null);
    const blob = new Blob(['a,b'], { type: 'text/csv' });
    const fakeRes = {
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(blob),
      headers: { get: () => null },
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(fakeRes);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await dataSubjectRightsRepo.exportData('u1', 'csv');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/data-subject-rights/export/u1?format=csv',
      expect.objectContaining({ method: 'GET', headers: {} }),
    );

    clickSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('dataSubjectRightsRepo.exportData throws ApiError with server message on failure', async () => {
    authStorageMock.getAccessToken.mockReturnValue(null);
    const fakeRes = {
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ error: 'Forbidden' }),
      headers: { get: () => null },
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(fakeRes);

    fetchMock.mockResolvedValueOnce(fakeRes);
    await expect(dataSubjectRightsRepo.exportData('u1', 'json')).rejects.toThrow(ApiError);
    fetchMock.mockResolvedValueOnce(fakeRes);
    await expect(dataSubjectRightsRepo.exportData('u1', 'json')).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    });
  });

  it('dataSubjectRightsRepo.exportData uses default message when body is not json', async () => {
    authStorageMock.getAccessToken.mockReturnValue(null);
    const fakeRes = {
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error('not json')),
      headers: { get: () => null },
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(fakeRes);

    await expect(dataSubjectRightsRepo.exportData('u1', 'csv')).rejects.toThrow(
      'Export failed (500)',
    );
  });
});
