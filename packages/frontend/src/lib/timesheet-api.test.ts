import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock collaborators ───────────────────────────────────────────────────────
// hoisted() lets the vi.mock factories below close over these spies without
// hitting the "cannot access before initialization" temporal-dead-zone problem.
const {
  apiMock,
  apiRequestMock,
  authStorageMock,
  configMock,
  fetchMock,
  createObjectURLMock,
  revokeObjectURLMock,
} = vi.hoisted(() => ({
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
    getSessionUser: vi.fn(),
    setSession: vi.fn(),
    clear: vi.fn(),
  },
  configMock: {
    useMock: false,
    apiBase: 'http://localhost:4000',
    basePath: '/',
  },
  fetchMock: vi.fn(),
  createObjectURLMock: vi.fn(),
  revokeObjectURLMock: vi.fn(),
}));

vi.mock('./api-client', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
  api: apiMock,
  apiRequest: apiRequestMock,
}));

vi.mock('./auth-storage', () => ({ authStorage: authStorageMock }));
vi.mock('./config', () => ({ config: configMock }));

import { ApiError, api, apiRequest } from './api-client';
import {
  projectRepo,
  timesheetEntryRepo,
  timesheetReportRepo,
  timesheetRepo,
  apiRequest as reExportedApiRequest,
  type WeekCellChangeDto,
} from './timesheet-api';
import type {
  Project,
  ProjectAdminStats,
  ProjectTask,
  TimesheetDetail,
  TimesheetSummary,
} from '@/types/timesheet';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<TimesheetSummary> = {}): TimesheetSummary {
  return {
    id: 'ts-1',
    employeeId: 'e-006',
    employee: { id: 'e-006', employeeNo: 'EMP-0006', firstName: 'Charlie', lastName: 'Doe' },
    periodStart: '2026-09-14T00:00:00.000Z',
    periodEnd: '2026-09-20T23:59:59.999Z',
    status: 'DRAFT',
    submittedAt: null,
    weeklyTotalHours: 8,
    entryCount: 1,
    ...overrides,
  };
}

function makeTimesheet(overrides: Partial<TimesheetDetail> = {}): TimesheetDetail {
  return {
    ...makeSummary(),
    createdAt: '2026-09-14T08:00:00Z',
    updatedAt: '2026-09-14T08:00:00Z',
    entries: [],
    approvals: [],
    perDayTotals: [],
    perProjectTotals: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    code: 'ERP',
    name: 'ERP Platform',
    description: null,
    client: null,
    isBillable: true,
    startDate: null,
    endDate: null,
    isActive: true,
    taskCount: 0,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: 't-1',
    projectId: 'p-1',
    name: 'Design',
    isActive: true,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

/** Build a minimal Response-like object for the raw `fetch` used by exportCsv. */
function fakeResponse(
  overrides: {
    ok?: boolean;
    status?: number;
    json?: () => Promise<unknown>;
    blob?: () => Promise<Blob>;
    disposition?: string | null;
  } = {},
): Response {
  const { ok = true, status = 200, json, blob, disposition = null } = overrides;
  return {
    ok,
    status,
    json: json ?? (async () => ({})),
    blob: blob ?? (async () => new Blob(['a,b'], { type: 'text/csv' })),
    headers: { get: (h: string) => (h === 'Content-Disposition' ? disposition : null) },
  } as unknown as Response;
}

// ── Shared setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // exportCsv bypasses the api-client wrapper, so capture global fetch directly.
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  authStorageMock.getAccessToken.mockReturnValue(null);

  // jsdom does not implement the blob-URL APIs used to trigger the download.
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURLMock,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectURLMock,
    configurable: true,
    writable: true,
  });
  createObjectURLMock.mockReset().mockReturnValue('blob:mock');
  revokeObjectURLMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── timesheetRepo ────────────────────────────────────────────────────────────

describe('timesheetRepo.list', () => {
  it('lists without filters when no params are supplied', async () => {
    const payload = { timesheets: [makeSummary()], total: 1, page: 1, pageSize: 20 };
    apiMock.get.mockResolvedValueOnce(payload);

    await expect(timesheetRepo.list()).resolves.toBe(payload);
    expect(api.get).toHaveBeenCalledWith('/api/timesheets');
  });

  it('serializes status, page and pageSize into the query string', async () => {
    apiMock.get.mockResolvedValueOnce({ timesheets: [], total: 0, page: 2, pageSize: 10 });

    await timesheetRepo.list({ status: 'SUBMITTED', page: 2, pageSize: 10 });

    expect(api.get).toHaveBeenCalledWith('/api/timesheets?status=SUBMITTED&page=2&pageSize=10');
  });

  it('omits falsy page values (0 is treated as unset)', async () => {
    apiMock.get.mockResolvedValueOnce({ timesheets: [], total: 0, page: 0, pageSize: 0 });

    await timesheetRepo.list({ status: 'APPROVED', page: 0, pageSize: 0 });

    expect(api.get).toHaveBeenCalledWith('/api/timesheets?status=APPROVED');
  });
});

describe('timesheetRepo.getCurrent', () => {
  it('defaults to now when no date is given', async () => {
    const detail = makeTimesheet();
    apiMock.get.mockResolvedValueOnce({ timesheet: detail });

    await expect(timesheetRepo.getCurrent()).resolves.toBe(detail);
    expect(api.get).toHaveBeenCalledWith('/api/timesheets/current');
  });

  it('encodes the supplied date into the query string', async () => {
    const detail = makeTimesheet();
    apiMock.get.mockResolvedValueOnce({ timesheet: detail });

    await timesheetRepo.getCurrent('2026-09-15T10:30:00Z');

    expect(api.get).toHaveBeenCalledWith('/api/timesheets/current?date=2026-09-15T10%3A30%3A00Z');
  });
});

describe('timesheetRepo.getPending', () => {
  it('unwraps the pending queue array', async () => {
    const rows = [makeSummary({ status: 'SUBMITTED' })];
    apiMock.get.mockResolvedValueOnce({ timesheets: rows });

    await expect(timesheetRepo.getPending()).resolves.toBe(rows);
    expect(api.get).toHaveBeenCalledWith('/api/timesheets/pending');
  });
});

describe('timesheetRepo.getById', () => {
  it('unwraps the timesheet detail', async () => {
    const detail = makeTimesheet({ id: 'ts-42' });
    apiMock.get.mockResolvedValueOnce({ timesheet: detail });

    await expect(timesheetRepo.getById('ts-42')).resolves.toBe(detail);
    expect(api.get).toHaveBeenCalledWith('/api/timesheets/ts-42');
  });
});

describe('timesheetRepo workflow transitions', () => {
  it('submit posts to the submit endpoint', async () => {
    const detail = makeTimesheet({ status: 'SUBMITTED' });
    apiMock.post.mockResolvedValueOnce({ timesheet: detail });

    await expect(timesheetRepo.submit('ts-1')).resolves.toBe(detail);
    expect(api.post).toHaveBeenCalledWith('/api/timesheets/ts-1/submit');
  });

  it('approve forwards the optional comment', async () => {
    const detail = makeTimesheet({ status: 'APPROVED' });
    apiMock.post.mockResolvedValueOnce({ timesheet: detail });

    await expect(timesheetRepo.approve('ts-1', 'Looks good')).resolves.toBe(detail);
    expect(api.post).toHaveBeenCalledWith('/api/timesheets/ts-1/approve', {
      comment: 'Looks good',
    });
  });

  it('approve omits the comment key when none is supplied', async () => {
    const detail = makeTimesheet({ status: 'APPROVED' });
    apiMock.post.mockResolvedValueOnce({ timesheet: detail });

    await timesheetRepo.approve('ts-1');

    expect(api.post).toHaveBeenCalledWith('/api/timesheets/ts-1/approve', {});
  });

  it('reject always sends the required comment', async () => {
    const detail = makeTimesheet({ status: 'REJECTED' });
    apiMock.post.mockResolvedValueOnce({ timesheet: detail });

    await expect(timesheetRepo.reject('ts-1', 'Missing detail')).resolves.toBe(detail);
    expect(api.post).toHaveBeenCalledWith('/api/timesheets/ts-1/reject', {
      comment: 'Missing detail',
    });
  });
});

// ── timesheetEntryRepo (single operations) ───────────────────────────────────

describe('timesheetEntryRepo single-entry operations', () => {
  it('create posts the payload and returns the owning timesheet', async () => {
    const detail = makeTimesheet();
    apiMock.post.mockResolvedValueOnce({ timesheet: detail });
    const payload = {
      entryDate: '2026-09-15',
      projectId: 'p-1',
      taskId: 't-1',
      hours: 4,
      description: 'Kickoff',
    };

    await expect(timesheetEntryRepo.create(payload)).resolves.toBe(detail);
    expect(api.post).toHaveBeenCalledWith('/api/timesheet-entries', payload);
  });

  it('update patches the entry and returns the owning timesheet', async () => {
    const detail = makeTimesheet();
    apiMock.patch.mockResolvedValueOnce({ timesheet: detail });

    await expect(timesheetEntryRepo.update('entry-1', { hours: 6 })).resolves.toBe(detail);
    expect(api.patch).toHaveBeenCalledWith('/api/timesheet-entries/entry-1', { hours: 6 });
  });

  it('remove deletes the entry and returns the owning timesheet', async () => {
    const detail = makeTimesheet();
    apiMock.del.mockResolvedValueOnce({ timesheet: detail });

    await expect(timesheetEntryRepo.remove('entry-1')).resolves.toBe(detail);
    expect(api.del).toHaveBeenCalledWith('/api/timesheet-entries/entry-1');
  });
});

// ── timesheetEntryRepo.applyWeekChanges ──────────────────────────────────────

describe('timesheetEntryRepo.applyWeekChanges', () => {
  it('rejects an empty plan', async () => {
    await expect(timesheetEntryRepo.applyWeekChanges([])).rejects.toBeInstanceOf(ApiError);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('creates an entry for a filled cell with no existing entry', async () => {
    const detail = makeTimesheet();
    apiMock.post.mockResolvedValueOnce({ timesheet: detail });

    const plan: WeekCellChangeDto[] = [
      { projectId: 'p-erp', taskId: 't-1', entryDate: '2026-09-15', hours: 4, entryIds: [] },
    ];

    await expect(timesheetEntryRepo.applyWeekChanges(plan)).resolves.toBe(detail);
    expect(api.post).toHaveBeenCalledWith('/api/timesheet-entries', {
      entryDate: '2026-09-15',
      projectId: 'p-erp',
      taskId: 't-1',
      hours: 4,
    });
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.del).not.toHaveBeenCalled();
  });

  it('creates an entry with a null taskId when the cell has no task', async () => {
    const detail = makeTimesheet();
    apiMock.post.mockResolvedValueOnce({ timesheet: detail });

    await timesheetEntryRepo.applyWeekChanges([
      { projectId: 'p-erp', taskId: null, entryDate: '2026-09-16', hours: 2, entryIds: [] },
    ]);

    expect(api.post).toHaveBeenCalledWith('/api/timesheet-entries', {
      entryDate: '2026-09-16',
      projectId: 'p-erp',
      taskId: null,
      hours: 2,
    });
  });

  it('updates the single existing entry of a cell', async () => {
    const detail = makeTimesheet();
    apiMock.patch.mockResolvedValueOnce({ timesheet: detail });

    await timesheetEntryRepo.applyWeekChanges([
      {
        projectId: 'p-erp',
        taskId: null,
        entryDate: '2026-09-14',
        hours: 6,
        entryIds: ['entry-1'],
      },
    ]);

    expect(api.patch).toHaveBeenCalledWith('/api/timesheet-entries/entry-1', { hours: 6 });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('updates only the first entry when a filled cell reports several', async () => {
    const detail = makeTimesheet();
    apiMock.patch.mockResolvedValueOnce({ timesheet: detail });

    await timesheetEntryRepo.applyWeekChanges([
      {
        projectId: 'p-erp',
        taskId: 't-1',
        entryDate: '2026-09-14',
        hours: 3,
        entryIds: ['entry-1', 'entry-2'],
      },
    ]);

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith('/api/timesheet-entries/entry-1', { hours: 3 });
  });

  it('deletes every entry of a cleared cell', async () => {
    const detail = makeTimesheet();
    apiMock.del.mockResolvedValue({ timesheet: detail });

    await timesheetEntryRepo.applyWeekChanges([
      {
        projectId: 'p-erp',
        taskId: 't-1',
        entryDate: '2026-09-14',
        hours: 0,
        entryIds: ['a', 'b'],
      },
    ]);

    expect(api.del).toHaveBeenCalledTimes(2);
    expect(api.del).toHaveBeenNthCalledWith(1, '/api/timesheet-entries/a');
    expect(api.del).toHaveBeenNthCalledWith(2, '/api/timesheet-entries/b');
  });

  it('treats negative hours as a deletion', async () => {
    const detail = makeTimesheet();
    apiMock.del.mockResolvedValueOnce({ timesheet: detail });

    await timesheetEntryRepo.applyWeekChanges([
      { projectId: 'p-erp', taskId: null, entryDate: '2026-09-14', hours: -2, entryIds: ['a'] },
    ]);

    expect(api.del).toHaveBeenCalledWith('/api/timesheet-entries/a');
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('returns the last response, which reflects every earlier mutation', async () => {
    const first = makeTimesheet({ id: 'ts-first' });
    const second = makeTimesheet({ id: 'ts-second' });
    apiMock.post.mockResolvedValue({ timesheet: first });
    apiMock.patch.mockResolvedValue({ timesheet: second });

    await expect(
      timesheetEntryRepo.applyWeekChanges([
        { projectId: 'p-erp', taskId: null, entryDate: '2026-09-15', hours: 4, entryIds: [] },
        {
          projectId: 'p-erp',
          taskId: null,
          entryDate: '2026-09-14',
          hours: 6,
          entryIds: ['entry-1'],
        },
      ]),
    ).resolves.toBe(second);
  });

  it('applies mutations in plan order (sequential, not parallel)', async () => {
    apiMock.post.mockResolvedValue({ timesheet: makeTimesheet() });
    apiMock.patch.mockResolvedValue({ timesheet: makeTimesheet() });
    apiMock.del.mockResolvedValue({ timesheet: makeTimesheet() });

    await timesheetEntryRepo.applyWeekChanges([
      { projectId: 'p-erp', taskId: null, entryDate: '2026-09-15', hours: 4, entryIds: [] },
      {
        projectId: 'p-erp',
        taskId: null,
        entryDate: '2026-09-14',
        hours: 6,
        entryIds: ['entry-1'],
      },
      {
        projectId: 'p-erp',
        taskId: null,
        entryDate: '2026-09-13',
        hours: 0,
        entryIds: ['entry-2'],
      },
    ]);

    const order = [
      apiMock.post.mock.invocationCallOrder[0],
      apiMock.patch.mock.invocationCallOrder[0],
      apiMock.del.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('reports no-op plans (empty cells without entries) as a bad request', async () => {
    await expect(
      timesheetEntryRepo.applyWeekChanges([
        { projectId: 'p-erp', taskId: null, entryDate: '2026-09-14', hours: 0, entryIds: [] },
      ]),
    ).rejects.toBeInstanceOf(ApiError);
    expect(api.del).not.toHaveBeenCalled();
  });
});

// ── projectRepo ──────────────────────────────────────────────────────────────

describe('projectRepo.list', () => {
  it('lists active projects by default', async () => {
    const projects = [makeProject()];
    apiMock.get.mockResolvedValueOnce({ projects });

    await expect(projectRepo.list()).resolves.toBe(projects);
    expect(api.get).toHaveBeenCalledWith('/api/projects');
  });

  it('requests inactive projects when includeInactive is true', async () => {
    apiMock.get.mockResolvedValueOnce({ projects: [] });

    await projectRepo.list(true);

    expect(api.get).toHaveBeenCalledWith('/api/projects?includeInactive=true');
  });
});

describe('projectRepo.adminStats', () => {
  it('unwraps the enriched project rows', async () => {
    const rows: ProjectAdminStats[] = [{ ...makeProject(), entryCount: 12 }];
    apiMock.get.mockResolvedValueOnce({ projects: rows });

    await expect(projectRepo.adminStats()).resolves.toBe(rows);
    expect(api.get).toHaveBeenCalledWith('/api/projects/admin-stats');
  });
});

describe('projectRepo.create / update / remove', () => {
  it('create posts the payload and unwraps the project', async () => {
    const project = makeProject({ id: 'p-new' });
    apiMock.post.mockResolvedValueOnce({ project });
    const payload = { code: 'NEW', name: 'New Project', isBillable: true };

    await expect(projectRepo.create(payload)).resolves.toBe(project);
    expect(api.post).toHaveBeenCalledWith('/api/projects', payload);
  });

  it('update patches the project and unwraps it', async () => {
    const project = makeProject({ name: 'Renamed' });
    apiMock.patch.mockResolvedValueOnce({ project });

    await expect(projectRepo.update('p-1', { name: 'Renamed' })).resolves.toBe(project);
    expect(api.patch).toHaveBeenCalledWith('/api/projects/p-1', { name: 'Renamed' });
  });

  it('remove returns the raw delete response (message payload)', async () => {
    apiMock.del.mockResolvedValueOnce({ message: 'Project deleted' });

    await expect(projectRepo.remove('p-1')).resolves.toEqual({ message: 'Project deleted' });
    expect(api.del).toHaveBeenCalledWith('/api/projects/p-1');
  });
});

describe('projectRepo tasks', () => {
  it('listTasks lists active tasks by default', async () => {
    const tasks = [makeTask()];
    apiMock.get.mockResolvedValueOnce({ tasks });

    await expect(projectRepo.listTasks('p-1')).resolves.toBe(tasks);
    expect(api.get).toHaveBeenCalledWith('/api/projects/p-1/tasks');
  });

  it('listTasks includes inactive tasks when requested', async () => {
    apiMock.get.mockResolvedValueOnce({ tasks: [] });

    await projectRepo.listTasks('p-1', true);

    expect(api.get).toHaveBeenCalledWith('/api/projects/p-1/tasks?includeInactive=true');
  });

  it('createTask posts the payload and unwraps the task', async () => {
    const task = makeTask({ id: 't-new' });
    apiMock.post.mockResolvedValueOnce({ task });

    await expect(projectRepo.createTask('p-1', { name: 'Design' })).resolves.toBe(task);
    expect(api.post).toHaveBeenCalledWith('/api/projects/p-1/tasks', { name: 'Design' });
  });

  it('updateTask patches the task and unwraps it', async () => {
    const task = makeTask({ isActive: false });
    apiMock.patch.mockResolvedValueOnce({ task });

    await expect(projectRepo.updateTask('p-1', 't-1', { isActive: false })).resolves.toBe(task);
    expect(api.patch).toHaveBeenCalledWith('/api/projects/p-1/tasks/t-1', { isActive: false });
  });

  it('removeTask returns the raw delete response', async () => {
    apiMock.del.mockResolvedValueOnce({ message: 'Task deleted' });

    await expect(projectRepo.removeTask('p-1', 't-1')).resolves.toEqual({
      message: 'Task deleted',
    });
    expect(api.del).toHaveBeenCalledWith('/api/projects/p-1/tasks/t-1');
  });
});

// ── timesheetReportRepo ──────────────────────────────────────────────────────

describe('timesheetReportRepo.summary', () => {
  it('always sends from/to and omits unset filters', async () => {
    const payload = {
      rows: [],
      groupBy: 'employee' as const,
      from: '',
      to: '',
      includeAllStatuses: false,
    };
    apiMock.get.mockResolvedValueOnce(payload);

    await expect(
      timesheetReportRepo.summary({ from: '2026-09-01', to: '2026-09-30' }),
    ).resolves.toBe(payload);
    expect(api.get).toHaveBeenCalledWith(
      '/api/reports/timesheets/summary?from=2026-09-01&to=2026-09-30',
    );
  });

  it('serializes every optional filter', async () => {
    apiMock.get.mockResolvedValueOnce({ rows: [] });

    await timesheetReportRepo.summary({
      from: '2026-09-01',
      to: '2026-09-30',
      groupBy: 'project',
      employeeId: 'e-1',
      departmentId: 'd-1',
      projectId: 'p-1',
      includeAllStatuses: true,
    });

    expect(api.get).toHaveBeenCalledWith(
      '/api/reports/timesheets/summary?from=2026-09-01&to=2026-09-30&groupBy=project&employeeId=e-1&departmentId=d-1&projectId=p-1&includeAllStatuses=true',
    );
  });

  it('never appends paging to the summary endpoint', async () => {
    apiMock.get.mockResolvedValueOnce({ rows: [] });

    await timesheetReportRepo.summary({
      from: '2026-09-01',
      to: '2026-09-30',
      includeAllStatuses: false,
    });

    expect(api.get).toHaveBeenCalledWith(
      '/api/reports/timesheets/summary?from=2026-09-01&to=2026-09-30',
    );
  });
});

describe('timesheetReportRepo.details', () => {
  it('appends page and pageSize when supplied', async () => {
    const payload = { entries: [], total: 0, page: 1, pageSize: 25 };
    apiMock.get.mockResolvedValueOnce(payload);

    await expect(
      timesheetReportRepo.details({
        from: '2026-09-01',
        to: '2026-09-30',
        groupBy: 'department',
        page: 3,
        pageSize: 25,
      }),
    ).resolves.toBe(payload);

    expect(api.get).toHaveBeenCalledWith(
      '/api/reports/timesheets/details?from=2026-09-01&to=2026-09-30&groupBy=department&page=3&pageSize=25',
    );
  });

  it('omits paging when the caller does not paginate', async () => {
    apiMock.get.mockResolvedValueOnce({ entries: [] });

    await timesheetReportRepo.details({ from: '2026-09-01', to: '2026-09-30' });

    expect(api.get).toHaveBeenCalledWith(
      '/api/reports/timesheets/details?from=2026-09-01&to=2026-09-30',
    );
  });
});

describe('timesheetReportRepo.exportCsv', () => {
  it('downloads the file using the server-provided filename and bearer token', async () => {
    authStorageMock.getAccessToken.mockReturnValue('token-123');
    const blob = new Blob(['a,b'], { type: 'text/csv' });
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        disposition: 'attachment; filename="timesheet-report.csv"',
        blob: async () => blob,
      }),
    );

    let downloadName = '';
    let downloadHref = '';
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
      downloadHref = this.href;
    });

    await expect(
      timesheetReportRepo.exportCsv({ from: '2026-09-01', to: '2026-09-30' }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/reports/timesheets/export?from=2026-09-01&to=2026-09-30',
      {
        method: 'GET',
        credentials: 'include',
        headers: { Authorization: 'Bearer token-123' },
      },
    );
    expect(createObjectURLMock).toHaveBeenCalledWith(blob);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe('timesheet-report.csv');
    expect(downloadHref).toBe('blob:mock');
  });

  it('falls back to a generated filename when Content-Disposition is absent', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse());

    let downloadName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });

    await timesheetReportRepo.exportCsv({ from: '2026-09-01', to: '2026-09-30' });

    expect(downloadName).toBe('timesheet-report-2026-09-01-to-2026-09-30.csv');
  });

  it('serializes report filters into the export query string', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse());
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await timesheetReportRepo.exportCsv({
      from: '2026-09-01',
      to: '2026-09-30',
      groupBy: 'project',
      projectId: 'p-1',
      includeAllStatuses: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/reports/timesheets/export?from=2026-09-01&to=2026-09-30&groupBy=project&projectId=p-1&includeAllStatuses=true',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it('omits the Authorization header when no access token is stored', async () => {
    authStorageMock.getAccessToken.mockReturnValue(null);
    fetchMock.mockResolvedValueOnce(fakeResponse());
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await timesheetReportRepo.exportCsv({ from: '2026-09-01', to: '2026-09-30' });

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      method: 'GET',
      credentials: 'include',
      headers: {},
    });
  });

  it('throws an ApiError carrying the server error message', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }),
    );

    await expect(
      timesheetReportRepo.exportCsv({ from: '2026-09-01', to: '2026-09-30' }),
    ).rejects.toMatchObject({ status: 403, message: 'Forbidden' });
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );

    await expect(
      timesheetReportRepo.exportCsv({ from: '2026-09-01', to: '2026-09-30' }),
    ).rejects.toMatchObject({ status: 500, message: 'Export failed (500)' });
  });

  it('falls back to a generic message when the JSON body has no error field', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: false, status: 404, json: async () => ({ detail: 'nope' }) }),
    );

    await expect(
      timesheetReportRepo.exportCsv({ from: '2026-09-01', to: '2026-09-30' }),
    ).rejects.toMatchObject({ status: 404, message: 'Export failed (404)' });
  });
});

// ── Module re-export ─────────────────────────────────────────────────────────

describe('module re-exports', () => {
  it('re-exports apiRequest so consumers can import it from one module', () => {
    expect(reExportedApiRequest).toBe(apiRequest);
    expect(reExportedApiRequest).toBe(apiRequestMock);
  });
});
