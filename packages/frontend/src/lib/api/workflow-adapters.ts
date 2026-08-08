import type {
  JobRequisition,
  Candidate,
  CandidateStage,
  CandidateSource,
  EmploymentType,
  Interview,
  OfferLetter,
  OnboardingTask,
  AttendanceRecord,
  AttendanceStatus,
  LeaveRequest,
  LeaveBalance,
  LeaveType,
  Holiday,
  HolidayType,
  EvaluationCycle,
  PerformanceReview,
  ReviewStatus,
  OffboardingRecord,
  ClearanceItem,
  ExitInterview,
  FinalSettlement,
} from '@/types';

type BackendRecord = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? '' : String(v);
}
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function dt(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Map backend enum → frontend display label. */
function mapEmploymentType(s: unknown): EmploymentType {
  const map: Record<string, EmploymentType> = {
    FULL_TIME: 'Full-time',
    PART_TIME: 'Part-time',
    CONTRACT: 'Contract',
  };
  return map[str(s)] ?? 'Full-time';
}
function mapRequisitionStatus(s: unknown): JobRequisition['status'] {
  switch (str(s)) {
    case 'DRAFT':
      return 'Draft';
    case 'PENDING_APPROVAL':
      return 'Pending Approval';
    case 'APPROVED':
      return 'Approved';
    case 'PUBLISHED':
      return 'Published';
    default:
      return 'Closed';
  }
}
function mapCandidateStage(s: unknown): CandidateStage {
  const map: Record<string, CandidateStage> = {
    APPLIED: 'Applied',
    SCREENING: 'Screening',
    INTERVIEW: 'Interview',
    OFFER: 'Offer',
    HIRED: 'Hired',
    REJECTED: 'Rejected',
  };
  return map[str(s)] ?? 'Applied';
}
function mapCandidateSource(s: unknown): CandidateSource {
  const map: Record<string, CandidateSource> = {
    REFERRAL: 'Referral',
    JOB_BOARD: 'Job Board',
    DIRECT: 'Direct',
    INTERNAL: 'Internal',
  };
  return map[str(s)] ?? 'Direct';
}
function mapAttendanceStatus(s: unknown): AttendanceStatus {
  const map: Record<string, AttendanceStatus> = {
    PRESENT: 'Present',
    ABSENT: 'Absent',
    LATE: 'Late',
    EARLY_DEPARTURE: 'Early Departure',
    LATE_EARLY_DEPARTURE: 'Late',
    ON_LEAVE: 'On Leave',
    HOLIDAY: 'Holiday',
  };
  return map[str(s)] ?? 'Absent';
}
function mapLeaveType(s: unknown): LeaveType {
  const map: Record<string, LeaveType> = {
    ANNUAL: 'Annual',
    SICK: 'Sick',
    PERSONAL: 'Personal',
    UNPAID: 'Unpaid',
  };
  return map[str(s).toUpperCase()] ?? 'Annual';
}
function mapLeaveStatus(s: unknown): LeaveRequest['status'] {
  const map: Record<string, LeaveRequest['status']> = {
    PENDING_MANAGER_APPROVAL: 'Pending Manager Approval',
    PENDING_HR_APPROVAL: 'Pending HR Approval',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    WITHDRAWN: 'Withdrawn',
  };
  return map[str(s)] ?? 'Pending Manager Approval';
}
function mapReviewStatus(s: unknown): ReviewStatus {
  const map: Record<string, ReviewStatus> = {
    NOT_STARTED: 'Not Started',
    SELF_EVALUATION: 'Self-Evaluation',
    MANAGER_EVALUATION: 'Manager Evaluation',
    HR_REVIEW: 'HR Review',
    COMPLETED: 'Completed',
  };
  return map[str(s)] ?? 'Not Started';
}
function mapOffboardingStatus(s: unknown): OffboardingRecord['status'] {
  const map: Record<string, OffboardingRecord['status']> = {
    INITIATED: 'Initiated',
    CLEARANCE_IN_PROGRESS: 'Clearance In Progress',
    EXIT_INTERVIEW: 'Exit Interview',
    SETTLEMENT: 'Settlement',
    CLOSED: 'Closed',
  };
  return map[str(s)] ?? 'Initiated';
}
function mapClearanceStatus(s: unknown): ClearanceItem['status'] {
  const map: Record<string, ClearanceItem['status']> = {
    PENDING: 'Pending',
    COMPLETE: 'Complete',
    WAIVED: 'Waived',
  };
  return map[str(s)] ?? 'Pending';
}

function fullName(raw: BackendRecord): string {
  return [raw.first_name, raw.last_name].filter(Boolean).join(' ') || '';
}

export function adaptJobRequisition(raw: BackendRecord): JobRequisition {
  const dept = (raw.department as BackendRecord | null) ?? {};
  const pos = (raw.position as BackendRecord | null) ?? {};
  const count = (raw._count as BackendRecord | null) ?? {};
  return {
    id: str(raw.id),
    title: str(raw.title),
    departmentId: str(dept.id ?? raw.department_id),
    departmentName: str(dept.name),
    positionId: str(pos.id ?? raw.position_id),
    positionName: str(pos.name),
    headcount: num(raw.headcount),
    employmentType: mapEmploymentType(raw.employment_type),
    status: mapRequisitionStatus(raw.status),
    createdBy: str(raw.created_by),
    createdAt: dt(raw.created_at),
    publishedAt: raw.published_at != null ? dt(raw.published_at) : null,
    closingDate: raw.closing_date != null ? dt(raw.closing_date) : null,
    applicantCount: num(count.candidates),
  };
}

export function adaptCandidate(raw: BackendRecord): Candidate {
  const req = (raw.requisition as BackendRecord | null) ?? {};
  return {
    id: str(raw.id),
    requisitionId: str(raw.requisition_id),
    requisitionTitle: str(req.title),
    name: str(raw.name),
    email: str(raw.email),
    phone: str(raw.phone),
    source: mapCandidateSource(raw.source),
    stage: mapCandidateStage(raw.stage),
    resumeFilename: raw.resume_path ? str(raw.resume_path) : undefined,
    consentRecorded: Boolean(raw.consent_recorded),
    appliedAt: dt(raw.applied_at),
    employeeId: raw.employee_id ? str(raw.employee_id) : undefined,
    stageHistory: [],
  };
}

export function adaptInterview(raw: BackendRecord): Interview {
  const cand = (raw.candidate as BackendRecord | null) ?? {};
  const req = (cand.requisition as BackendRecord | null) ?? {};
  const statusMap: Record<string, Interview['status']> = {
    SCHEDULED: 'Scheduled',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  };
  return {
    id: str(raw.id),
    candidateId: str(raw.candidate_id ?? cand.id),
    candidateName: str(cand.name ?? raw.candidateName),
    requisitionTitle: str(req.title ?? raw.requisitionTitle),
    scheduledAt: dt(raw.scheduled_at),
    durationMin: num(raw.duration_min),
    interviewers: Array.isArray(raw.interviewer_ids) ? raw.interviewer_ids.map(str) : [],
    location: str(raw.location),
    notes: raw.notes != null ? str(raw.notes) : undefined,
    status: statusMap[str(raw.status)] ?? 'Scheduled',
  };
}

export function adaptOfferLetter(raw: BackendRecord): OfferLetter {
  const cand = (raw.candidate as BackendRecord | null) ?? {};
  const statusMap: Record<string, OfferLetter['status']> = {
    DRAFT: 'Draft',
    SENT: 'Sent',
    ACCEPTED: 'Accepted',
    DECLINED: 'Declined',
  };
  return {
    id: str(raw.id),
    candidateId: str(raw.candidate_id ?? cand.id),
    candidateName: str(cand.name ?? raw.candidateName),
    position: str(raw.position),
    salary: num(raw.salary),
    startDate: dt(raw.start_date),
    status: statusMap[str(raw.status)] ?? 'Draft',
    sentAt: raw.sent_at != null ? dt(raw.sent_at) : null,
    acceptedAt: raw.accepted_at != null ? dt(raw.accepted_at) : null,
    createdBy: str(raw.created_by),
    createdAt: dt(raw.created_at),
  };
}

export function adaptOnboardingTask(raw: BackendRecord): OnboardingTask {
  const assignee = (raw.assignee as BackendRecord | null) ?? {};
  const typeMap: Record<string, OnboardingTask['type']> = {
    DOCUMENT_SUBMISSION: 'Document Submission',
    EQUIPMENT_ASSIGNMENT: 'Equipment Assignment',
    ORIENTATION_SESSION: 'Orientation Session',
    SYSTEM_ACCESS_SETUP: 'System Access Setup',
  };
  const statusMap: Record<string, OnboardingTask['status']> = {
    PENDING: 'Pending',
    COMPLETE: 'Complete',
    OVERDUE: 'Overdue',
  };
  return {
    id: str(raw.id),
    employeeId: str(raw.employee_id),
    employeeName: '',
    type: typeMap[str(raw.type)] ?? 'Document Submission',
    assignee: str(assignee.email ?? raw.assignee),
    dueDate: raw.due_date != null ? dt(raw.due_date) : '',
    status: statusMap[str(raw.status)] ?? 'Pending',
    completedAt: raw.completed_at != null ? dt(raw.completed_at) : null,
  };
}

export function adaptAttendance(raw: BackendRecord): AttendanceRecord {
  return {
    id: str(raw.id),
    employeeId: str(raw.employeeId ?? raw.employee_id),
    employeeName: str(raw.employeeName ?? ''),
    date: '',
    clockIn: raw.clockIn != null ? dt(raw.clockIn) : null,
    clockOut: raw.clockOut != null ? dt(raw.clockOut) : null,
    totalHours: raw.totalHours != null ? num(raw.totalHours) : null,
    status: mapAttendanceStatus(raw.status),
    ipAddress: raw.ip_address != null ? str(raw.ip_address) : undefined,
  };
}

export function adaptLeaveRequest(raw: BackendRecord): LeaveRequest {
  const emp = (raw.employee as BackendRecord | null) ?? {};
  const lt = (raw.leave_type as BackendRecord | null) ?? {};
  const approvals = Array.isArray(raw.approvals)
    ? raw.approvals.map((a: BackendRecord) => ({
        level: num(a.level),
        approver: str(a.approver_id),
        decision: (str(a.action) === 'APPROVE'
          ? 'Approved'
          : str(a.action) === 'REJECT'
            ? 'Rejected'
            : 'Pending') as LeaveRequest['approvals'][number]['decision'],
        comment: a.comment != null ? str(a.comment) : undefined,
        at: dt(a.created_at),
      }))
    : [];
  return {
    id: str(raw.id),
    employeeId: str(raw.employee_id ?? emp.id),
    employeeName: fullName(emp),
    leaveType: mapLeaveType(lt.name ?? raw.leave_type),
    startDate: dt(raw.start_date),
    endDate: dt(raw.end_date),
    days: num(raw.days),
    reason: str(raw.reason),
    attachmentFilename: raw.attachment_path != null ? str(raw.attachment_path) : undefined,
    status: mapLeaveStatus(raw.status),
    submittedBy: str(raw.submitted_by),
    submittedAt: dt(raw.submitted_at),
    approvals,
  };
}

export function adaptLeaveBalance(raw: BackendRecord): LeaveBalance {
  const rawProration = raw.proration as BackendRecord | null | undefined;
  const rawProbation = raw.probation as BackendRecord | null | undefined;
  return {
    employeeId: str(raw.employeeId ?? raw.employee_id),
    leaveTypeId: str(raw.leaveTypeId ?? raw.leave_type_id),
    leaveType: mapLeaveType(raw.name),
    entitlement: num(raw.entitlement),
    accrued: num(raw.accrued),
    used: num(raw.used),
    pending: num(raw.pending),
    carryForward: num(raw.carryForward ?? raw.carry_forward ?? 0),
    available: num(raw.available),
    source: raw.source != null ? str(raw.source) : null,
    policyGroupName: raw.policyGroupName != null ? str(raw.policyGroupName) : null,
    prorated: Boolean(raw.prorated),
    proration: rawProration
      ? {
          fullEntitlement: num(rawProration.fullEntitlement),
          proratedEntitlement: num(rawProration.proratedEntitlement),
          hireDate: str(rawProration.hireDate),
          remainingDays: num(rawProration.remainingDays),
          totalDays: num(rawProration.totalDays),
          remainingMonths: num(rawProration.remainingMonths),
          fraction: num(rawProration.fraction),
        }
      : null,
    probation: rawProbation
      ? {
          underProbation: Boolean(rawProbation.underProbation),
          hireDate: str(rawProbation.hireDate),
          probationMonths: num(rawProbation.probationMonths),
          probationEndDate: str(rawProbation.probationEndDate),
          remainingDays: num(rawProbation.remainingDays),
        }
      : null,
  };
}

export function adaptHoliday(raw: BackendRecord): Holiday {
  return {
    id: str(raw.id),
    name: str(raw.name),
    date: dt(raw.date),
    year: num(raw.year),
    type: (str(raw.type) as HolidayType) || 'STATUTORY',
    recurring: Boolean(raw.recurring),
  };
}

export function adaptEvaluationCycle(raw: BackendRecord): EvaluationCycle {
  const typeMap: Record<string, EvaluationCycle['type']> = {
    PROBATION: 'Probation',
    MID_YEAR: 'Mid-Year',
    END_YEAR: 'End-Year',
  };
  const statusMap: Record<string, EvaluationCycle['status']> = {
    DRAFT: 'Draft',
    OPEN: 'Open',
    CLOSED: 'Closed',
  };

  // Compute current phase from dates
  const now = new Date();
  let currentPhase: EvaluationCycle['currentPhase'] = 'Not Started';
  const status = statusMap[str(raw.status)] ?? 'Draft';
  if (status === 'Open') {
    const selfStart = new Date(str(raw.self_eval_start));
    const selfEnd = new Date(str(raw.self_eval_end));
    const mgrStart = new Date(str(raw.manager_eval_start));
    const mgrEnd = new Date(str(raw.manager_eval_end));
    const hrStart = new Date(str(raw.hr_review_start));
    const hrEnd = new Date(str(raw.hr_review_end));

    if (now >= selfStart && now <= selfEnd) {
      currentPhase = 'Self-Evaluation';
    } else if (now >= mgrStart && now <= mgrEnd) {
      currentPhase = 'Manager Evaluation';
    } else if (now >= hrStart && now <= hrEnd) {
      currentPhase = 'HR Review';
    } else if (now > hrEnd) {
      currentPhase = 'Completed';
    } else {
      currentPhase = 'Not Started';
    }
  } else if (status === 'Closed') {
    currentPhase = 'Completed';
  }

  return {
    id: str(raw.id),
    type: typeMap[str(raw.type)] ?? 'End-Year',
    periodStart: dt(raw.period_start),
    periodEnd: dt(raw.period_end),
    selfEvalStart: dt(raw.self_eval_start),
    selfEvalEnd: dt(raw.self_eval_end),
    managerEvalStart: dt(raw.manager_eval_start),
    managerEvalEnd: dt(raw.manager_eval_end),
    hrReviewStart: dt(raw.hr_review_start),
    hrReviewEnd: dt(raw.hr_review_end),
    status,
    currentPhase,
  };
}

export function adaptPerformanceReview(raw: BackendRecord): PerformanceReview {
  const emp = (raw.employee as BackendRecord | null) ?? {};
  const cycle = (raw.cycle as BackendRecord | null) ?? {};
  const mgr = (emp.manager as BackendRecord | null) ?? {};

  // Parse competencies from the self-eval JSON, then merge any manager ratings
  // that were stored separately in the manager-eval JSON.
  const selfEvalRaw = raw.self_eval;
  const selfEvalObj =
    selfEvalRaw && typeof selfEvalRaw === 'object'
      ? (selfEvalRaw as Record<string, unknown>)
      : null;
  const competenciesRaw = Array.isArray(selfEvalObj?.competencies)
    ? (selfEvalObj.competencies as Record<string, unknown>[])
    : [];
  const competencyMap = new Map<string, PerformanceReview['competencies'][number]>();
  for (const c of competenciesRaw) {
    const name = str(c.name);
    if (!name) continue;
    competencyMap.set(name, {
      competency: name,
      selfRating: c.selfRating != null ? (num(c.selfRating) as 1 | 2 | 3 | 4 | 5) : undefined,
      managerRating:
        c.managerRating != null ? (num(c.managerRating) as 1 | 2 | 3 | 4 | 5) : undefined,
      comments: c.comment != null ? str(c.comment) : undefined,
    });
  }
  // Merge manager ratings stored under manager_eval.competencies
  const managerEvalRaw = raw.manager_eval;
  const managerEvalObj =
    managerEvalRaw && typeof managerEvalRaw === 'object'
      ? (managerEvalRaw as Record<string, unknown>)
      : null;
  if (Array.isArray(managerEvalObj?.competencies)) {
    for (const c of managerEvalObj.competencies as Record<string, unknown>[]) {
      const name = str(c.name);
      if (!name) continue;
      const existing = competencyMap.get(name) ?? {
        competency: name,
        comments: c.comment != null ? str(c.comment) : undefined,
      };
      existing.managerRating =
        c.managerRating != null
          ? (num(c.managerRating) as 1 | 2 | 3 | 4 | 5)
          : existing.managerRating;
      competencyMap.set(name, existing);
    }
  }
  const parsedCompetencies: PerformanceReview['competencies'] = Array.from(competencyMap.values());

  // Format cycle type to human-readable
  const cycleTypeMap: Record<string, string> = {
    PROBATION: 'Probation',
    MID_YEAR: 'Mid-Year',
    END_YEAR: 'End-Year',
  };

  return {
    id: str(raw.id),
    cycleId: str(raw.cycle_id ?? cycle.id),
    cycleName: cycleTypeMap[str(cycle.type)] ?? str(cycle.type),
    employeeId: str(raw.employee_id ?? emp.id),
    employeeName: fullName(emp),
    managerName: fullName(mgr),
    status: mapReviewStatus(raw.status),
    selfEvaluationSubmitted: raw.self_eval_submitted_at != null,
    selfEvaluationSubmittedAt:
      raw.self_eval_submitted_at != null ? dt(raw.self_eval_submitted_at) : null,
    managerEvaluationSubmitted: raw.manager_eval_submitted_at != null,
    managerEvaluationSubmittedAt:
      raw.manager_eval_submitted_at != null ? dt(raw.manager_eval_submitted_at) : null,
    hrFinalized: raw.hr_finalized_at != null,
    hrFinalizedAt: raw.hr_finalized_at != null ? dt(raw.hr_finalized_at) : null,
    competencies: parsedCompetencies,
    achievements: selfEvalObj?.achievements != null ? str(selfEvalObj.achievements) : undefined,
    goals: selfEvalObj?.goals != null ? str(selfEvalObj.goals) : undefined,
    managerComments:
      raw.manager_eval != null
        ? typeof raw.manager_eval === 'object'
          ? str((raw.manager_eval as Record<string, unknown>).comments)
          : JSON.stringify(raw.manager_eval)
        : undefined,
    hrComments: raw.hr_comments != null ? str(raw.hr_comments) : undefined,
    overallRating:
      raw.overall_rating != null
        ? (num(raw.overall_rating) as PerformanceReview['overallRating'])
        : undefined,
    rebuttal: raw.rebuttal != null ? str(raw.rebuttal) : undefined,
  };
}

export function adaptClearanceItem(raw: BackendRecord): ClearanceItem {
  const party = (raw.responsible_party as BackendRecord | null) ?? {};
  const catMap: Record<string, ClearanceItem['category']> = {
    ASSET_RETURN: 'Asset Return',
    ACCESS_REVOCATION: 'Access Revocation',
    KNOWLEDGE_TRANSFER: 'Knowledge Transfer',
    FINAL_SETTLEMENT: 'Final Settlement',
  };
  return {
    id: str(raw.id),
    category: catMap[str(raw.category)] ?? 'Asset Return',
    description: str(raw.description),
    responsibleParty: str(party.email ?? raw.responsible_party),
    status: mapClearanceStatus(raw.status),
    completedAt: raw.completed_at != null ? dt(raw.completed_at) : null,
    signOffBy: raw.sign_off_by != null ? str(raw.sign_off_by) : undefined,
    waivedReason: raw.waived_reason != null ? str(raw.waived_reason) : undefined,
  };
}

export function adaptExitInterview(raw: BackendRecord): ExitInterview {
  return {
    conductedBy: str(raw.conducted_by),
    conductedAt: raw.conducted_at != null ? dt(raw.conducted_at) : '',
    declined: Boolean(raw.declined),
    responses: Array.isArray(raw.responses) ? raw.responses : [],
  };
}

export function adaptSettlement(raw: BackendRecord): FinalSettlement {
  return {
    generatedAt: dt(raw.generated_at),
    lastWorkingDay: dt(raw.last_working_day),
    leaveEncashmentDays: num(raw.leave_encashment_days),
    leaveEncashmentAmount: num(raw.leave_encashment_amount),
    pendingDues: Array.isArray(raw.pending_dues) ? raw.pending_dues : [],
    totalAmount: num(raw.total_amount),
    outstandingFlagged: Boolean(raw.outstanding_flagged),
  };
}

export function adaptOffboardingRecord(raw: BackendRecord): OffboardingRecord {
  const emp = (raw.employee as BackendRecord | null) ?? {};
  const typeMap: Record<string, OffboardingRecord['separationType']> = {
    RESIGNATION: 'Resignation',
    DISMISSAL: 'Dismissal',
    END_OF_CONTRACT: 'End of Contract',
  };
  return {
    id: str(raw.id),
    employeeId: str(raw.employee_id ?? emp.id),
    employeeName: fullName(emp),
    positionName: '',
    separationType: typeMap[str(raw.separation_type)] ?? 'Resignation',
    reason: str(raw.reason),
    lastWorkingDay: dt(raw.last_working_day),
    status: mapOffboardingStatus(raw.status),
    initiatedBy: str(raw.initiated_by),
    initiatedAt: dt(raw.initiated_at),
    deactivationDate: dt(raw.deactivation_date),
    clearanceItems: Array.isArray(raw.clearance_items)
      ? raw.clearance_items.map(adaptClearanceItem)
      : [],
    exitInterview:
      Array.isArray(raw.exit_interviews) && (raw.exit_interviews as BackendRecord[]).length
        ? adaptExitInterview((raw.exit_interviews as BackendRecord[])[0]!)
        : null,
    settlement:
      Array.isArray(raw.settlements) && (raw.settlements as BackendRecord[]).length
        ? adaptSettlement((raw.settlements as BackendRecord[])[0]!)
        : null,
  };
}
