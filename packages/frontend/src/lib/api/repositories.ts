import { api, apiRequest, ApiError } from '../api-client';
import { authStorage } from '../auth-storage';
import { config } from '../config';
import {
  adaptAnomalyAlert,
  adaptAuditLog,
  adaptBreach,
  adaptConsent,
  adaptDepartment,
  adaptDocument,
  adaptDsar,
  adaptEmployee,
  adaptExpiryAlert,
  adaptKeyVersion,
  adaptPosition,
  adaptRetentionPolicy,
  adaptUser,
} from './adapters';

type BackendRecord = Record<string, unknown>;

/**
 * Auth
 *
 * The refresh token is delivered by the backend as an httpOnly cookie and is
 * never part of the JSON response, so it does not appear in these contracts.
 */
export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    employeeId: string | null;
  };
}

export const authRepo = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/api/auth/login', { email, password }, { auth: false }),
  // The backend revokes the refresh token from its httpOnly cookie — no body.
  logout: () => api.post<{ message: string }>('/api/auth/logout'),
  // Silent refresh: the backend reads the refresh token from the httpOnly
  // cookie. Returns a fresh access token + user for in-memory session restore.
  refresh: () =>
    api.post<{ accessToken: string; user: LoginResponse['user'] }>('/api/auth/refresh', undefined, {
      auth: false,
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>('/api/auth/change-password', { currentPassword, newPassword }),
};

/**
 * Employees
 */

/** Payload for creating a new employee. Values use backend Prisma enums. */
export interface CreateEmployeePayload {
  firstName: string;
  lastName: string;
  dateOfBirth?: string | undefined;
  gender?: string | undefined;
  nationalId?: string | undefined;
  email: string;
  phone?: string | undefined;
  address?: string | undefined;
  emergencyContactName?: string | undefined;
  emergencyContactRelationship?: string | undefined;
  emergencyContactPhone?: string | undefined;
  departmentId: string;
  positionId: string;
  managerId?: string | undefined;
  hireDate: string;
  employmentType: string;
  salary?: number | undefined;
  status?: string | undefined;
}

export const employeeRepo = {
  list: async (params?: { search?: string; status?: string; departmentId?: string }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.status) q.set('status', params.status);
    if (params?.departmentId) q.set('departmentId', params.departmentId);
    const res = await api.get<{ employees: BackendRecord[] }>(
      `/api/employees${q.toString() ? `?${q.toString()}` : ''}`,
    );
    return (res.employees ?? []).map(adaptEmployee);
  },
  get: async (id: string) => {
    const res = await api.get<BackendRecord>(`/api/employees/${id}`);
    return adaptEmployee(res);
  },
  create: async (payload: CreateEmployeePayload) => {
    return api.post<{ id: string; employeeNo: string }>('/api/employees', payload);
  },
  update: async (id: string, payload: Partial<CreateEmployeePayload>) => {
    return api.put<{ message: string }>(`/api/employees/${id}`, payload);
  },
  listChanges: async (id: string) => {
    const res = await api.get<{ changes: BackendRecord[] }>(`/api/employees/${id}/changes`);
    return res.changes ?? [];
  },
  recordChange: (
    id: string,
    payload: {
      changeType: string;
      oldValue?: unknown;
      newValue?: unknown;
      effectiveDate: string;
      reason?: string;
    },
  ) => api.post(`/api/employees/${id}/changes`, payload),
  applyChange: (id: string, changeId: string) =>
    api.patch(`/api/employees/${id}/changes/${changeId}/apply`),
  selfUpdate: async (
    id: string,
    fields: {
      phone?: string | undefined;
      address?: string | undefined;
      emergencyContactName?: string | undefined;
      emergencyContactRelationship?: string | undefined;
      emergencyContactPhone?: string | undefined;
    },
  ) => {
    return api.put<{ message: string }>(`/api/employees/${id}/self`, fields);
  },
  uploadAvatar: async (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest<{ message: string; avatarUrl: string }>(`/api/employees/${id}/avatar`, {
      method: 'POST',
      body: formData,
      json: false,
    });
  },
  removeAvatar: (id: string) => api.del<{ message: string }>(`/api/employees/${id}/avatar`),
};

/**
 * Departments
 */

/** Payload for creating a department. Maps to the backend create schema. */
export interface CreateDepartmentPayload {
  name: string;
  description?: string | undefined;
  parentId?: string | null;
}

/** Payload for updating a department. All fields optional. */
export interface UpdateDepartmentPayload {
  name?: string | undefined;
  description?: string | undefined;
  parentId?: string | null;
}

export const departmentRepo = {
  list: async () => {
    const res = await api.get<{ departments: BackendRecord[] }>('/api/departments');
    return (res.departments ?? []).map(adaptDepartment);
  },
  create: async (payload: CreateDepartmentPayload) => {
    const body: Record<string, unknown> = { name: payload.name };
    if (payload.description !== undefined) body.description = payload.description;
    // Send null/undefined parent as undefined so the backend creates a root.
    if (payload.parentId) body.parentId = payload.parentId;
    const created = await api.post<BackendRecord>('/api/departments', body);
    return adaptDepartment(created);
  },
  update: async (id: string, payload: UpdateDepartmentPayload) => {
    const body: Record<string, unknown> = {};
    if (payload.name !== undefined) body.name = payload.name;
    if (payload.description !== undefined) body.description = payload.description;
    // Backend update schema accepts parentId as nullable for clearing the parent.
    if (payload.parentId !== undefined) body.parentId = payload.parentId;
    return api.put<BackendRecord>(`/api/departments/${id}`, body);
  },
  delete: async (id: string) => {
    return api.del<{ message: string }>(`/api/departments/${id}`);
  },
};

/**
 * Positions
 */

/** Payload for creating a position. Maps to the backend create schema. */
export interface CreatePositionPayload {
  name: string;
  grade?: string | undefined;
  description?: string | undefined;
  departmentId: string;
}

/** Payload for updating a position. All fields optional. */
export interface UpdatePositionPayload {
  name?: string | undefined;
  grade?: string | undefined;
  description?: string | undefined;
}

export const positionRepo = {
  list: async (departmentId?: string) => {
    const q = departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : '';
    const res = await api.get<{ positions: BackendRecord[] }>(`/api/positions${q}`);
    return (res.positions ?? []).map(adaptPosition);
  },
  create: async (payload: CreatePositionPayload) => {
    const body: Record<string, unknown> = {
      name: payload.name,
      departmentId: payload.departmentId,
    };
    if (payload.grade !== undefined) body.grade = payload.grade;
    if (payload.description !== undefined) body.description = payload.description;
    const created = await api.post<BackendRecord>('/api/positions', body);
    return adaptPosition(created);
  },
  update: async (id: string, payload: UpdatePositionPayload) => {
    const body: Record<string, unknown> = {};
    if (payload.name !== undefined) body.name = payload.name;
    if (payload.grade !== undefined) body.grade = payload.grade;
    if (payload.description !== undefined) body.description = payload.description;
    return api.put<BackendRecord>(`/api/positions/${id}`, body);
  },
  delete: async (id: string) => {
    return api.del<{ message: string }>(`/api/positions/${id}`);
  },
};

/**
 * Users (Admin)
 */

/** Payload for inviting a new user. `role` uses the backend Prisma enum. */
export interface InviteUserPayload {
  email: string;
  role: string;
  employeeId?: string | undefined;
}

export const userRepo = {
  list: async (params?: { search?: string; role?: string }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.role) q.set('role', params.role);
    const res = await api.get<{ users: BackendRecord[] }>(
      `/api/users${q.toString() ? `?${q.toString()}` : ''}`,
    );
    return (res.users ?? []).map(adaptUser);
  },
  invite: async (payload: InviteUserPayload) => {
    return api.post<{ message: string }>('/api/users/invite', payload);
  },
  changeRole: async (id: string, role: string) => {
    return api.patch<{ message: string }>(`/api/users/${id}/role`, { role });
  },
  changeStatus: async (id: string, status: string) => {
    return api.patch<{ message: string }>(`/api/users/${id}/status`, { status });
  },
  resetPassword: async (id: string) => {
    return api.post<{ message: string }>(`/api/users/${id}/reset-password`);
  },
  delete: async (id: string) => {
    return api.del<{ message: string }>(`/api/users/${id}`);
  },
};

/**
 * Documents
 */
export const documentRepo = {
  listByEmployee: async (employeeId: string) => {
    const res = await api.get<{ documents: BackendRecord[] }>(
      `/api/documents/employee/${employeeId}`,
    );
    return (res.documents ?? []).map(adaptDocument);
  },
};

/**
 * Audit log
 */
export const auditLogRepo = {
  list: async (params: {
    action?: string | undefined;
    entity?: string | undefined;
    search?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    user?: string | undefined;
    page: number;
    pageSize: number;
  }) => {
    const q = new URLSearchParams();
    if (params.action) q.set('action', params.action);
    if (params.entity) q.set('entity', params.entity);
    if (params.search) q.set('search', params.search);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.user) q.set('user', params.user);
    q.set('page', String(params.page));
    q.set('pageSize', String(params.pageSize));
    const res = await api.get<{
      logs: BackendRecord[];
      pagination?: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/api/audit-log?${q.toString()}`);
    return {
      logs: (res.logs ?? []).map(adaptAuditLog),
      total: res.pagination?.total ?? 0,
    };
  },
};

/**
 * Expiry alerts
 */
export const alertRepo = {
  list: async (acknowledged?: boolean) => {
    const q = acknowledged === undefined ? '' : `?acknowledged=${acknowledged}`;
    const res = await api.get<{ alerts: BackendRecord[] }>(`/api/alerts${q}`);
    return (res.alerts ?? []).map(adaptExpiryAlert);
  },
};

/**
 * GDPR — Data Retention
 */
export const retentionRepo = {
  listPolicies: async () => {
    const res = await api.get<{ policies: BackendRecord[] }>('/api/retention/policies');
    return (res.policies ?? []).map(adaptRetentionPolicy);
  },
  upsertPolicy: async (payload: {
    dataCategory: string;
    retentionYears: number;
    action: string;
    description?: string;
    isDefault?: boolean;
  }) => {
    // The backend exposes upsert as PUT /api/retention/policies.
    return api.put<{ policy: BackendRecord }>('/api/retention/policies', payload);
  },
  purge: async (dryRun: boolean) => {
    const q = dryRun ? '?dryRun=true' : '';
    return api.post<BackendRecord>(`/api/retention/purge${q}`);
  },
  placeLegalHold: async (payload: { entityType: string; entityId: string; reason: string }) => {
    return api.post<{ hold: BackendRecord }>('/api/retention/legal-hold', payload);
  },
  releaseLegalHold: async (id: string) => {
    return api.del<{ hold: BackendRecord }>(`/api/retention/legal-hold/${id}`);
  },
};

/**
 * GDPR — DSAR
 */
export const dsarRepo = {
  list: async (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await api.get<{ dsars: BackendRecord[] }>(`/api/dsar${q}`);
    return (res.dsars ?? []).map(adaptDsar);
  },
  create: async (payload: {
    requestType: string;
    dataSubjectEmail: string;
    description?: string;
  }) => {
    return api.post<{ dsar: BackendRecord }>('/api/dsar', payload);
  },
  updateStatus: async (
    id: string,
    payload: { status: string; rejectionReason?: string; assignedToId?: string },
  ) => {
    return api.patch<{ dsar: BackendRecord }>(`/api/dsar/${id}/status`, payload);
  },
};

/**
 * GDPR — Breach register
 */
export const breachRepo = {
  list: async (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await api.get<{ breaches: BackendRecord[] }>(`/api/breach${q}`);
    return (res.breaches ?? []).map(adaptBreach);
  },
  get: async (id: string) => {
    const res = await api.get<{ breach: BackendRecord }>(`/api/breach/${id}`);
    return adaptBreach(res.breach);
  },
  create: async (payload: {
    title: string;
    description: string;
    detectionAt: string;
    severity: string;
    isHighRisk: boolean;
    dataCategoriesAffected: string[];
    affectedSubjectsCount: number;
  }) => {
    return api.post<{ breach: BackendRecord }>('/api/breach', payload);
  },
  update: async (id: string, payload: Partial<BackendRecord>) => {
    return api.patch<{ breach: BackendRecord }>(`/api/breach/${id}`, payload);
  },
  recordNotification: async (
    id: string,
    payload: { notificationType: string; method: string; reference?: string },
  ) => {
    return api.post<{ notification: BackendRecord }>(`/api/breach/${id}/notification`, payload);
  },
  getTemplate: async (id: string) => {
    const res = await api.get<{ template: string }>(`/api/breach/${id}/template`);
    return res.template;
  },
};

/**
 * GDPR — Anomaly alerts
 */
export const anomalyRepo = {
  list: async () => {
    const res = await api.get<{ alerts: BackendRecord[] }>('/api/anomalies');
    return (res.alerts ?? []).map(adaptAnomalyAlert);
  },
  dismiss: async (id: string, dismissalReason: string) => {
    return api.patch<{ alert: BackendRecord }>(`/api/anomalies/${id}/dismiss`, {
      dismissalReason,
    });
  },
  review: async (id: string) => {
    return api.patch<{ alert: BackendRecord }>(`/api/anomalies/${id}/review`, {});
  },
};

/**
 * GDPR — Consent
 */
export const consentRepo = {
  list: async (params?: {
    dataSubjectUserId?: string | undefined;
    dataSubjectEmail?: string | undefined;
  }) => {
    const q = new URLSearchParams();
    if (params?.dataSubjectUserId) q.set('dataSubjectUserId', params.dataSubjectUserId);
    if (params?.dataSubjectEmail) q.set('dataSubjectEmail', params.dataSubjectEmail);
    const res = await api.get<{ consents: BackendRecord[] }>(
      `/api/consent${q.toString() ? `?${q.toString()}` : ''}`,
    );
    return (res.consents ?? []).map(adaptConsent);
  },
  record: async (payload: {
    dataSubjectEmail: string;
    processingPurpose: string;
    consentText: string;
    noticeVersion: string;
    mechanism: string;
  }) => {
    return api.post<{ consent: BackendRecord }>('/api/consent', payload);
  },
  withdraw: async (originalConsentId: string, lawfulBasisOverride?: string) => {
    return api.post<{ withdrawal: BackendRecord }>('/api/consent/withdraw', {
      originalConsentId,
      ...(lawfulBasisOverride ? { lawfulBasisOverride } : {}),
    });
  },
};

/**
 * GDPR — Key management
 */
export const keyRepo = {
  listVersions: async (purpose?: string) => {
    const q = purpose ? `?purpose=${encodeURIComponent(purpose)}` : '';
    const res = await api.get<{ versions: BackendRecord[] }>(`/api/keys${q}`);
    return (res.versions ?? []).map(adaptKeyVersion);
  },
  status: async () => {
    const res = await api.get<{ statuses: BackendRecord[] }>('/api/keys/status');
    return res.statuses ?? [];
  },
  rotate: async (purpose: string) => {
    return api.post<{ message: string; newVersion: BackendRecord }>('/api/keys/rotate', {
      purpose,
    });
  },
};

/**
 * GDPR — Data Subject Rights (Art. 15/17/20)
 */
export const dataSubjectRightsRepo = {
  access: async (userId: string) => {
    const res = await api.get<{ data: BackendRecord }>(`/api/data-subject-rights/access/${userId}`);
    return res.data;
  },
  erasure: async (userId: string) => {
    return api.post<BackendRecord>(`/api/data-subject-rights/erasure/${userId}`);
  },
  /**
   * Export a portable copy (Art. 20). Unlike other API calls this triggers an
   * actual browser download via a blob URL, so the format choice is honored and
   * the user receives the file (JSON or CSV).
   */
  exportData: async (userId: string, format: 'json' | 'csv') => {
    const path = `/api/data-subject-rights/export/${userId}?format=${format}`;
    const accessToken = authStorage.getAccessToken();
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch(`${config.apiBase}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });

    if (!res.ok) {
      let message = `Export failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // fall through to the default message
      }
      throw new ApiError(res.status, message);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const filenameMatch = /filename="?([^"]+)"?/.exec(disposition);
    const filename = filenameMatch?.[1] ?? `data-export-${userId}.${format}`;

    // Trigger the browser download.
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
};
