/**
 * MSW handlers for the Timesheet feature (mock mode).
 *
 * Intercepts the timesheet API surface defined in
 * `temp/docs/timesheet-api-contract.md` and serves it from the in-memory
 * store, so the same repository code paths run in mock and API modes.
 *
 * Mock parity is intentional but loose (see `store.ts`): the demo employee is
 * hard-coded to `e-006` (Charlie Doe) — matching the leave-request handlers —
 * and RBAC is not enforced. The manager queue simply returns SUBMITTED
 * timesheets belonging to other employees.
 */
import { http, HttpResponse, delay, type JsonBodyType } from 'msw';
import { getStore, insert, updateById, removeById } from './store';
import type {
  ApprovalAction,
  Project,
  ReportGroupBy,
  TimesheetDetail,
  TimesheetEntry,
  TimesheetStatus,
} from '@/types/timesheet';

const LATENCY_MS = 300;

async function simulateLatency(): Promise<void> {
  if (LATENCY_MS > 0) await delay(LATENCY_MS);
}

function json(body: JsonBodyType) {
  return HttpResponse.json(body);
}

function notFound(message: string) {
  return HttpResponse.json({ error: message }, { status: 404 });
}

function conflict(message: string, code: string) {
  return HttpResponse.json({ error: message, code }, { status: 409 });
}

function badRequest(message: string, details?: Record<string, string[]>) {
  return HttpResponse.json(
    { error: 'Validation error', details: details ?? { _: [message] } },
    { status: 400 },
  );
}

/** Demo employee acting as the authenticated user (mirrors leave handlers). */
const DEMO_EMPLOYEE_ID = 'e-006';

/** Monday 00:00 UTC of the week containing `date`. */
function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function weekOf(dateStr: string): { periodStart: Date; periodEnd: Date } {
  const start = weekStart(new Date(`${dateStr.slice(0, 10)}T00:00:00.000Z`));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { periodStart: start, periodEnd: end };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Recompute the aggregated totals of a timesheet from its entries (mutates). */
function recomputeTotals(timesheet: TimesheetDetail): void {
  timesheet.entryCount = timesheet.entries.length;
  timesheet.weeklyTotalHours = round2(timesheet.entries.reduce((s, e) => s + e.hours, 0));
  timesheet.updatedAt = new Date().toISOString();
  timesheet.perDayTotals = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(timesheet.periodStart);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    return {
      date: key,
      hours: round2(
        timesheet.entries.filter((e) => e.entryDate === key).reduce((s, e) => s + e.hours, 0),
      ),
    };
  });
  const byProject = new Map<string, { code: string; name: string; hours: number }>();
  for (const e of timesheet.entries) {
    const current = byProject.get(e.projectId) ?? {
      code: e.project.code,
      name: e.project.name,
      hours: 0,
    };
    current.hours += e.hours;
    byProject.set(e.projectId, current);
  }
  timesheet.perProjectTotals = [...byProject.entries()].map(([projectId, v]) => ({
    projectId,
    projectCode: v.code,
    projectName: v.name,
    hours: round2(v.hours),
  }));
}

/** Employee ref stub for the demo employee (falls back to a generic label). */
function demoEmployeeRef() {
  const employee = getStore().employees.find((e) => e.id === DEMO_EMPLOYEE_ID);
  return {
    id: DEMO_EMPLOYEE_ID,
    employeeNo: employee?.employeeNo ?? 'EMP-0006',
    firstName: employee?.firstName ?? 'Charlie',
    lastName: employee?.lastName ?? 'Doe',
  };
}

/** Build an entry with embedded project/task refs from the store catalog. */
function buildEntry(spec: {
  id: string;
  timesheetId: string;
  entryDate: string;
  projectId: string;
  taskId: string | null;
  hours: number;
  description: string | null;
}): TimesheetEntry {
  const store = getStore();
  const project = store.timesheetProjects.find((p) => p.id === spec.projectId);
  const task = spec.taskId ? store.timesheetTasks.find((t) => t.id === spec.taskId) : undefined;
  const now = new Date().toISOString();
  return {
    id: spec.id,
    timesheetId: spec.timesheetId,
    employeeId: DEMO_EMPLOYEE_ID,
    entryDate: spec.entryDate,
    projectId: spec.projectId,
    project: {
      id: spec.projectId,
      code: project?.code ?? '???',
      name: project?.name ?? 'Unknown project',
      isBillable: project?.isBillable ?? false,
    },
    taskId: spec.taskId,
    task: task ? { id: task.id, name: task.name } : null,
    hours: spec.hours,
    description: spec.description,
    createdAt: now,
    updatedAt: now,
  };
}

/** Find (or create) the demo employee's DRAFT-eligible timesheet for a date. */
function getOrCreateTimesheet(dateStr: string): TimesheetDetail {
  const store = getStore();
  const { periodStart, periodEnd } = weekOf(dateStr);
  const existing = store.timesheets.find(
    (t) =>
      t.employeeId === DEMO_EMPLOYEE_ID &&
      t.periodStart.slice(0, 10) === periodStart.toISOString().slice(0, 10),
  );
  if (existing) return existing;
  const now = new Date().toISOString();
  const created: TimesheetDetail = {
    id: `ts-${crypto.randomUUID().slice(0, 8)}`,
    employeeId: DEMO_EMPLOYEE_ID,
    employee: demoEmployeeRef(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    status: 'DRAFT',
    submittedAt: null,
    weeklyTotalHours: 0,
    entryCount: 0,
    createdAt: now,
    updatedAt: now,
    entries: [],
    approvals: [],
    perDayTotals: [],
    perProjectTotals: [],
  };
  recomputeTotals(created);
  insert(store.timesheets, created);
  return created;
}

/** Re-count tasks per project after catalog mutations. */
function syncTaskCounts(): void {
  const store = getStore();
  for (const project of store.timesheetProjects) {
    project.taskCount = store.timesheetTasks.filter((t) => t.projectId === project.id).length;
  }
}

/** CSV field escaping (RFC 4180: quote fields containing separators/quotes). */
function csvField(value: string | number | null): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export const timesheetHandlers = [
  // ── Timesheets ───────────────────────────────────────────────────────────
  http.get('/api/timesheets', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    let list = getStore().timesheets.filter((t) => t.employeeId === DEMO_EMPLOYEE_ID);
    if (status) list = list.filter((t) => t.status === status);
    list = [...list].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
    return json({ timesheets: list, total: list.length, page: 1, pageSize: 20 });
  }),

  http.get('/api/timesheets/current', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const date = url.searchParams.get('date') ?? new Date().toISOString();
    return json({ timesheet: getOrCreateTimesheet(date) });
  }),

  http.get('/api/timesheets/pending', async () => {
    await simulateLatency();
    const list = getStore()
      .timesheets.filter((t) => t.status === 'SUBMITTED' && t.employeeId !== DEMO_EMPLOYEE_ID)
      .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
    return json({ timesheets: list });
  }),

  http.get('/api/timesheets/:id', async ({ params }) => {
    await simulateLatency();
    const timesheet = getStore().timesheets.find((t) => t.id === String(params.id));
    if (!timesheet) return notFound('Timesheet not found');
    return json({ timesheet });
  }),

  http.post('/api/timesheets/:id/submit', async ({ params }) => {
    await simulateLatency();
    const timesheet = getStore().timesheets.find((t) => t.id === String(params.id));
    if (!timesheet) return notFound('Timesheet not found');
    if (timesheet.status !== 'DRAFT' && timesheet.status !== 'REJECTED') {
      return conflict('Timesheet is locked for editing', 'TIMESHEET_LOCKED');
    }
    if (timesheet.entries.length === 0) {
      return badRequest('Timesheet must have at least one entry before submission');
    }
    timesheet.status = 'SUBMITTED';
    timesheet.submittedAt = new Date().toISOString();
    timesheet.updatedAt = timesheet.submittedAt;
    return json({ timesheet });
  }),

  http.post('/api/timesheets/:id/approve', async ({ params, request }) => {
    await simulateLatency();
    const timesheet = getStore().timesheets.find((t) => t.id === String(params.id));
    if (!timesheet) return notFound('Timesheet not found');
    if (timesheet.status !== 'SUBMITTED') {
      return conflict('Only submitted timesheets can be approved', 'TIMESHEET_LOCKED');
    }
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    timesheet.status = 'APPROVED';
    timesheet.approvals.push({
      id: crypto.randomUUID(),
      action: 'APPROVE' satisfies ApprovalAction,
      comment: body.comment ?? null,
      approverId: 'u-mgr',
      approverEmail: 'manager@example.com',
      createdAt: new Date().toISOString(),
    });
    timesheet.updatedAt = new Date().toISOString();
    return json({ timesheet });
  }),

  http.post('/api/timesheets/:id/reject', async ({ params, request }) => {
    await simulateLatency();
    const timesheet = getStore().timesheets.find((t) => t.id === String(params.id));
    if (!timesheet) return notFound('Timesheet not found');
    if (timesheet.status !== 'SUBMITTED') {
      return conflict('Only submitted timesheets can be rejected', 'TIMESHEET_LOCKED');
    }
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    if (!body.comment || body.comment.trim().length === 0) {
      return badRequest('A rejection comment is required', { comment: ['Comment is required'] });
    }
    timesheet.status = 'REJECTED';
    timesheet.approvals.push({
      id: crypto.randomUUID(),
      action: 'REJECT' satisfies ApprovalAction,
      comment: body.comment,
      approverId: 'u-mgr',
      approverEmail: 'manager@example.com',
      createdAt: new Date().toISOString(),
    });
    timesheet.updatedAt = new Date().toISOString();
    return json({ timesheet });
  }),

  // ── Timesheet entries ────────────────────────────────────────────────────
  http.post('/api/timesheet-entries', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as {
      entryDate?: string;
      projectId?: string;
      taskId?: string | null;
      hours?: number;
      description?: string | null;
    };
    const entryDate = String(body.entryDate ?? '');
    const projectId = String(body.projectId ?? '');
    const hours = Number(body.hours ?? 0);
    if (!entryDate || !projectId || !(hours > 0)) {
      return badRequest('entryDate, projectId and hours are required');
    }
    if (hours % 0.25 !== 0 || hours > 24) {
      return badRequest('Hours must be a multiple of 0.25 and at most 24', {
        hours: ['Invalid hours'],
      });
    }
    const project = getStore().timesheetProjects.find((p) => p.id === projectId && p.isActive);
    if (!project)
      return badRequest('Unknown or inactive project', { projectId: ['Invalid project'] });

    const timesheet = getOrCreateTimesheet(entryDate);
    if (timesheet.status === 'SUBMITTED' || timesheet.status === 'APPROVED') {
      return conflict('Timesheet is locked for editing', 'TIMESHEET_LOCKED');
    }
    const dayTotal =
      timesheet.entries
        .filter((e) => e.entryDate === entryDate.slice(0, 10))
        .reduce((s, e) => s + e.hours, 0) + hours;
    if (dayTotal > 24) {
      return conflict('Total hours for the day cannot exceed 24', 'DAY_TOTAL_EXCEEDED');
    }
    const entry = buildEntry({
      id: crypto.randomUUID(),
      timesheetId: timesheet.id,
      entryDate: entryDate.slice(0, 10),
      projectId,
      taskId: body.taskId ?? null,
      hours,
      description: body.description ?? null,
    });
    timesheet.entries.push(entry);
    recomputeTotals(timesheet);
    return json({ timesheet });
  }),

  http.patch('/api/timesheet-entries/:id', async ({ params, request }) => {
    await simulateLatency();
    const id = String(params.id);
    const body = (await request.json()) as {
      entryDate?: string;
      projectId?: string;
      taskId?: string | null;
      hours?: number;
      description?: string | null;
    };
    const store = getStore();
    const timesheet = store.timesheets.find((t) => t.entries.some((e) => e.id === id));
    if (!timesheet) return notFound('Entry not found');
    if (timesheet.status === 'SUBMITTED' || timesheet.status === 'APPROVED') {
      return conflict('Timesheet is locked for editing', 'TIMESHEET_LOCKED');
    }
    const entry = timesheet.entries.find((e) => e.id === id)!;
    const hours = body.hours ?? entry.hours;
    if (hours % 0.25 !== 0 || hours <= 0 || hours > 24) {
      return badRequest('Hours must be a positive multiple of 0.25 and at most 24', {
        hours: ['Invalid hours'],
      });
    }
    const entryDate = (body.entryDate ?? entry.entryDate).slice(0, 10);
    const dayTotal =
      timesheet.entries
        .filter((e) => e.entryDate === entryDate && e.id !== id)
        .reduce((s, e) => s + e.hours, 0) + hours;
    if (dayTotal > 24) {
      return conflict('Total hours for the day cannot exceed 24', 'DAY_TOTAL_EXCEEDED');
    }
    // Apply the patch, rebuilding project/task refs when the target changes.
    const projectId = body.projectId ?? entry.projectId;
    const patched = buildEntry({
      id: entry.id,
      timesheetId: entry.timesheetId,
      entryDate,
      projectId,
      taskId: body.taskId !== undefined ? body.taskId : entry.taskId,
      hours,
      description: body.description !== undefined ? body.description : entry.description,
    });
    patched.createdAt = entry.createdAt;
    const index = timesheet.entries.findIndex((e) => e.id === id);
    timesheet.entries[index] = patched;
    recomputeTotals(timesheet);
    return json({ timesheet });
  }),

  http.delete('/api/timesheet-entries/:id', async ({ params }) => {
    await simulateLatency();
    const id = String(params.id);
    const timesheet = getStore().timesheets.find((t) => t.entries.some((e) => e.id === id));
    if (!timesheet) return notFound('Entry not found');
    if (timesheet.status === 'SUBMITTED' || timesheet.status === 'APPROVED') {
      return conflict('Timesheet is locked for editing', 'TIMESHEET_LOCKED');
    }
    timesheet.entries = timesheet.entries.filter((e) => e.id !== id);
    recomputeTotals(timesheet);
    return json({ timesheet });
  }),

  // ── Projects & tasks (catalog) ───────────────────────────────────────────
  http.get('/api/projects', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get('includeInactive') === 'true';
    const list = includeInactive
      ? getStore().timesheetProjects
      : getStore().timesheetProjects.filter((p) => p.isActive);
    return json({ projects: list });
  }),

  http.get('/api/projects/admin-stats', async () => {
    await simulateLatency();
    const store = getStore();
    const entryCount = (projectId: string) =>
      store.timesheets.reduce(
        (sum, t) => sum + t.entries.filter((e) => e.projectId === projectId).length,
        0,
      );
    return json({
      projects: store.timesheetProjects.map((p) => ({ ...p, entryCount: entryCount(p.id) })),
    });
  }),

  http.post('/api/projects', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as Record<string, unknown>;
    const code = String(body.code ?? '');
    if (!code || !body.name) return badRequest('code and name are required');
    if (getStore().timesheetProjects.some((p) => p.code === code)) {
      return conflict(`Project code ${code} already exists`, 'CODE_CONFLICT');
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      code,
      name: String(body.name),
      description: (body.description as string | null) ?? null,
      client: (body.client as string | null) ?? null,
      isBillable: Boolean(body.isBillable ?? false),
      startDate: (body.startDate as string | null) ?? null,
      endDate: (body.endDate as string | null) ?? null,
      isActive: true,
      taskCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    insert(getStore().timesheetProjects, project);
    return json({ project });
  }),

  http.patch('/api/projects/:id', async ({ params, request }) => {
    await simulateLatency();
    const body = (await request.json()) as Record<string, unknown>;
    const updated = updateById(getStore().timesheetProjects, String(params.id), {
      ...(body.code !== undefined ? { code: String(body.code) } : {}),
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.description !== undefined ? { description: body.description as string | null } : {}),
      ...(body.client !== undefined ? { client: body.client as string | null } : {}),
      ...(body.isBillable !== undefined ? { isBillable: Boolean(body.isBillable) } : {}),
      ...(body.startDate !== undefined ? { startDate: body.startDate as string | null } : {}),
      ...(body.endDate !== undefined ? { endDate: body.endDate as string | null } : {}),
      ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
      updatedAt: new Date().toISOString(),
    } as Partial<Project>);
    if (!updated) return notFound('Project not found');
    return json({ project: updated });
  }),

  http.delete('/api/projects/:id', async ({ params }) => {
    await simulateLatency();
    const id = String(params.id);
    const store = getStore();
    const referenced = store.timesheets.some((t) => t.entries.some((e) => e.projectId === id));
    if (referenced) {
      return conflict('Project has timesheet entries and cannot be deleted', 'PROJECT_REFERENCED');
    }
    if (!removeById(store.timesheetProjects, id)) return notFound('Project not found');
    store.timesheetTasks = store.timesheetTasks.filter((t) => t.projectId !== id);
    syncTaskCounts();
    return json({ message: 'Project deleted' });
  }),

  http.get('/api/projects/:id/tasks', async ({ params, request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get('includeInactive') === 'true';
    const projectId = String(params.id);
    const store = getStore();
    if (!store.timesheetProjects.some((p) => p.id === projectId)) {
      return notFound('Project not found');
    }
    const tasks = store.timesheetTasks
      .filter((t) => t.projectId === projectId && (includeInactive || t.isActive))
      .sort((a, b) => a.name.localeCompare(b.name));
    return json({ tasks });
  }),

  http.post('/api/projects/:id/tasks', async ({ params, request }) => {
    await simulateLatency();
    const projectId = String(params.id);
    const store = getStore();
    if (!store.timesheetProjects.some((p) => p.id === projectId)) {
      return notFound('Project not found');
    }
    const body = (await request.json()) as { name?: string };
    const name = String(body.name ?? '').trim();
    if (!name) return badRequest('name is required');
    if (store.timesheetTasks.some((t) => t.projectId === projectId && t.name === name)) {
      return conflict(`Task "${name}" already exists in this project`, 'TASK_NAME_CONFLICT');
    }
    const now = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(),
      projectId,
      name,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    insert(store.timesheetTasks, task);
    syncTaskCounts();
    return json({ task });
  }),

  http.patch('/api/projects/:id/tasks/:taskId', async ({ params, request }) => {
    await simulateLatency();
    const body = (await request.json()) as { name?: string; isActive?: boolean };
    const updated = updateById(getStore().timesheetTasks, String(params.taskId), {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
      updatedAt: new Date().toISOString(),
    });
    if (!updated) return notFound('Task not found');
    return json({ task: updated });
  }),

  http.delete('/api/projects/:id/tasks/:taskId', async ({ params }) => {
    await simulateLatency();
    const taskId = String(params.taskId);
    const store = getStore();
    const referenced = store.timesheets.some((t) => t.entries.some((e) => e.taskId === taskId));
    if (referenced) {
      return conflict('Task has timesheet entries and cannot be deleted', 'TASK_REFERENCED');
    }
    if (!removeById(store.timesheetTasks, taskId)) return notFound('Task not found');
    syncTaskCounts();
    return json({ message: 'Task deleted' });
  }),

  // ── Reports ──────────────────────────────────────────────────────────────
  http.get('/api/reports/timesheets/summary', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const groupBy = (url.searchParams.get('groupBy') ?? 'employee') as ReportGroupBy;
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const includeAllStatuses = url.searchParams.get('includeAllStatuses') === 'true';
    const projectId = url.searchParams.get('projectId');
    const employeeId = url.searchParams.get('employeeId');
    const store = getStore();

    const timesheets = store.timesheets.filter((t) => {
      if (!includeAllStatuses && t.status !== 'APPROVED') return false;
      if (employeeId && t.employeeId !== employeeId) return false;
      return true;
    });
    const entries = timesheets.flatMap((t) =>
      t.entries.filter(
        (e) =>
          e.entryDate >= from && e.entryDate <= to && (!projectId || e.projectId === projectId),
      ),
    );

    let rows: unknown[];
    if (groupBy === 'project') {
      const map = new Map<
        string,
        { code: string; name: string; isBillable: boolean; hours: number; count: number }
      >();
      for (const e of entries) {
        const current = map.get(e.projectId) ?? {
          code: e.project.code,
          name: e.project.name,
          isBillable: e.project.isBillable,
          hours: 0,
          count: 0,
        };
        current.hours += e.hours;
        current.count += 1;
        map.set(e.projectId, current);
      }
      rows = [...map.entries()].map(([id, v]) => ({
        projectId: id,
        projectCode: v.code,
        projectName: v.name,
        isBillable: v.isBillable,
        totalHours: round2(v.hours),
        entryCount: v.count,
      }));
    } else if (groupBy === 'department') {
      const map = new Map<
        string,
        { name: string; employees: Set<string>; hours: number; count: number }
      >();
      for (const e of entries) {
        const employee = store.employees.find((emp) => emp.id === e.employeeId);
        const deptId = employee?.departmentId ?? 'unknown';
        const current = map.get(deptId) ?? {
          name: employee?.departmentName ?? 'Unknown',
          employees: new Set<string>(),
          hours: 0,
          count: 0,
        };
        current.employees.add(e.employeeId);
        current.hours += e.hours;
        current.count += 1;
        map.set(deptId, current);
      }
      rows = [...map.entries()].map(([id, v]) => ({
        departmentId: id,
        departmentName: v.name,
        employeeCount: v.employees.size,
        totalHours: round2(v.hours),
        entryCount: v.count,
      }));
    } else {
      const map = new Map<
        string,
        {
          name: string;
          no: string;
          deptId: string | null;
          deptName: string | null;
          hours: number;
          billable: number;
          count: number;
        }
      >();
      for (const e of entries) {
        const employee = store.employees.find((emp) => emp.id === e.employeeId);
        const current = map.get(e.employeeId) ?? {
          name: employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown',
          no: employee?.employeeNo ?? '—',
          deptId: employee?.departmentId ?? null,
          deptName: employee?.departmentName ?? null,
          hours: 0,
          billable: 0,
          count: 0,
        };
        current.hours += e.hours;
        if (e.project.isBillable) current.billable += e.hours;
        current.count += 1;
        map.set(e.employeeId, current);
      }
      rows = [...map.entries()].map(([id, v]) => ({
        employeeId: id,
        employeeNo: v.no,
        employeeName: v.name,
        departmentId: v.deptId,
        departmentName: v.deptName,
        totalHours: round2(v.hours),
        billableHours: round2(v.billable),
        entryCount: v.count,
      }));
    }

    return json({ rows, groupBy, from, to, includeAllStatuses });
  }),

  http.get('/api/reports/timesheets/details', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const includeAllStatuses = url.searchParams.get('includeAllStatuses') === 'true';
    const projectId = url.searchParams.get('projectId');
    const employeeId = url.searchParams.get('employeeId');
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize') ?? 50)));
    const store = getStore();

    const all = store.timesheets
      .filter((t) => includeAllStatuses || t.status === 'APPROVED')
      .filter((t) => !employeeId || t.employeeId === employeeId)
      .flatMap((t) =>
        t.entries
          .filter(
            (e) =>
              e.entryDate >= from && e.entryDate <= to && (!projectId || e.projectId === projectId),
          )
          .map((e) => ({
            ...e,
            employeeName: `${t.employee.firstName} ${t.employee.lastName}`,
            timesheetStatus: t.status satisfies TimesheetStatus,
          })),
      )
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate));

    const start = (page - 1) * pageSize;
    return json({ entries: all.slice(start, start + pageSize), total: all.length, page, pageSize });
  }),

  http.get('/api/reports/timesheets/export', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const includeAllStatuses = url.searchParams.get('includeAllStatuses') === 'true';
    const store = getStore();

    const rows = store.timesheets
      .filter((t) => includeAllStatuses || t.status === 'APPROVED')
      .flatMap((t) =>
        t.entries
          .filter((e) => e.entryDate >= from && e.entryDate <= to)
          .map((e) => [
            t.employee.employeeNo,
            `${t.employee.firstName} ${t.employee.lastName}`,
            e.entryDate,
            e.project.code,
            e.project.name,
            e.task?.name ?? '',
            e.hours,
            e.description ?? '',
            t.status,
          ]),
      );

    const header =
      'employee_no,employee_name,date,project_code,project_name,task_name,hours,description,timesheet_status';
    const csv = [header, ...rows.map((r) => r.map(csvField).join(','))].join('\r\n');
    return new HttpResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="timesheet-report-${from}-to-${to}.csv"`,
      },
    });
  }),
];
