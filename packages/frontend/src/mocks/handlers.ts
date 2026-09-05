/**
 * MSW request handlers.
 *
 * These intercept HTTP requests at the network layer in mock mode, so the same
 * `api-client` / repository code paths are exercised in both mock and API
 * modes. Handlers read from the in-memory store so CRUD mutations are reflected
 * in subsequent requests.
 *
 * Latency and error simulation helpers are provided so loading/error states can
 * be developed against. See `simulateLatency` and `simulateError`.
 */
import { http, HttpResponse, delay, type JsonBodyType } from 'msw';
import { getStore, resetStore, insert, updateById, removeById } from './store';

/** Simulated network latency (ms). Set to 0 to disable. */
const LATENCY_MS = 300;

async function simulateLatency(): Promise<void> {
  if (LATENCY_MS > 0) await delay(LATENCY_MS);
}

/** Throws a simulated server error for the given status. */
export function simulateError(status: number, message: string): never {
  throw new Error(`[mock] simulated ${status} error: ${message}`);
}

function json(body: JsonBodyType) {
  return HttpResponse.json(body);
}

/** Builds a new (PENDING) clearance item for records created in mock mode. */
function mockNewClearanceItem(
  category: 'ASSET_RETURN' | 'ACCESS_REVOCATION' | 'KNOWLEDGE_TRANSFER' | 'FINAL_SETTLEMENT',
  description: string,
  responsibleParty: string,
) {
  return {
    id: crypto.randomUUID(),
    category,
    description,
    responsible_party: responsibleParty,
    status: 'PENDING',
  };
}

export const handlers = [
  // ── Auth ────────────────────────────────────────────────────────────────
  http.post('/api/auth/login', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as { email?: string; password?: string };
    const user = getStore().demoUsers.find(
      (u) => u.email === body?.email && u.password === body?.password,
    );
    if (!user) {
      return HttpResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    const { password: _pw, ...safeUser } = user;
    return json({
      user: safeUser,
      accessToken: 'mock-access-token',
    });
  }),

  // ── Organization ────────────────────────────────────────────────────────
  http.get('/api/departments', async () => {
    await simulateLatency();
    return json({ departments: getStore().departments });
  }),
  http.get('/api/positions', async () => {
    await simulateLatency();
    return json({ positions: getStore().positions });
  }),
  http.get('/api/employees', async () => {
    await simulateLatency();
    return json({ employees: getStore().employees });
  }),

  // ── Documents ───────────────────────────────────────────────────────────
  http.get('/api/documents', async () => {
    await simulateLatency();
    return json({ documents: getStore().documents });
  }),

  // ── Expiry alerts ───────────────────────────────────────────────────────
  http.get('/api/alerts', async () => {
    await simulateLatency();
    return json({ alerts: getStore().expiryAlerts });
  }),

  // ── Audit ───────────────────────────────────────────────────────────────
  http.get('/api/audit-log', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 25);
    const logs = getStore().auditLog;
    const start = (page - 1) * pageSize;
    const paged = logs.slice(start, start + pageSize);
    return json({ logs: paged, pagination: { page, pageSize, total: logs.length } });
  }),

  // ── Recruitment ─────────────────────────────────────────────────────────
  http.get('/api/recruitment/requisitions', async () => {
    await simulateLatency();
    return json({ requisitions: getStore().jobRequisitions });
  }),
  http.post('/api/recruitment/requisitions', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as Record<string, unknown>;
    const record = { id: crypto.randomUUID(), status: 'DRAFT', ...body };
    insert(getStore().jobRequisitions, record as never);
    return json(record);
  }),
  http.get('/api/recruitment/candidates', async () => {
    await simulateLatency();
    return json({ candidates: getStore().candidates });
  }),
  http.post('/api/recruitment/candidates', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as Record<string, unknown>;
    const record = { id: crypto.randomUUID(), stage: 'APPLIED', ...body };
    insert(getStore().candidates, record as never);
    return json(record);
  }),
  http.get('/api/recruitment/offers', async () => {
    await simulateLatency();
    return json({ offers: getStore().offerLetters });
  }),
  http.get('/api/recruitment/candidates/:id/interviews', async ({ params }) => {
    await simulateLatency();
    const id = String(params.id);
    const list = getStore().interviews.filter((iv) => iv.candidate_id === id);
    return json({ interviews: list });
  }),
  http.post('/api/recruitment/candidates/:candidateId/interviews', async ({ params, request }) => {
    await simulateLatency();
    const candidateId = String(params.candidateId);
    const body = (await request.json()) as Record<string, unknown>;
    const candidate = getStore().candidates.find((c) => c.id === candidateId);
    const record = {
      id: crypto.randomUUID(),
      candidate_id: candidateId,
      candidate: {
        id: candidateId,
        name: candidate?.name ?? '',
        requisition: candidate?.requisition ?? { title: '' },
      },
      scheduled_at: body.scheduledAt != null ? String(body.scheduledAt) : new Date().toISOString(),
      duration_min: Number(body.durationMin ?? 30),
      interviewer_ids: Array.isArray(body.interviewers) ? (body.interviewers as string[]) : [],
      location: body.location != null ? String(body.location) : '',
      notes: body.notes != null ? String(body.notes) : '',
      status: 'SCHEDULED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    insert(getStore().interviews, record as never);
    return json(record);
  }),
  http.patch(
    '/api/recruitment/candidates/:candidateId/interviews/:interviewId/status',
    async ({ params, request }) => {
      await simulateLatency();
      const interviewId = String(params.interviewId);
      const body = (await request.json()) as Record<string, unknown>;
      const updated = updateById(getStore().interviews, interviewId, {
        status: String(body.status ?? 'SCHEDULED'),
        updated_at: new Date().toISOString(),
      } as never);
      if (!updated) return HttpResponse.json({ error: 'Interview not found' }, { status: 404 });
      return json(updated);
    },
  ),
  http.delete(
    '/api/recruitment/candidates/:candidateId/interviews/:interviewId',
    async ({ params }) => {
      await simulateLatency();
      const interviewId = String(params.interviewId);
      const removed = removeById(getStore().interviews, interviewId);
      if (!removed) return HttpResponse.json({ error: 'Interview not found' }, { status: 404 });
      return json({ ok: true });
    },
  ),
  http.get('/api/recruitment/employees/:id/onboarding', async ({ params }) => {
    await simulateLatency();
    const id = String(params.id);
    const tasks = getStore().onboardingRecords.filter((t) => t.employee_id === id);
    return json({ tasks });
  }),
  http.patch('/api/recruitment/onboarding-tasks/:id', async ({ params, request }) => {
    await simulateLatency();
    const id = String(params.id);
    const body = (await request.json()) as Record<string, unknown>;
    const updated = updateById(getStore().onboardingRecords, id, {
      ...body,
      updated_at: new Date().toISOString(),
    } as never);
    if (!updated) return HttpResponse.json({ error: 'Onboarding task not found' }, { status: 404 });
    return json(updated);
  }),

  // ── Attendance & Leave ──────────────────────────────────────────────────
  // Attendance summary is filtered by `?date=YYYY-MM-DD` and optionally by
  // `?employeeId=`, mirroring the backend `getAttendanceSummary` signature that
  // `attendanceRepo.summary({ date, employeeId })` calls.
  http.get('/api/attendance/summary', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const employeeId = url.searchParams.get('employeeId');
    let list = getStore().attendanceSummaries;
    if (date) list = list.filter((s) => s.date.slice(0, 10) === date.slice(0, 10));
    if (employeeId) list = list.filter((s) => s.employee_id === employeeId);
    return json({ summaries: list });
  }),
  http.get('/api/attendance/leave-types', async () => {
    await simulateLatency();
    return json({ leaveTypes: getStore().leaveTypes });
  }),
  http.get('/api/attendance/leave-requests', async () => {
    await simulateLatency();
    return json({ requests: getStore().leaveRequests });
  }),
  http.post('/api/attendance/leave-requests', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as Record<string, unknown>;
    const record = {
      id: crypto.randomUUID(),
      employee_id: 'e-006',
      employee: { id: 'e-006', first_name: 'Charlie', last_name: 'Doe' },
      status: 'PENDING_MANAGER_APPROVAL',
      submitted_by: 'Charlie Doe',
      submitted_at: new Date().toISOString(),
      approvals: [],
      ...body,
    };
    insert(getStore().leaveRequests, record as never);
    return json(record);
  }),
  http.get('/api/attendance/leave-balance', async () => {
    await simulateLatency();
    return json({ balances: getStore().leaveBalances });
  }),

  // ── Policy Groups ──────────────────────────────────────────────────────
  http.get('/api/attendance/policy-groups', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const year = Number(url.searchParams.get('year') ?? 0);
    const groups = year
      ? getStore().leavePolicyGroups.filter((g) => g.year === year)
      : getStore().leavePolicyGroups;
    return json({ policyGroups: groups });
  }),
  http.post('/api/attendance/policy-groups', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as Record<string, unknown>;
    const record = {
      id: crypto.randomUUID(),
      year: new Date().getFullYear(),
      grades: [],
      department_id: null,
      entitlements: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...body,
    };
    insert(getStore().leavePolicyGroups, record as never);
    return json(record);
  }),
  http.put('/api/attendance/policy-groups/:id', async ({ request, params }) => {
    await simulateLatency();
    const id = String(params.id);
    const body = (await request.json()) as Record<string, unknown>;
    const updated = updateById(getStore().leavePolicyGroups, id, {
      ...body,
      updated_at: new Date().toISOString(),
    } as never);
    if (!updated) return HttpResponse.json({ error: 'Policy group not found' }, { status: 404 });
    return json(updated);
  }),
  http.delete('/api/attendance/policy-groups/:id', async ({ params }) => {
    await simulateLatency();
    const id = String(params.id);
    const removed = removeById(getStore().leavePolicyGroups, id);
    if (!removed) return HttpResponse.json({ error: 'Policy group not found' }, { status: 404 });
    return json({ ok: true });
  }),

  // ── Holidays ───────────────────────────────────────────────────────────
  http.get('/api/attendance/holidays', async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const year = Number(url.searchParams.get('year') ?? 0);
    const list = year ? getStore().holidays.filter((h) => h.year === year) : getStore().holidays;
    return json({ holidays: list });
  }),
  http.put('/api/attendance/holidays', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as Record<string, unknown>;
    const date = String(body.date ?? '');
    const name = String(body.name ?? '');
    // Upsert by name + date to avoid duplicates on repeated saves.
    const existing = getStore().holidays.find(
      (h) => h.name === name && h.date.slice(0, 10) === date.slice(0, 10),
    );
    if (existing) {
      const updated = updateById(getStore().holidays, existing.id, {
        name,
        date: `${date}T00:00:00.000Z`,
        year: Number(body.year ?? new Date(date).getFullYear()),
        type: String(body.type ?? 'STATUTORY'),
        recurring: Boolean(body.recurring),
      } as never);
      return json(updated);
    }
    const record = {
      id: crypto.randomUUID(),
      name,
      date: `${date}T00:00:00.000Z`,
      year: Number(body.year ?? new Date(date).getFullYear()),
      type: String(body.type ?? 'STATUTORY'),
      recurring: Boolean(body.recurring),
    };
    insert(getStore().holidays, record as never);
    return json(record);
  }),
  http.delete('/api/attendance/holidays/:id', async ({ params }) => {
    await simulateLatency();
    const id = String(params.id);
    const removed = removeById(getStore().holidays, id);
    if (!removed) return HttpResponse.json({ error: 'Holiday not found' }, { status: 404 });
    return json({ ok: true });
  }),

  // ── Performance ─────────────────────────────────────────────────────────
  http.get('/api/performance/cycles', async () => {
    await simulateLatency();
    return json({ cycles: getStore().evaluationCycles });
  }),
  http.get('/api/performance/reviews', async () => {
    await simulateLatency();
    return json({ reviews: getStore().performanceReviews });
  }),

  // ── Offboarding ─────────────────────────────────────────────────────────
  http.get('/api/offboarding', async () => {
    await simulateLatency();
    return json({ records: getStore().offboardingRecords });
  }),
  http.get('/api/offboarding/:id/clearance', async ({ params }) => {
    await simulateLatency();
    const id = String(params.id);
    const record = getStore().offboardingRecords.find((r) => r.id === id);
    if (!record)
      return HttpResponse.json({ error: 'Offboarding record not found' }, { status: 404 });
    return json({ items: record.clearance_items });
  }),
  http.patch('/api/offboarding/clearance-items/:id', async ({ params, request }) => {
    await simulateLatency();
    const id = String(params.id);
    const body = (await request.json()) as Record<string, unknown>;
    let updated: Record<string, unknown> | undefined;
    for (const record of getStore().offboardingRecords) {
      const item = record.clearance_items.find((c) => c.id === id);
      if (!item) continue;
      item.status = String(body.status ?? item.status) as typeof item.status;
      if (body.waived_reason != null) item.waived_reason = String(body.waived_reason);
      if (body.waived_reason != null) item.completed_at = new Date().toISOString();
      updated = item as unknown as Record<string, unknown>;
      break;
    }
    if (!updated) return HttpResponse.json({ error: 'Clearance item not found' }, { status: 404 });
    return json(updated);
  }),
  http.post('/api/offboarding/terminations', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as Record<string, unknown>;
    const employeeId = String(body.employee_id ?? '');
    const employee = getStore().employees.find((e) => e.id === employeeId);
    if (!employee) return HttpResponse.json({ error: 'Employee not found' }, { status: 404 });
    const lastWorkingDay = String(body.effective_date ?? new Date().toISOString());
    const record = {
      id: crypto.randomUUID(),
      employee_id: employee.id,
      employee: { id: employee.id, first_name: employee.firstName, last_name: employee.lastName },
      separation_type: String(body.separation_type ?? 'RESIGNATION'),
      reason: body.reason != null ? String(body.reason) : '',
      last_working_day: `${lastWorkingDay.slice(0, 10)}T00:00:00.000Z`,
      status: 'INITIATED',
      initiated_by: 'Emily Doe',
      initiated_at: new Date().toISOString(),
      deactivation_date: `${lastWorkingDay.slice(0, 10)}T00:00:00.000Z`,
      clearance_items: [
        mockNewClearanceItem(
          'ASSET_RETURN',
          `Return company assets for ${employee.firstName}`,
          'Henry Doe',
        ),
        mockNewClearanceItem('ACCESS_REVOCATION', 'Revoke system access', 'Emily Doe'),
        mockNewClearanceItem('KNOWLEDGE_TRANSFER', 'Hand over responsibilities', 'Emily Doe'),
        mockNewClearanceItem('FINAL_SETTLEMENT', 'Compute final settlement', 'Grace Doe'),
      ],
      exit_interviews: [],
      settlements: [],
    };
    insert(getStore().offboardingRecords, record as never);
    return json(record);
  }),
  http.post('/api/offboarding/resignations', async ({ request }) => {
    await simulateLatency();
    const body = (await request.json()) as Record<string, unknown>;
    const employee = getStore().employees.find((e) => e.id === 'e-006');
    if (!employee) return HttpResponse.json({ error: 'Employee not found' }, { status: 404 });
    const lastWorkingDay = String(body.lastWorkingDay ?? new Date().toISOString());
    const record = {
      id: crypto.randomUUID(),
      employee_id: employee.id,
      employee: { id: employee.id, first_name: employee.firstName, last_name: employee.lastName },
      separation_type: 'RESIGNATION',
      reason: body.reason != null ? String(body.reason) : '',
      last_working_day: `${lastWorkingDay.slice(0, 10)}T00:00:00.000Z`,
      status: 'INITIATED',
      initiated_by: `${employee.firstName} ${employee.lastName}`,
      initiated_at: new Date().toISOString(),
      deactivation_date: `${lastWorkingDay.slice(0, 10)}T00:00:00.000Z`,
      clearance_items: [
        mockNewClearanceItem('ASSET_RETURN', 'Return company laptop and peripherals', 'Henry Doe'),
        mockNewClearanceItem('ACCESS_REVOCATION', 'Revoke system and VPN access', 'Emily Doe'),
        mockNewClearanceItem('KNOWLEDGE_TRANSFER', 'Hand over responsibilities', 'Alice Doe'),
        mockNewClearanceItem(
          'FINAL_SETTLEMENT',
          'Compute leave encashment and final dues',
          'Grace Doe',
        ),
      ],
      exit_interviews: [],
      settlements: [],
    };
    insert(getStore().offboardingRecords, record as never);
    return json(record);
  }),
  http.post('/api/offboarding/:id/exit-interview', async ({ params, request }) => {
    await simulateLatency();
    const id = String(params.id);
    const body = (await request.json()) as Record<string, unknown>;
    const record = getStore().offboardingRecords.find((r) => r.id === id);
    if (!record)
      return HttpResponse.json({ error: 'Offboarding record not found' }, { status: 404 });
    record.exit_interviews = [
      {
        conducted_by: 'Emily Doe',
        conducted_at: new Date().toISOString(),
        declined: Boolean(body.declined),
        responses: Array.isArray(body.responses) ? body.responses : [],
      },
    ];
    if (!record.exit_interviews[0]?.declined && record.status === 'EXIT_INTERVIEW') {
      record.status = 'SETTLEMENT';
    }
    return json(record.exit_interviews[0]);
  }),
  http.post('/api/offboarding/:id/close', async ({ params }) => {
    await simulateLatency();
    const id = String(params.id);
    const record = getStore().offboardingRecords.find((r) => r.id === id);
    if (!record)
      return HttpResponse.json({ error: 'Offboarding record not found' }, { status: 404 });
    record.status = 'CLOSED';
    return json({ ok: true, status: record.status });
  }),

  // ── GDPR ────────────────────────────────────────────────────────────────
  http.get('/api/gdpr/retention-policies', async () => {
    await simulateLatency();
    return json({ policies: getStore().mockRetentionPolicies });
  }),
  http.get('/api/gdpr/dsars', async () => {
    await simulateLatency();
    return json({ dsars: getStore().mockDsars });
  }),
  http.get('/api/gdpr/breaches', async () => {
    await simulateLatency();
    return json({ breaches: getStore().mockBreaches });
  }),

  // ── Utility ─────────────────────────────────────────────────────────────
  http.post('/api/mock/reset', async () => {
    resetStore();
    return json({ ok: true });
  }),
];
