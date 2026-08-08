import { useCallback, useEffect, useRef, useState } from 'react';
import { config, isRealBackend } from '@/lib/config';
import { ApiError } from '@/lib/api-client';
import {
  anomalyRepo,
  auditLogRepo,
  alertRepo,
  breachRepo,
  consentRepo,
  dataSubjectRightsRepo,
  departmentRepo,
  documentRepo,
  dsarRepo,
  employeeRepo,
  keyRepo,
  positionRepo,
  retentionRepo,
  userRepo,
} from '@/lib/api/repositories';
import type {
  AnomalyAlert,
  AuditLogEntry,
  AuditLogQueryParams,
  ConsentRecord,
  DataBreach,
  DataSubjectAccessRequest,
  Department,
  Employee,
  EmployeeDocument,
  EncryptionKeyVersion,
  ExpiryAlert,
  Position,
  RetentionPolicy,
  Role,
  User,
} from '@/types';
import {
  auditLog as mockAuditLog,
  departments as mockDepartments,
  documents as mockDocuments,
  employees as mockEmployees,
  expiryAlerts as mockExpiryAlerts,
  mockAnomalyAlerts,
  mockBreaches,
  mockConsentRecords,
  mockDsars,
  mockKeyVersions,
  mockRetentionPolicies,
  positions as mockPositions,
  systemUsers as mockUsers,
} from '@/data/mock-data';

/**
 * Unified data access layer.
 *
 * Every consumer should go through here rather than importing mock-data
 * directly. When `config.useMock` is true the functions resolve to the local
 * mock arrays; when false they call the real backend via the repositories.
 *
 * Graceful fallback: if a real API call fails (backend offline, endpoint
 * missing), the resolver logs the error and falls back to mock data so the UI
 * keeps working. The `useData` hook exposes `mode` ('mock' | 'api' | 'fallback')
 * so pages can surface a warning.
 */

export type DataMode = 'mock' | 'api' | 'fallback';

export { isRealBackend };

/** Map a backend role enum (e.g. ADMIN) to the frontend Role label. */
export function mapRole(role: string | undefined | null): Role {
  const normalized = (role ?? '').toUpperCase().replace(/[\s_-]+/g, '_');
  switch (normalized) {
    case 'ADMIN':
      return 'Admin';
    case 'HR_MANAGER':
      return 'HR Manager';
    case 'MANAGER':
      return 'Manager';
    case 'EMPLOYEE':
      return 'Employee';
    default:
      return 'Employee';
  }
}

/** Map a frontend Role label to the backend Prisma enum value. */
export function toBackendRole(role: Role): string {
  switch (role) {
    case 'Admin':
      return 'ADMIN';
    case 'HR Manager':
      return 'HR_MANAGER';
    case 'Manager':
      return 'MANAGER';
    case 'Employee':
      return 'EMPLOYEE';
    default:
      return 'EMPLOYEE';
  }
}

/** Map a frontend user status literal to the backend Prisma enum value. */
export function toBackendStatus(status: User['status']): string {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'deactivated':
      return 'DEACTIVATED';
    case 'pending_setup':
      return 'PENDING_SETUP';
    default:
      return 'ACTIVE';
  }
}

/**
 * Wrap a real API call with graceful fallback to mock data.
 *
 * Best-practice note: authentication failures (401/403) are NEVER masked with
 * mock data. Falling back to placeholder data on an expired/invalid session
 * would present fake records as if they were real and hide the underlying
 * auth problem. Those errors propagate so the session-expiry handler can log
 * the user out, and callers can surface the error. Fallback is reserved for
 * genuine server/network unavailability, which keeps the demo resilient.
 */
function withFallback<T>(real: () => Promise<T>, mock: T): Promise<{ data: T; mode: DataMode }> {
  if (config.useMock) {
    // Mock mode: the request is intercepted at the network layer by MSW, so
    // calling `real()` returns mock data. If MSW is not running (e.g. in unit
    // tests where repositories are stubbed), fall back to the static array.
    return real()
      .then((data) => ({ data, mode: 'mock' as DataMode }))
      .catch((err) => {
        // Never mask auth failures with mock data — propagate them.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          throw err;
        }
        return { data: mock, mode: 'mock' as DataMode };
      });
  }
  return real()
    .then((data) => ({ data, mode: 'api' as DataMode }))
    .catch((err) => {
      // Never mask auth failures with mock data — propagate them.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        throw err;
      }
      // Fallback to mock data is dev-only. In production, surface the real
      // error instead of silently substituting placeholder data.
      if (import.meta.env.DEV) {
        console.warn('[data-layer] API request failed, falling back to mock data:', err);
        return { data: mock, mode: 'fallback' as DataMode };
      }
      throw err;
    });
}

export function getEmployees(): Promise<{ data: Employee[]; mode: DataMode }> {
  return withFallback(() => employeeRepo.list(), mockEmployees);
}

/**
 * Create a new employee via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function createEmployee(
  payload: Parameters<typeof employeeRepo.create>[0],
): Promise<{ id: string; employeeNo: string }> {
  return employeeRepo.create(payload);
}

/**
 * Update an existing employee via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function updateEmployee(
  id: string,
  payload: Parameters<typeof employeeRepo.update>[1],
): Promise<void> {
  await employeeRepo.update(id, payload);
}

export function getDepartments(): Promise<{ data: Department[]; mode: DataMode }> {
  return withFallback(() => departmentRepo.list(), mockDepartments);
}

/**
 * Create a department via the real backend.
 * Returns the created department (with its real backend id) so the caller can
 * keep local state in sync. Throws on failure — no mock fallback for writes so
 * data isn't silently lost.
 */
export async function createDepartment(
  payload: Parameters<typeof departmentRepo.create>[0],
): Promise<Department> {
  return departmentRepo.create(payload);
}

/**
 * Update a department via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function updateDepartment(
  id: string,
  payload: Parameters<typeof departmentRepo.update>[1],
): Promise<void> {
  await departmentRepo.update(id, payload);
}

/**
 * Delete a department via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function deleteDepartment(id: string): Promise<void> {
  await departmentRepo.delete(id);
}

export function getPositions(): Promise<{ data: Position[]; mode: DataMode }> {
  return withFallback(() => positionRepo.list(), mockPositions);
}

/**
 * Create a position via the real backend.
 * Returns the created position (with its real backend id) so the caller can
 * keep local state in sync. Throws on failure — no mock fallback for writes so
 * data isn't silently lost.
 */
export async function createPosition(
  payload: Parameters<typeof positionRepo.create>[0],
): Promise<Position> {
  return positionRepo.create(payload);
}

/**
 * Update a position via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function updatePosition(
  id: string,
  payload: Parameters<typeof positionRepo.update>[1],
): Promise<void> {
  await positionRepo.update(id, payload);
}

/**
 * Delete a position via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function deletePosition(id: string): Promise<void> {
  await positionRepo.delete(id);
}

export function getUsers(): Promise<{ data: User[]; mode: DataMode }> {
  return withFallback(() => userRepo.list(), mockUsers);
}

/**
 * Invite a new user via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function inviteUser(payload: {
  email: string;
  role: Role;
  employeeId?: string | undefined;
}): Promise<void> {
  await userRepo.invite({
    email: payload.email,
    role: toBackendRole(payload.role),
    employeeId: payload.employeeId,
  });
}

/**
 * Change a user's role via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function changeUserRole(id: string, role: Role): Promise<void> {
  await userRepo.changeRole(id, toBackendRole(role));
}

/**
 * Change a user's status (activate/deactivate) via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function changeUserStatus(id: string, status: User['status']): Promise<void> {
  await userRepo.changeStatus(id, toBackendStatus(status));
}

/**
 * Trigger an admin password reset via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function adminResetPassword(id: string): Promise<void> {
  await userRepo.resetPassword(id);
}

/**
 * Delete (soft-delete) a user via the real backend.
 * Throws on failure — no mock fallback for writes so data isn't silently lost.
 */
export async function deleteUser(id: string): Promise<void> {
  await userRepo.delete(id);
}

/** Filter the mock audit log array using the same params the backend supports. */
function filterMockAuditLog(
  entries: AuditLogEntry[],
  params: AuditLogQueryParams,
): { logs: AuditLogEntry[]; total: number } {
  const { action, entity, search, from, to, user, hrScoped } = params;
  let filtered = entries;
  // Mirror the backend's HR-scope entity restriction for mock/fallback parity.
  if (hrScoped) {
    const scoped = new Set(['employees', 'documents']);
    filtered = filtered.filter((e) => scoped.has(e.entity.toLowerCase()));
  }
  if (action && action !== 'all') {
    filtered = filtered.filter((e) => e.action === action);
  }
  if (entity && entity !== 'all') {
    filtered = filtered.filter((e) => e.entity.toLowerCase() === entity);
  }
  // Date-range filter (inclusive). A bare `to` bound covers the whole day so
  // entries recorded on the last day of the range are kept.
  if (from || to) {
    const fromTs = from ? new Date(from).getTime() : -Infinity;
    const toTs = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
    filtered = filtered.filter((e) => {
      const ts = new Date(e.timestamp).getTime();
      return ts >= fromTs && ts <= toTs;
    });
  }
  // Filter by the actor (user) — matches user id or display name.
  if (user) {
    const q = user.toLowerCase();
    filtered = filtered.filter(
      (e) => e.actorId.toLowerCase().includes(q) || e.actorName.toLowerCase().includes(q),
    );
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((e) =>
      `${e.actorName} ${e.entityLabel} ${e.entity} ${e.entityId} ${e.changes
        .map((c) => `${c.field} ${c.old ?? ''} ${c.new ?? ''}`)
        .join(' ')}`
        .toLowerCase()
        .includes(q),
    );
  }
  // Sort newest first for parity with the backend ordering.
  const sorted = [...filtered].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const total = sorted.length;
  const start = (params.page - 1) * params.pageSize;
  const logs = sorted.slice(start, start + params.pageSize);
  return { logs, total };
}

/**
 * Fetch a page of audit log entries.
 *
 * In mock mode this slices the mock array by page/pageSize and computes the
 * total so mock and real behavior match. In API mode the params (action,
 * entity, search, page, pageSize) are sent to the backend, which applies the
 * filters and pagination server-side.
 */
export function getAuditLog(
  params: AuditLogQueryParams,
): Promise<{ data: { logs: AuditLogEntry[]; total: number }; mode: DataMode }> {
  const { page, pageSize } = params;
  const safePage = Math.max(1, page);
  const safePageSize = [10, 25, 50, 100].includes(pageSize) ? pageSize : 25;
  return withFallback(
    () => auditLogRepo.list({ ...params, page: safePage, pageSize: safePageSize }),
    filterMockAuditLog(mockAuditLog, { ...params, page: safePage, pageSize: safePageSize }),
  );
}

export function getExpiryAlerts(): Promise<{ data: ExpiryAlert[]; mode: DataMode }> {
  return withFallback(() => alertRepo.list(), mockExpiryAlerts);
}

export function getDocuments(
  employeeId: string,
): Promise<{ data: EmployeeDocument[]; mode: DataMode }> {
  const mock = mockDocuments.filter((d) => d.employeeId === employeeId);
  return withFallback(() => documentRepo.listByEmployee(employeeId), mock);
}

interface DataHookResult<T> {
  data: T;
  loading: boolean;
  error: string | null;
  mode: DataMode;
  reload: () => void;
}

/**
 * React hook wrapping an async data loader with loading/error state and a
 * manual reload trigger.
 */
export function useData<T>(
  loader: () => Promise<{ data: T; mode: DataMode }>,
  initialData: T,
): DataHookResult<T> {
  const [state, setState] = useState<{
    data: T;
    loading: boolean;
    error: string | null;
    mode: DataMode;
  }>({
    data: initialData,
    loading: true,
    error: null,
    mode: 'mock',
  });
  const [tick, setTick] = useState(0);

  // Track the loader identity the hook is currently running with. When a new
  // loader is provided (e.g. a different resource or a dependency changed),
  // we re-run the fetch effect. Inline loaders that are recreated on every
  // render (but are semantically the same) are skipped so they don't cause an
  // infinite fetch/render loop.
  const loaderRef = useRef(loader);
  const prevLoaderRef = useRef(loader);

  // Detect a genuine loader identity change without mutating during render.
  useEffect(() => {
    if (prevLoaderRef.current !== loader) {
      prevLoaderRef.current = loader;
      setTick((t) => t + 1);
    }
  }, [loader]);

  useEffect(() => {
    let cancelled = false;
    loaderRef
      .current()
      .then(({ data, mode }) => {
        if (!cancelled) setState({ data, loading: false, error: null, mode });
      })
      .catch((err) => {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load data.',
            mode: 'mock',
          }));
        }
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch when the loader identity changes OR an explicit reload is
    // requested (tick changes).
  }, [tick]);

  // Keep the latest loader in a ref without mutating it during render.
  useEffect(() => {
    loaderRef.current = loader;
  });

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    mode: state.mode,
    reload: () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      setTick((t) => t + 1);
    },
  };
}

export function useEmployees() {
  return useData(getEmployees, []);
}
export function useDepartments() {
  return useData(getDepartments, []);
}
export function usePositions() {
  return useData(getPositions, []);
}
export function useUsers() {
  return useData(getUsers, []);
}
export function useAuditLog(params: AuditLogQueryParams) {
  const page = params.page;
  const pageSize = params.pageSize;
  const action = params.action;
  const entity = params.entity;
  const search = params.search;
  const from = params.from;
  const to = params.to;
  const user = params.user;
  const hrScoped = params.hrScoped;
  const loader = useCallback(
    () => getAuditLog({ action, entity, search, from, to, user, page, pageSize, hrScoped }),
    [action, entity, search, from, to, user, page, pageSize, hrScoped],
  );
  return useData(loader, { logs: [], total: 0 });
}
export function useExpiryAlerts() {
  return useData(getExpiryAlerts, []);
}
export function useDocuments(employeeId: string) {
  const loader = useCallback(() => getDocuments(employeeId), [employeeId]);
  return useData(loader, []);
}

// ---------------------------------------------------------------------------
// GDPR data access
// ---------------------------------------------------------------------------

export function getRetentionPolicies(): Promise<{ data: RetentionPolicy[]; mode: DataMode }> {
  return withFallback(() => retentionRepo.listPolicies(), mockRetentionPolicies);
}
export function useRetentionPolicies() {
  return useData(getRetentionPolicies, []);
}

export async function upsertRetentionPolicy(
  payload: Parameters<typeof retentionRepo.upsertPolicy>[0],
): Promise<{ policy: RetentionPolicy }> {
  const res = await retentionRepo.upsertPolicy(payload);
  return { policy: res.policy as unknown as RetentionPolicy };
}
export async function runRetentionPurge(dryRun: boolean): Promise<void> {
  await retentionRepo.purge(dryRun);
}
export async function placeLegalHold(payload: {
  entityType: string;
  entityId: string;
  reason: string;
}): Promise<void> {
  await retentionRepo.placeLegalHold(payload);
}
export async function releaseLegalHold(id: string): Promise<void> {
  await retentionRepo.releaseLegalHold(id);
}

export function getDsars(
  status?: string,
): Promise<{ data: DataSubjectAccessRequest[]; mode: DataMode }> {
  const loader = () => dsarRepo.list(status);
  const filteredMock = status ? mockDsars.filter((d) => d.status === status) : mockDsars;
  return withFallback(loader, filteredMock);
}
export function useDsars(status?: string) {
  const loader = useCallback(() => getDsars(status), [status]);
  return useData(loader, []);
}
export async function createDsar(payload: {
  requestType: string;
  dataSubjectEmail: string;
  description?: string;
}): Promise<void> {
  await dsarRepo.create(payload);
}
export async function updateDsarStatus(
  id: string,
  payload: { status: string; rejectionReason?: string; assignedToId?: string },
): Promise<void> {
  await dsarRepo.updateStatus(id, payload);
}

export function getBreaches(status?: string): Promise<{ data: DataBreach[]; mode: DataMode }> {
  const loader = () => breachRepo.list(status);
  const filteredMock = status
    ? mockBreaches.filter((b) => b.containmentStatus === status)
    : mockBreaches;
  return withFallback(loader, filteredMock);
}
export function useBreaches(status?: string) {
  const loader = useCallback(() => getBreaches(status), [status]);
  return useData(loader, []);
}
export async function createBreach(
  payload: Parameters<typeof breachRepo.create>[0],
): Promise<void> {
  await breachRepo.create(payload);
}
export async function updateBreach(
  id: string,
  payload: Parameters<typeof breachRepo.update>[1],
): Promise<void> {
  await breachRepo.update(id, payload);
}
export async function recordBreachNotification(
  id: string,
  payload: { notificationType: string; method: string; reference?: string },
): Promise<void> {
  await breachRepo.recordNotification(id, payload);
}

export function getAnomalyAlerts(): Promise<{ data: AnomalyAlert[]; mode: DataMode }> {
  return withFallback(() => anomalyRepo.list(), mockAnomalyAlerts);
}
export function useAnomalyAlerts() {
  return useData(getAnomalyAlerts, []);
}
export async function dismissAnomaly(id: string, dismissalReason: string): Promise<void> {
  await anomalyRepo.dismiss(id, dismissalReason);
}

export function getConsentRecords(params?: {
  dataSubjectUserId?: string | undefined;
  dataSubjectEmail?: string | undefined;
}): Promise<{ data: ConsentRecord[]; mode: DataMode }> {
  const loader = () => consentRepo.list(params);
  const filteredMock = params?.dataSubjectEmail
    ? mockConsentRecords.filter((c) => c.dataSubjectEmail === params.dataSubjectEmail)
    : mockConsentRecords;
  return withFallback(loader, filteredMock);
}
export function useConsentRecords(params?: {
  dataSubjectUserId?: string | undefined;
  dataSubjectEmail?: string | undefined;
}) {
  const dataSubjectUserId = params?.dataSubjectUserId;
  const dataSubjectEmail = params?.dataSubjectEmail;
  const loader = useCallback(
    () => getConsentRecords({ dataSubjectUserId, dataSubjectEmail }),
    [dataSubjectUserId, dataSubjectEmail],
  );
  return useData(loader, []);
}
export async function recordConsent(
  payload: Parameters<typeof consentRepo.record>[0],
): Promise<void> {
  await consentRepo.record(payload);
}
export async function withdrawConsent(
  originalConsentId: string,
  lawfulBasisOverride?: string,
): Promise<void> {
  await consentRepo.withdraw(originalConsentId, lawfulBasisOverride);
}

export function getKeyVersions(
  purpose?: string,
): Promise<{ data: EncryptionKeyVersion[]; mode: DataMode }> {
  const loader = () => keyRepo.listVersions(purpose);
  const filteredMock = purpose
    ? mockKeyVersions.filter((k) => k.purpose === purpose)
    : mockKeyVersions;
  return withFallback(loader, filteredMock);
}
export function useKeyVersions(purpose?: string) {
  const loader = useCallback(() => getKeyVersions(purpose), [purpose]);
  return useData(loader, []);
}
export async function rotateKey(purpose: string): Promise<void> {
  await keyRepo.rotate(purpose);
}

export async function requestDataExport(userId: string, format: 'json' | 'csv'): Promise<void> {
  await dataSubjectRightsRepo.exportData(userId, format);
}
export async function requestDataAccess(userId: string): Promise<unknown> {
  return dataSubjectRightsRepo.access(userId);
}
export async function requestDataErasure(userId: string): Promise<void> {
  await dataSubjectRightsRepo.erasure(userId);
}
