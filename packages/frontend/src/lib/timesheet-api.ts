/**
 * Timesheet API repositories.
 *
 * Thin wrappers over the shared `api-client` fetch wrapper targeting the
 * timesheet endpoints defined in `temp/docs/timesheet-api-contract.md`. The
 * backend returns camelCase DTOs matching `@/types/timesheet` directly, so no
 * adapters are needed (unlike snake_case legacy endpoints).
 *
 * Read functions throw `ApiError` on failure; writes return the contract
 * response shapes so pages can refresh state in one round-trip (entry
 * mutations return the owning TimesheetDetail with recomputed totals).
 */
import { api, apiRequest, ApiError } from './api-client';
import { authStorage } from './auth-storage';
import { config } from './config';
import type {
  CreateEntryPayload,
  CreateProjectPayload,
  DetailsReportResponse,
  Project,
  ProjectAdminStats,
  ProjectTask,
  ReportGroupBy,
  SummaryReportResponse,
  TimesheetDetail,
  TimesheetStatus,
  TimesheetSummary,
  UpdateEntryPayload,
  UpdateProjectPayload,
} from '@/types/timesheet';

// ── Timesheets ─────────────────────────────────────────────────────────────

export const timesheetRepo = {
  /** List the current user's timesheets (paged, optional status filter). */
  list: async (params?: { status?: TimesheetStatus; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    const res = await api.get<{
      timesheets: TimesheetSummary[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/timesheets${q.toString() ? `?${q.toString()}` : ''}`);
    return res;
  },

  /** Get-or-create the timesheet for the week containing `date` (default now). */
  getCurrent: async (date?: string) => {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    const res = await api.get<{ timesheet: TimesheetDetail }>(`/api/timesheets/current${q}`);
    return res.timesheet;
  },

  /** Manager approval queue: SUBMITTED timesheets of direct reports (HR/ADMIN: all). */
  getPending: async () => {
    const res = await api.get<{ timesheets: TimesheetSummary[] }>('/api/timesheets/pending');
    return res.timesheets;
  },

  /** Full timesheet detail (owner / manager-of / HR / ADMIN). */
  getById: async (id: string) => {
    const res = await api.get<{ timesheet: TimesheetDetail }>(`/api/timesheets/${id}`);
    return res.timesheet;
  },

  /** DRAFT|REJECTED → SUBMITTED. Returns the updated timesheet. */
  submit: async (id: string) => {
    const res = await api.post<{ timesheet: TimesheetDetail }>(`/api/timesheets/${id}/submit`);
    return res.timesheet;
  },

  /** SUBMITTED → APPROVED. Comment optional. */
  approve: async (id: string, comment?: string) => {
    const res = await api.post<{ timesheet: TimesheetDetail }>(`/api/timesheets/${id}/approve`, {
      ...(comment ? { comment } : {}),
    });
    return res.timesheet;
  },

  /** SUBMITTED → REJECTED (unlocks editing). Comment required (1–500 chars). */
  reject: async (id: string, comment: string) => {
    const res = await api.post<{ timesheet: TimesheetDetail }>(`/api/timesheets/${id}/reject`, {
      comment,
    });
    return res.timesheet;
  },
};

// ── Timesheet entries ──────────────────────────────────────────────────────

/**
 * Create an entry in the week's timesheet (get-or-create DRAFT). Returns the
 * owning timesheet detail so grids and totals refresh in one round-trip.
 */
const createEntry = async (payload: CreateEntryPayload) => {
  const res = await api.post<{ timesheet: TimesheetDetail }>('/api/timesheet-entries', payload);
  return res.timesheet;
};

/** Update an entry (owner only, unlocked timesheet). */
const updateEntry = async (id: string, payload: UpdateEntryPayload) => {
  const res = await api.patch<{ timesheet: TimesheetDetail }>(
    `/api/timesheet-entries/${id}`,
    payload,
  );
  return res.timesheet;
};

/** Soft-delete an entry (owner only, unlocked timesheet). */
const removeEntry = async (id: string) => {
  const res = await api.del<{ timesheet: TimesheetDetail }>(`/api/timesheet-entries/${id}`);
  return res.timesheet;
};

/**
 * A single changed grid cell handed to {@link timesheetEntryRepo.applyWeekChanges}.
 * `entryIds` lists the server entries currently representing the cell, so the
 * batch can decide between create / update / delete.
 */
export interface WeekCellChangeDto {
  projectId: string;
  taskId: string | null;
  entryDate: string;
  /** Desired hours; `0` removes the cell's entries. */
  hours: number;
  entryIds: string[];
}

export const timesheetEntryRepo = {
  create: createEntry,
  update: updateEntry,
  remove: removeEntry,

  /**
   * Persist a whole week of grid edits in one user action.
   *
   * The contract has no bulk endpoint, so the cells are reconciled one by one:
   * an empty cell deletes its entries, a filled cell without entries is
   * created, and a filled cell with exactly one entry is updated. Calls are
   * sequential, and because every mutation returns the owning timesheet the
   * last response already reflects every earlier change.
   */
  applyWeekChanges: async (changes: WeekCellChangeDto[]): Promise<TimesheetDetail> => {
    if (changes.length === 0) throw new ApiError(400, 'There are no changes to save.');

    let latest: TimesheetDetail | null = null;

    for (const change of changes) {
      if (change.hours <= 0) {
        for (const id of change.entryIds) {
          latest = await removeEntry(id);
        }
        continue;
      }
      const [existingId] = change.entryIds;
      if (existingId === undefined) {
        latest = await createEntry({
          entryDate: change.entryDate,
          projectId: change.projectId,
          taskId: change.taskId,
          hours: change.hours,
        });
      } else {
        latest = await updateEntry(existingId, { hours: change.hours });
      }
    }

    if (latest === null) throw new ApiError(400, 'There are no changes to save.');
    return latest;
  },
};

// ── Projects & tasks (catalog) ─────────────────────────────────────────────

export const projectRepo = {
  /**
   * List projects. Active only by default; `includeInactive` requires
   * HR_MANAGER/ADMIN (enforced server-side).
   */
  list: async (includeInactive = false) => {
    const q = includeInactive ? '?includeInactive=true' : '';
    const res = await api.get<{ projects: Project[] }>(`/api/projects${q}`);
    return res.projects;
  },

  /** Projects with usage counts for the admin catalog table (HR/ADMIN only). */
  adminStats: async () => {
    const res = await api.get<{ projects: ProjectAdminStats[] }>('/api/projects/admin-stats');
    return res.projects;
  },

  create: async (payload: CreateProjectPayload) => {
    const res = await api.post<{ project: Project }>('/api/projects', payload);
    return res.project;
  },

  /**
   * List a project's tasks. Active only by default (used by the entry form's
   * cascading task select); `includeInactive` requires HR_MANAGER/ADMIN.
   */
  listTasks: async (projectId: string, includeInactive = false) => {
    const q = includeInactive ? '?includeInactive=true' : '';
    const res = await api.get<{ tasks: ProjectTask[] }>(`/api/projects/${projectId}/tasks${q}`);
    return res.tasks;
  },

  update: async (id: string, payload: UpdateProjectPayload) => {
    const res = await api.patch<{ project: Project }>(`/api/projects/${id}`, payload);
    return res.project;
  },

  /** Soft delete; 409 when timesheet entries reference the project. */
  remove: async (id: string) => {
    return api.del<{ message: string }>(`/api/projects/${id}`);
  },

  createTask: async (projectId: string, payload: { name: string }) => {
    const res = await api.post<{ task: ProjectTask }>(`/api/projects/${projectId}/tasks`, payload);
    return res.task;
  },

  updateTask: async (
    projectId: string,
    taskId: string,
    payload: { name?: string; isActive?: boolean },
  ) => {
    const res = await api.patch<{ task: ProjectTask }>(
      `/api/projects/${projectId}/tasks/${taskId}`,
      payload,
    );
    return res.task;
  },

  /** Soft delete; 409 when timesheet entries reference the task. */
  removeTask: async (projectId: string, taskId: string) => {
    return api.del<{ message: string }>(`/api/projects/${projectId}/tasks/${taskId}`);
  },
};

// ── Reports ────────────────────────────────────────────────────────────────

/** Serialize report filters into query params (shared by all report endpoints). */
function reportQuery(
  filters: {
    from: string;
    to: string;
    groupBy?: ReportGroupBy;
    employeeId?: string;
    departmentId?: string;
    projectId?: string;
    includeAllStatuses?: boolean;
    page?: number;
    pageSize?: number;
  },
  includePaging = false,
): string {
  const q = new URLSearchParams();
  q.set('from', filters.from);
  q.set('to', filters.to);
  if (filters.groupBy) q.set('groupBy', filters.groupBy);
  if (filters.employeeId) q.set('employeeId', filters.employeeId);
  if (filters.departmentId) q.set('departmentId', filters.departmentId);
  if (filters.projectId) q.set('projectId', filters.projectId);
  if (filters.includeAllStatuses) q.set('includeAllStatuses', 'true');
  if (includePaging) {
    if (filters.page) q.set('page', String(filters.page));
    if (filters.pageSize) q.set('pageSize', String(filters.pageSize));
  }
  return `?${q.toString()}`;
}

export const timesheetReportRepo = {
  /** Aggregated hours grouped by employee, project, or department (MANAGER+). */
  summary: async (filters: {
    from: string;
    to: string;
    groupBy?: ReportGroupBy;
    employeeId?: string;
    departmentId?: string;
    projectId?: string;
    includeAllStatuses?: boolean;
  }) => {
    return api.get<SummaryReportResponse>(`/api/reports/timesheets/summary${reportQuery(filters)}`);
  },

  /** Paged entry listing with the same filters as summary (MANAGER+). */
  details: async (filters: {
    from: string;
    to: string;
    groupBy?: ReportGroupBy;
    employeeId?: string;
    departmentId?: string;
    projectId?: string;
    includeAllStatuses?: boolean;
    page?: number;
    pageSize?: number;
  }) => {
    return api.get<DetailsReportResponse>(
      `/api/reports/timesheets/details${reportQuery(filters, true)}`,
    );
  },

  /**
   * Download the CSV export. Triggers a browser download via a blob URL, so
   * the authenticated request is issued with an explicit Authorization header
   * (the shared wrapper cannot intercept the blob response shape).
   */
  exportCsv: async (filters: {
    from: string;
    to: string;
    groupBy?: ReportGroupBy;
    employeeId?: string;
    departmentId?: string;
    projectId?: string;
    includeAllStatuses?: boolean;
  }): Promise<void> => {
    const path = `/api/reports/timesheets/export${reportQuery(filters)}`;
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
    const filename = filenameMatch?.[1] ?? `timesheet-report-${filters.from}-to-${filters.to}.csv`;

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

// Re-export for convenience so pages can import everything from one module.
export { apiRequest };
