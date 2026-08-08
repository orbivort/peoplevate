import { prisma } from '../config/prisma.js';
import { withAuditContext } from '../utils/audit-context.js';
import { assertTransition } from '../utils/state-machine.js';
import { createEmployee } from './employee-service.js';
import { sendOfferLetterEmail } from './email-service.js';
import { HttpError } from '../utils/http-error.js';
import type { Prisma } from '#prisma';
import {
  RequisitionStatus,
  CandidateStage,
  OfferStatus,
  CandidateSource,
  OnboardingTaskType,
  EmploymentStatus,
  EmploymentType,
  InterviewStatus,
  ConsentMechanism,
  ConsentStatus,
} from '#prisma';

// ── Requisition state transitions ──────────────
const REQUISITION_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CLOSED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CLOSED'],
  APPROVED: ['PUBLISHED', 'CLOSED'],
  PUBLISHED: ['CLOSED'],
  CLOSED: [],
};

// ── Candidate stage transitions ────────────────
const CANDIDATE_TRANSITIONS: Record<string, string[]> = {
  APPLIED: ['SCREENING', 'REJECTED'],
  SCREENING: ['INTERVIEW', 'REJECTED', 'APPLIED'],
  INTERVIEW: ['OFFER', 'REJECTED', 'SCREENING', 'APPLIED'],
  OFFER: ['HIRED', 'REJECTED', 'INTERVIEW'],
  HIRED: ['REJECTED'],
  REJECTED: ['APPLIED', 'SCREENING'],
};

// ── Requisitions ───────────────────────────────

export async function listRequisitions(params: {
  role: string;
  userId: string;
  status?: string | undefined;
}): Promise<unknown[]> {
  const where: Record<string, unknown> = { deleted_at: null };

  // Manager: only own department requisitions
  if (params.role === 'MANAGER') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { department_id: true },
    });
    if (!self) return [];
    where.department_id = self.department_id;
  }

  if (params.status) {
    where.status = params.status;
  }

  const requisitions = await prisma.jobRequisition.findMany({
    where,
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true, grade: true } },
      _count: { select: { candidates: { where: { deleted_at: null } } } },
    },
    orderBy: { created_at: 'desc' },
  });
  return requisitions;
}

export async function createRequisition(params: {
  title: string;
  departmentId: string;
  positionId: string;
  headcount: number;
  employmentType: EmploymentType;
  closingDate?: Date | undefined;
  createdBy: string;
}): Promise<unknown> {
  // Validate position exists
  const position = await prisma.position.findFirst({
    where: { id: params.positionId, deleted_at: null },
  });
  if (!position) {
    throw new HttpError(400, 'Position does not exist');
  }
  if (params.headcount <= 0) {
    throw new HttpError(400, 'Headcount must be greater than zero');
  }

  const requisition = await prisma.jobRequisition.create({
    data: {
      title: params.title,
      department_id: params.departmentId,
      position_id: params.positionId,
      headcount: params.headcount,
      employment_type: params.employmentType,
      closing_date: params.closingDate ?? null,
      created_by: params.createdBy,
      status: RequisitionStatus.DRAFT,
    },
  });
  return requisition;
}

export async function submitRequisition(id: string): Promise<unknown> {
  const req = await prisma.jobRequisition.findFirst({ where: { id, deleted_at: null } });
  if (!req) throw new HttpError(404, 'Requisition not found');
  assertTransition(
    'Requisition',
    REQUISITION_TRANSITIONS,
    req.status,
    RequisitionStatus.PENDING_APPROVAL,
  );

  return prisma.jobRequisition.update({
    where: { id },
    data: { status: RequisitionStatus.PENDING_APPROVAL },
  });
}

export async function approveRequisition(id: string): Promise<unknown> {
  const req = await prisma.jobRequisition.findFirst({ where: { id, deleted_at: null } });
  if (!req) throw new HttpError(404, 'Requisition not found');
  assertTransition('Requisition', REQUISITION_TRANSITIONS, req.status, RequisitionStatus.APPROVED);

  return prisma.jobRequisition.update({
    where: { id },
    data: { status: RequisitionStatus.APPROVED },
  });
}

export async function publishRequisition(id: string): Promise<unknown> {
  const req = await prisma.jobRequisition.findFirst({ where: { id, deleted_at: null } });
  if (!req) throw new HttpError(404, 'Requisition not found');
  assertTransition('Requisition', REQUISITION_TRANSITIONS, req.status, RequisitionStatus.PUBLISHED);

  return withAuditContext(prisma, null, null, async (tx) => {
    const updated = await tx.jobRequisition.update({
      where: { id },
      data: { status: RequisitionStatus.PUBLISHED, published_at: new Date() },
    });
    // Auto-create internal job posting
    await tx.jobPosting.create({
      data: {
        requisition_id: id,
        posting_date: new Date(),
        closing_date: req.closing_date,
        status: RequisitionStatus.PUBLISHED,
      },
    });
    return updated;
  });
}

export async function closeRequisition(id: string): Promise<unknown> {
  const req = await prisma.jobRequisition.findFirst({ where: { id, deleted_at: null } });
  if (!req) throw new HttpError(404, 'Requisition not found');

  return prisma.jobRequisition.update({
    where: { id },
    data: { status: RequisitionStatus.CLOSED },
  });
}

// ── Candidates ─────────────────────────────────

export async function listCandidates(params: {
  requisitionId?: string | undefined;
  stage?: string | undefined;
  role?: string | undefined;
  userId?: string | undefined;
}): Promise<unknown[]> {
  const where: Record<string, unknown> = { deleted_at: null };
  if (params.requisitionId) where.requisition_id = params.requisitionId;
  if (params.stage) where.stage = params.stage;

  // Scope managers to candidates linked to their department's requisitions.
  if (params.role === 'MANAGER' && params.userId) {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.userId },
      select: { department_id: true },
    });
    if (self) {
      const deptRequisitions = await prisma.jobRequisition.findMany({
        where: { department_id: self.department_id },
        select: { id: true },
      });
      where.requisition_id = { in: deptRequisitions.map((r) => r.id) };
    } else {
      // No employee record — manager sees no candidates.
      where.requisition_id = { in: [] };
    }
  }

  const candidates = await prisma.candidate.findMany({
    where,
    include: {
      requisition: { select: { id: true, title: true } },
      interviews: { where: { deleted_at: null }, orderBy: { scheduled_at: 'asc' } },
      offer_letters: { where: { deleted_at: null }, orderBy: { created_at: 'desc' } },
    },
    orderBy: { applied_at: 'desc' },
  });
  return candidates;
}

export async function createCandidate(params: {
  name: string;
  email: string;
  phone?: string | undefined;
  resumePath?: string | undefined;
  source: CandidateSource;
  requisitionId: string;
  consentRecorded: boolean;
  actorId: string;
  actorName: string;
  role?: string | undefined;
}): Promise<unknown> {
  const requisition = await prisma.jobRequisition.findFirst({
    where: { id: params.requisitionId, deleted_at: null },
  });
  if (!requisition) throw new HttpError(404, 'Requisition not found');

  // Managers may only create candidates against a requisition in their own
  // department.
  if (params.role === 'MANAGER') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.actorId },
      select: { department_id: true },
    });
    if (!self || self.department_id !== requisition.department_id) {
      throw new HttpError(403, 'Insufficient permissions');
    }
  }

  const email = params.email.toLowerCase();

  // Duplicate detection: same email for same requisition
  const duplicate = await prisma.candidate.findFirst({
    where: { email, requisition_id: params.requisitionId, deleted_at: null },
  });

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    const candidate = await tx.candidate.create({
      data: {
        name: params.name,
        email,
        phone: params.phone ?? null,
        resume_path: params.resumePath ?? null,
        source: params.source,
        requisition_id: params.requisitionId,
        consent_recorded: params.consentRecorded,
        stage: CandidateStage.APPLIED,
      },
    });

    // GDPR consent evidence: when the candidate has consented, persist a full
    // ConsentRecord with demonstrable evidence (consent text, mechanism,
    // recorded_at). The legacy `consent_recorded` Boolean is retained for
    // backward compatibility and display only.
    if (params.consentRecorded) {
      await tx.consentRecord.create({
        data: {
          data_subject_email: email,
          processing_purpose: 'candidate-recruitment',
          consent_text:
            'I consent to Peoplevate processing my personal data (including my resume and application details) for the purpose of recruitment and evaluation for employment.',
          notice_version: 'v1',
          mechanism: ConsentMechanism.CHECKBOX,
          status: ConsentStatus.GIVEN,
        },
      });
    }

    return { candidate, duplicateWarning: duplicate ? { duplicateId: duplicate.id } : null };
  });
}

export async function updateCandidateStage(params: {
  id: string;
  to: CandidateStage;
  actorId: string;
  actorName: string;
  role?: string | undefined;
}): Promise<unknown> {
  const candidate = await prisma.candidate.findFirst({
    where: { id: params.id, deleted_at: null },
  });
  if (!candidate) throw new HttpError(404, 'Candidate not found');

  // Managers may only update candidates linked to requisitions in their own
  // department, mirroring the scoping applied in listCandidates/createCandidate.
  if (params.role === 'MANAGER') {
    const self = await prisma.employee.findUnique({
      where: { user_id: params.actorId },
      select: { department_id: true },
    });
    const requisition = await prisma.jobRequisition.findUnique({
      where: { id: candidate.requisition_id },
      select: { department_id: true },
    });
    if (!self || !requisition || self.department_id !== requisition.department_id) {
      throw new HttpError(403, 'Insufficient permissions');
    }

    // Managers may manage candidates up to the Offer stage, but the Hired
    // stage is HR-only: they cannot move a candidate forward to HIRED and
    // cannot act on candidates that are already in the HIRED stage.
    if (candidate.stage === CandidateStage.HIRED) {
      throw new HttpError(403, 'Only HR can manage candidates in the Hired stage');
    }
    if (params.to === CandidateStage.HIRED) {
      throw new HttpError(403, 'Only HR can move a candidate to the Hired stage');
    }
  }

  // Once converted to an employee, the candidate record is locked — no stage changes.
  if (candidate.employee_id) {
    throw new HttpError(
      400,
      'Cannot change stage: candidate has already been converted to an employee',
    );
  }

  // Allow skipping stages (logged) and reverting (audit note)
  assertTransition('Candidate', CANDIDATE_TRANSITIONS, candidate.stage, params.to);

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    const updated = await tx.candidate.update({
      where: { id: params.id },
      data: { stage: params.to },
    });
    await tx.auditLog.create({
      data: {
        actor_id: params.actorId,
        actor_name: params.actorName,
        action: 'UPDATE',
        entity: 'CANDIDATES',
        entity_id: params.id,
        old_value: { stage: candidate.stage } as Prisma.InputJsonValue,
        new_value: { stage: params.to } as Prisma.InputJsonValue,
      },
    });
    return updated;
  });
}

// ── Interviews ─────────────────────────────────

export async function createInterview(params: {
  candidateId: string;
  scheduledAt: Date;
  durationMin: number;
  interviewerIds: string[];
  location?: string | undefined;
  notes?: string | undefined;
  actorId: string;
  actorName: string;
}): Promise<{ interview: unknown; conflictWarning: boolean; pastWarning: boolean }> {
  const candidate = await prisma.candidate.findFirst({
    where: { id: params.candidateId, deleted_at: null },
  });
  if (!candidate) throw new HttpError(404, 'Candidate not found');

  const conflictWarning = await hasInterviewerConflict(params.interviewerIds, params.scheduledAt);
  const pastWarning = params.scheduledAt.getTime() < Date.now();

  const interview = await withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.interview.create({
      data: {
        candidate_id: params.candidateId,
        scheduled_at: params.scheduledAt,
        duration_min: params.durationMin,
        interviewer_ids: params.interviewerIds,
        location: params.location ?? null,
        notes: params.notes ?? null,
      },
    }),
  );
  return { interview, conflictWarning, pastWarning };
}

async function hasInterviewerConflict(
  interviewerIds: string[],
  scheduledAt: Date,
): Promise<boolean> {
  const dayStart = new Date(scheduledAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(scheduledAt);
  dayEnd.setHours(23, 59, 59, 999);

  const interviews = await prisma.interview.findMany({
    where: {
      deleted_at: null,
      scheduled_at: { gte: dayStart, lte: dayEnd },
    },
    select: { interviewer_ids: true, scheduled_at: true, duration_min: true },
  });

  return interviews.some(
    (iv) =>
      iv.interviewer_ids.some((id) => interviewerIds.includes(id)) &&
      Math.abs(iv.scheduled_at.getTime() - scheduledAt.getTime()) <
        iv.duration_min * 60 * 1000 + 60 * 1000,
  );
}

export async function listCandidateInterviews(candidateId: string): Promise<unknown[]> {
  return prisma.interview.findMany({
    where: { candidate_id: candidateId, deleted_at: null },
    include: {
      candidate: {
        include: { requisition: { select: { title: true } } },
      },
    },
    orderBy: { scheduled_at: 'asc' },
  });
}

export async function deleteInterview(params: {
  candidateId: string;
  interviewId: string;
  actorId: string;
  actorName: string;
}): Promise<unknown> {
  const candidate = await prisma.candidate.findFirst({
    where: { id: params.candidateId, deleted_at: null },
  });
  if (!candidate) throw new HttpError(404, 'Candidate not found');

  const interview = await prisma.interview.findFirst({
    where: { id: params.interviewId, candidate_id: params.candidateId, deleted_at: null },
  });
  if (!interview) throw new HttpError(404, 'Interview not found');

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.interview.update({
      where: { id: params.interviewId },
      data: { deleted_at: new Date() },
    }),
  );
}

const INTERVIEW_TRANSITIONS: Record<string, string[]> = {
  [InterviewStatus.SCHEDULED]: [InterviewStatus.COMPLETED, InterviewStatus.CANCELLED],
  [InterviewStatus.COMPLETED]: [],
  [InterviewStatus.CANCELLED]: [],
};

export async function updateInterviewStatus(params: {
  interviewId: string;
  candidateId: string;
  to: InterviewStatus;
  actorId: string;
  actorName: string;
}): Promise<unknown> {
  const interview = await prisma.interview.findFirst({
    where: { id: params.interviewId, candidate_id: params.candidateId, deleted_at: null },
  });
  if (!interview) throw new HttpError(404, 'Interview not found');

  assertTransition('Interview', INTERVIEW_TRANSITIONS, interview.status, params.to);

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.interview.update({
      where: { id: params.interviewId },
      data: { status: params.to },
    }),
  );
}

// ── Offer Letters ──────────────────────────────

export async function createOffer(params: {
  candidateId: string;
  position: string;
  salary: number;
  startDate: Date;
  terms?: string | undefined;
  createdBy: string;
  actorId: string;
  actorName: string;
}): Promise<unknown> {
  const candidate = await prisma.candidate.findFirst({
    where: { id: params.candidateId, deleted_at: null },
  });
  if (!candidate) throw new HttpError(404, 'Candidate not found');

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) =>
    tx.offerLetter.create({
      data: {
        candidate_id: params.candidateId,
        position: params.position,
        salary: params.salary,
        start_date: params.startDate,
        terms: params.terms ?? null,
        created_by: params.createdBy,
        status: OfferStatus.DRAFT,
      },
    }),
  );
}

export async function listOffers(params: {
  role: string;
  userId: string;
  departmentId?: string | undefined;
}): Promise<unknown[]> {
  const where: Record<string, unknown> = { deleted_at: null };

  if (params.departmentId) {
    const deptRequisitions = await prisma.jobRequisition.findMany({
      where: { department_id: params.departmentId },
      select: { id: true },
    });
    where.candidate = {
      requisition_id: { in: deptRequisitions.map((r) => r.id) },
    };
  }

  return prisma.offerLetter.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: { candidate: true },
  });
}

export async function sendOffer(
  offerId: string,
  actorId: string,
  actorName: string,
): Promise<unknown> {
  const offer = await prisma.offerLetter.findFirst({ where: { id: offerId, deleted_at: null } });
  if (!offer) throw new HttpError(404, 'Offer not found');

  const updated = await withAuditContext(prisma, actorId, actorName, async (tx) =>
    tx.offerLetter.update({
      where: { id: offerId },
      data: { status: OfferStatus.SENT, sent_at: new Date() },
    }),
  );

  // Send via email
  const candidate = await prisma.candidate.findFirst({ where: { id: offer.candidate_id } });
  if (candidate) {
    await sendOfferLetterEmail(candidate.email, candidate.name, offer.position);
  }
  return updated;
}

export async function acceptOffer(offerId: string): Promise<unknown> {
  const offer = await prisma.offerLetter.findFirst({ where: { id: offerId, deleted_at: null } });
  if (!offer) throw new HttpError(404, 'Offer not found');

  return prisma.offerLetter.update({
    where: { id: offerId },
    data: { status: OfferStatus.ACCEPTED, accepted_at: new Date() },
  });
}

export async function deleteOffer(
  offerId: string,
  actorId: string,
  actorName: string,
): Promise<unknown> {
  const offer = await prisma.offerLetter.findFirst({ where: { id: offerId, deleted_at: null } });
  if (!offer) throw new HttpError(404, 'Offer not found');

  return withAuditContext(prisma, actorId, actorName, async (tx) =>
    tx.offerLetter.update({
      where: { id: offerId },
      data: { deleted_at: new Date() },
    }),
  );
}

// ── Candidate → Employee conversion ────────────

export async function convertCandidateToEmployee(params: {
  candidateId: string;
  departmentId: string;
  positionId: string;
  hireDate: Date;
  managerId?: string | undefined;
  actorId: string;
  actorName: string;
}): Promise<unknown> {
  const candidate = await prisma.candidate.findFirst({
    where: { id: params.candidateId, deleted_at: null },
    include: { requisition: true },
  });
  if (!candidate) throw new HttpError(404, 'Candidate not found');
  if (candidate.stage !== CandidateStage.OFFER && candidate.stage !== CandidateStage.HIRED) {
    throw new HttpError(400, 'Candidate must be in Offer or Hired stage to convert');
  }

  // Check duplicate employee by email
  const existingEmployee = await prisma.employee.findFirst({
    where: { email: candidate.email.toLowerCase(), deleted_at: null },
  });
  if (existingEmployee) {
    throw new HttpError(409, 'An employee with this email already exists. Please merge instead.');
  }

  const offer = await prisma.offerLetter.findFirst({
    where: { candidate_id: candidate.id, status: OfferStatus.ACCEPTED, deleted_at: null },
  });

  return withAuditContext(prisma, params.actorId, params.actorName, async (tx) => {
    // Create employee (transactional)
    const employee = await createEmployee({
      firstName: candidate.name.split(' ')[0] || candidate.name,
      lastName: candidate.name.split(' ').slice(1).join(' ') || candidate.name,
      email: candidate.email,
      departmentId: params.departmentId,
      positionId: params.positionId,
      managerId: params.managerId,
      hireDate: params.hireDate,
      employmentType: candidate.requisition.employment_type,
      salary: offer?.salary,
      status: EmploymentStatus.NEW_HIRE,
    });

    // Link candidate -> employee
    await tx.candidate.update({
      where: { id: candidate.id },
      data: { employee_id: employee.id, stage: CandidateStage.HIRED },
    });

    // Auto-create onboarding checklist with default tasks
    const defaultTasks: { type: OnboardingTaskType; description: string }[] = [
      {
        type: OnboardingTaskType.DOCUMENT_SUBMISSION,
        description: 'Submit identification and banking documents',
      },
      { type: OnboardingTaskType.EQUIPMENT_ASSIGNMENT, description: 'Assign laptop and workspace' },
      {
        type: OnboardingTaskType.ORIENTATION_SESSION,
        description: 'Complete new hire orientation',
      },
      { type: OnboardingTaskType.SYSTEM_ACCESS_SETUP, description: 'Provision system access' },
    ];
    for (const task of defaultTasks) {
      await tx.onboardingTask.create({
        data: {
          employee_id: employee.id,
          type: task.type,
          status: 'PENDING',
        },
      });
    }

    return { employeeId: employee.id, employeeNo: employee.employeeNo, onboardingCreated: true };
  });
}

// ── Onboarding tasks ───────────────────────────

export async function listOnboardingTasks(
  employeeId: string,
  actorId: string,
  role: string,
): Promise<unknown[]> {
  if (role === 'EMPLOYEE') {
    const self = await prisma.employee.findUnique({
      where: { user_id: actorId },
      select: { id: true },
    });
    if (self?.id !== employeeId) throw new HttpError(403, 'Access denied');
  }
  return prisma.onboardingTask.findMany({
    where: { employee_id: employeeId, deleted_at: null },
    include: { assignee: { select: { id: true, email: true } } },
    orderBy: { created_at: 'asc' },
  });
}

export async function updateOnboardingTask(params: {
  id: string;
  status?: string | undefined;
  assigneeId?: string | undefined;
  dueDate?: Date | undefined;
  actorId: string;
  role: string;
}): Promise<unknown> {
  const task = await prisma.onboardingTask.findFirst({
    where: { id: params.id, deleted_at: null },
  });
  if (!task) throw new HttpError(404, 'Onboarding task not found');

  const data: Record<string, unknown> = {};
  if (params.status) {
    data.status = params.status;
    if (params.status === 'COMPLETE') data.completed_at = new Date();
  }
  if (params.assigneeId !== undefined) data.assignee_id = params.assigneeId;
  if (params.dueDate !== undefined) data.due_date = params.dueDate;

  return prisma.onboardingTask.update({ where: { id: params.id }, data });
}
