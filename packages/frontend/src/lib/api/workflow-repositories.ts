import { api } from '../api-client';
import {
  adaptJobRequisition,
  adaptCandidate,
  adaptInterview,
  adaptOfferLetter,
  adaptOnboardingTask,
  adaptAttendance,
  adaptLeaveRequest,
  adaptLeaveBalance,
  adaptHoliday,
  adaptEvaluationCycle,
  adaptPerformanceReview,
  adaptOffboardingRecord,
  adaptClearanceItem,
} from './workflow-adapters';

type BackendRecord = Record<string, unknown>;

/** Recruitment & Onboarding */
export const recruitmentRepo = {
  listRequisitions: async (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await api.get<{ requisitions: BackendRecord[] }>(
      `/api/recruitment/requisitions${q}`,
    );
    return (res.requisitions ?? []).map(adaptJobRequisition);
  },
  createRequisition: (payload: {
    title: string;
    departmentId: string;
    positionId: string;
    headcount: number;
    employmentType: string;
    closingDate?: string | undefined;
  }) => api.post<BackendRecord>('/api/recruitment/requisitions', payload),
  submitRequisition: (id: string) =>
    api.post<BackendRecord>(`/api/recruitment/requisitions/${id}/submit`),
  approveRequisition: (id: string) =>
    api.post<BackendRecord>(`/api/recruitment/requisitions/${id}/approve`),
  publishRequisition: (id: string) =>
    api.post<BackendRecord>(`/api/recruitment/requisitions/${id}/publish`),
  closeRequisition: (id: string) =>
    api.post<BackendRecord>(`/api/recruitment/requisitions/${id}/close`),
  listCandidates: async (requisitionId?: string, stage?: string) => {
    const q = new URLSearchParams();
    if (requisitionId) q.set('requisitionId', requisitionId);
    if (stage) q.set('stage', stage);
    const res = await api.get<{ candidates: BackendRecord[] }>(
      `/api/recruitment/candidates${q.toString() ? `?${q.toString()}` : ''}`,
    );
    return (res.candidates ?? []).map(adaptCandidate);
  },
  createCandidate: (payload: {
    name: string;
    email: string;
    phone?: string | undefined;
    source?: string | undefined;
    requisitionId: string;
    consentRecorded?: boolean | undefined;
  }) => api.post<BackendRecord>('/api/recruitment/candidates', payload),
  updateCandidateStage: (id: string, stage: string) =>
    api.patch<BackendRecord>(`/api/recruitment/candidates/${id}/stage`, { stage }),
  listInterviews: async (candidateId: string) => {
    const res = await api.get<{ interviews: BackendRecord[] }>(
      `/api/recruitment/candidates/${candidateId}/interviews`,
    );
    return (res.interviews ?? []).map(adaptInterview);
  },
  createInterview: (
    candidateId: string,
    payload: {
      scheduledAt: string;
      durationMin?: number | undefined;
      interviewerIds?: string[] | undefined;
      location?: string | undefined;
      notes?: string | undefined;
    },
  ) => api.post<BackendRecord>(`/api/recruitment/candidates/${candidateId}/interviews`, payload),
  deleteInterview: (candidateId: string, interviewId: string) =>
    api.del<{ interview: BackendRecord }>(
      `/api/recruitment/candidates/${candidateId}/interviews/${interviewId}`,
    ),
  updateInterviewStatus: (candidateId: string, interviewId: string, status: string) =>
    api.patch<{ interview: BackendRecord }>(
      `/api/recruitment/candidates/${candidateId}/interviews/${interviewId}/status`,
      { status },
    ),
  createOffer: (
    candidateId: string,
    payload: { position: string; salary: number; startDate: string; terms?: string | undefined },
  ) => api.post<BackendRecord>(`/api/recruitment/candidates/${candidateId}/offers`, payload),
  listOffers: async () => {
    const res = await api.get<{ offers: BackendRecord[] }>('/api/recruitment/offers');
    return (res.offers ?? []).map(adaptOfferLetter);
  },
  sendOffer: (offerId: string) =>
    api.post<BackendRecord>(`/api/recruitment/offers/${offerId}/send`),
  acceptOffer: (offerId: string) =>
    api.post<BackendRecord>(`/api/recruitment/offers/${offerId}/accept`),
  deleteOffer: (offerId: string) => api.del<BackendRecord>(`/api/recruitment/offers/${offerId}`),
  convertCandidate: (
    candidateId: string,
    payload: {
      departmentId: string;
      positionId: string;
      hireDate: string;
      managerId?: string | undefined;
    },
  ) => api.post<BackendRecord>(`/api/recruitment/candidates/${candidateId}/convert`, payload),
  listOnboarding: async (employeeId: string) => {
    const res = await api.get<{ tasks: BackendRecord[] }>(
      `/api/recruitment/employees/${employeeId}/onboarding`,
    );
    return (res.tasks ?? []).map(adaptOnboardingTask);
  },
  updateOnboardingTask: (
    id: string,
    payload: { status?: string; assigneeId?: string; dueDate?: string },
  ) => api.patch<BackendRecord>(`/api/recruitment/onboarding-tasks/${id}`, payload),
};

/** Attendance & Leave */
export const attendanceRepo = {
  clock: (type: 'IN' | 'OUT') => api.post<BackendRecord>('/api/attendance/clock', { type }),
  summary: async (params?: { employeeId?: string; date?: string }) => {
    const q = new URLSearchParams();
    if (params?.employeeId) q.set('employeeId', params.employeeId);
    if (params?.date) q.set('date', params.date);
    const res = await api.get<{ summaries: BackendRecord[] }>(
      `/api/attendance/summary${q.toString() ? `?${q.toString()}` : ''}`,
    );
    return (res.summaries ?? []).map(adaptAttendance);
  },
  listLeaveTypes: async () => {
    const res = await api.get<{ leaveTypes: BackendRecord[] }>('/api/attendance/leave-types');
    return (res.leaveTypes ?? []).map((lt) => ({ id: String(lt.id), name: String(lt.name) }));
  },
  submitLeaveRequest: (payload: {
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    reason?: string;
  }) => api.post<BackendRecord>('/api/attendance/leave-requests', payload),
  listLeaveRequests: async (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await api.get<{ requests: BackendRecord[] }>(`/api/attendance/leave-requests${q}`);
    return (res.requests ?? []).map(adaptLeaveRequest);
  },
  approveLeave: (id: string, comment?: string) =>
    api.post<BackendRecord>(`/api/attendance/leave-requests/${id}/approve`, { comment }),
  rejectLeave: (id: string, comment?: string) =>
    api.post<BackendRecord>(`/api/attendance/leave-requests/${id}/reject`, { comment }),
  balance: async () => {
    const res = await api.get<{ balances: BackendRecord[] }>('/api/attendance/leave-balance');
    // The backend returns a per-employee wrapper: { employeeId, balances: [...] }.
    // Flatten into a single list of LeaveBalance records.
    return (res.balances ?? []).flatMap((emp) =>
      ((emp.balances as BackendRecord[] | undefined) ?? []).map((lb) =>
        adaptLeaveBalance({ ...lb, employeeId: emp.employee_id ?? emp.employeeId }),
      ),
    );
  },
  // ── Policy Groups ──
  listPolicyGroups: async (year?: number) => {
    const q = year ? `?year=${year}` : '';
    const res = await api.get<{ policyGroups: BackendRecord[] }>(
      `/api/attendance/policy-groups${q}`,
    );
    return (res.policyGroups ?? []).map(
      (g) => g as unknown as import('../../types').LeavePolicyGroup,
    );
  },
  createPolicyGroup: (payload: {
    name: string;
    description?: string | undefined;
    year: number;
    employment_type?: string | undefined;
    grades?: string[] | undefined;
    department_id?: string | undefined;
    proration_enabled?: boolean | undefined;
    entitlements: { leave_type_id: string; annual_days: number }[];
  }) => api.post<BackendRecord>('/api/attendance/policy-groups', payload),
  updatePolicyGroup: (
    id: string,
    payload: Partial<{
      name: string;
      description: string | undefined;
      employment_type: string | undefined;
      grades: string[];
      department_id: string;
      proration_enabled: boolean;
      entitlements: { leave_type_id: string; annual_days: number }[];
    }>,
  ) => api.put<BackendRecord>(`/api/attendance/policy-groups/${id}`, payload),
  deletePolicyGroup: (id: string) => api.del<BackendRecord>(`/api/attendance/policy-groups/${id}`),

  listHolidays: async (year?: number) => {
    const q = year ? `?year=${year}` : '';
    const res = await api.get<{ holidays: BackendRecord[] }>(`/api/attendance/holidays${q}`);
    return (res.holidays ?? []).map(adaptHoliday);
  },
  upsertHoliday: (payload: {
    name: string;
    date: string;
    year: number;
    type: string;
    recurring: boolean;
  }) => api.put<BackendRecord>('/api/attendance/holidays', payload),
  deleteHoliday: (id: string) => api.del<BackendRecord>(`/api/attendance/holidays/${id}`),
};

/** Performance Management */
export const performanceRepo = {
  listCycles: async (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await api.get<{ cycles: BackendRecord[] }>(`/api/performance/cycles${q}`);
    return (res.cycles ?? []).map(adaptEvaluationCycle);
  },
  createCycle: (payload: Record<string, unknown>) =>
    api.post<BackendRecord>('/api/performance/cycles', payload),
  listProbationEligible: async () => {
    const res = await api.get<{ employees: BackendRecord[] }>(
      '/api/performance/cycles/probation/eligible',
    );
    return (res.employees ?? []).map((e) => ({
      id: String(e.id),
      firstName: String(e.first_name ?? ''),
      lastName: String(e.last_name ?? ''),
      email: String(e.email ?? ''),
      probationEnd: String(e.probation_end ?? ''),
    }));
  },
  openCycle: (id: string) => api.post<BackendRecord>(`/api/performance/cycles/${id}/open`),
  closeCycle: (id: string) => api.post<BackendRecord>(`/api/performance/cycles/${id}/close`),
  listReviews: async () => {
    const res = await api.get<{ reviews: BackendRecord[] }>('/api/performance/reviews');
    return (res.reviews ?? []).map(adaptPerformanceReview);
  },
  submitSelf: (id: string, selfEval: unknown) =>
    api.post<BackendRecord>(`/api/performance/reviews/${id}/self`, { selfEval }),
  submitManager: (id: string, managerEval: unknown) =>
    api.post<BackendRecord>(`/api/performance/reviews/${id}/manager`, { managerEval }),
  finalize: (id: string, overallRating: number, hrComments?: string) =>
    api.post<BackendRecord>(`/api/performance/reviews/${id}/finalize`, {
      overallRating,
      hrComments,
    }),
  addRebuttal: (id: string, rebuttal: string) =>
    api.post<BackendRecord>(`/api/performance/reviews/${id}/rebuttal`, { rebuttal }),
};

/** Offboarding & Separation */
export const offboardingRepo = {
  submitResignation: (payload: { reason?: string; lastWorkingDay: string }) =>
    api.post<BackendRecord>('/api/offboarding/resignations', payload),
  initiateTermination: (payload: {
    employeeId: string;
    separationType: string;
    reason?: string | undefined;
    effectiveDate: string;
  }) => api.post<BackendRecord>('/api/offboarding/terminations', payload),
  list: async (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await api.get<{ records: BackendRecord[] }>(`/api/offboarding${q}`);
    return (res.records ?? []).map(adaptOffboardingRecord);
  },
  listClearance: async (offboardingId: string) => {
    const res = await api.get<{ items: BackendRecord[] }>(
      `/api/offboarding/${offboardingId}/clearance`,
    );
    return (res.items ?? []).map(adaptClearanceItem);
  },
  updateClearanceItem: (
    id: string,
    payload: { status?: string; responsiblePartyId?: string; waivedReason?: string },
  ) => api.patch<BackendRecord>(`/api/offboarding/clearance-items/${id}`, payload),
  close: (offboardingId: string) =>
    api.post<BackendRecord>(`/api/offboarding/${offboardingId}/close`),
  conductExitInterview: (
    offboardingId: string,
    payload: { responses: unknown; declined?: boolean },
  ) => api.post<BackendRecord>(`/api/offboarding/${offboardingId}/exit-interview`, payload),
};
