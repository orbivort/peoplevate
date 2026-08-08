import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RequisitionStatus,
  CandidateStage,
  OfferStatus,
  CandidateSource,
  OnboardingTaskType,
  EmploymentStatus,
  EmploymentType,
  InterviewStatus,
} from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    jobRequisition: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    position: { findFirst: vi.fn() },
    candidate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    interview: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    offerLetter: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    employee: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    jobPosting: { create: vi.fn() },
    consentRecord: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    onboardingTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../utils/audit-context.js', () => ({
  withAuditContext: vi.fn(
    (_prisma: unknown, _actorId: string, _actorName: string, cb: (tx: unknown) => unknown) =>
      cb(prisma),
  ),
}));

vi.mock('../utils/state-machine.js', () => ({
  assertTransition: vi.fn(),
}));

vi.mock('./employee-service.js', () => ({
  createEmployee: vi.fn(),
}));

vi.mock('./email-service.js', () => ({
  sendOfferLetterEmail: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import { withAuditContext } from '../utils/audit-context.js';
import { assertTransition } from '../utils/state-machine.js';
import { createEmployee } from './employee-service.js';
import { sendOfferLetterEmail } from './email-service.js';
import {
  acceptOffer,
  approveRequisition,
  closeRequisition,
  convertCandidateToEmployee,
  createCandidate,
  createInterview,
  createOffer,
  createRequisition,
  deleteInterview,
  deleteOffer,
  listCandidateInterviews,
  listCandidates,
  listOffers,
  listOnboardingTasks,
  listRequisitions,
  publishRequisition,
  sendOffer,
  submitRequisition,
  updateCandidateStage,
  updateInterviewStatus,
  updateOnboardingTask,
} from './recruitment-service.js';

const mocked = {
  requisitionFindMany: vi.mocked(prisma.jobRequisition.findMany),
  requisitionFindFirst: vi.mocked(prisma.jobRequisition.findFirst),
  requisitionCreate: vi.mocked(prisma.jobRequisition.create),
  requisitionUpdate: vi.mocked(prisma.jobRequisition.update),
  positionFindFirst: vi.mocked(prisma.position.findFirst),
  candidateFindMany: vi.mocked(prisma.candidate.findMany),
  candidateFindFirst: vi.mocked(prisma.candidate.findFirst),
  candidateCreate: vi.mocked(prisma.candidate.create),
  candidateUpdate: vi.mocked(prisma.candidate.update),
  consentRecordCreate: vi.mocked(prisma.consentRecord.create),
  interviewFindMany: vi.mocked(prisma.interview.findMany),
  interviewFindFirst: vi.mocked(prisma.interview.findFirst),
  interviewCreate: vi.mocked(prisma.interview.create),
  interviewUpdate: vi.mocked(prisma.interview.update),
  offerFindMany: vi.mocked(prisma.offerLetter.findMany),
  offerFindFirst: vi.mocked(prisma.offerLetter.findFirst),
  offerCreate: vi.mocked(prisma.offerLetter.create),
  offerUpdate: vi.mocked(prisma.offerLetter.update),
  employeeFindUnique: vi.mocked(prisma.employee.findUnique),
  employeeFindFirst: vi.mocked(prisma.employee.findFirst),
  onboardingTaskFindMany: vi.mocked(prisma.onboardingTask.findMany),
  onboardingTaskFindFirst: vi.mocked(prisma.onboardingTask.findFirst),
  onboardingTaskUpdate: vi.mocked(prisma.onboardingTask.update),
  withAuditContext: vi.mocked(withAuditContext),
  assertTransition: vi.mocked(assertTransition),
  createEmployee: vi.mocked(createEmployee),
  sendOfferLetterEmail: vi.mocked(sendOfferLetterEmail),
};

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  message?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect((err as { status: number }).status).toBe(status);
    if (message) {
      expect((err as Error).message).toContain(message);
    }
    return;
  }
  throw new Error(`Expected HTTP error ${status} but promise resolved`);
}

describe('recruitment-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listRequisitions', () => {
    it('returns all requisitions for HR/ADMIN roles', async () => {
      mocked.requisitionFindMany.mockResolvedValue([{ id: 'r1' }] as never);

      await listRequisitions({ role: 'ADMIN', userId: 'u-1' });

      expect(mocked.requisitionFindMany).toHaveBeenCalledWith({
        where: { deleted_at: null },
        include: expect.any(Object),
        orderBy: { created_at: 'desc' },
      });
    });

    it('scopes to the manager department for MANAGER role', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ department_id: 'dep-1' } as never);
      mocked.requisitionFindMany.mockResolvedValue([] as never);

      await listRequisitions({ role: 'MANAGER', userId: 'u-1', status: RequisitionStatus.DRAFT });

      expect(mocked.employeeFindUnique).toHaveBeenCalledWith({
        where: { user_id: 'u-1' },
        select: { department_id: true },
      });
      const where = mocked.requisitionFindMany.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.department_id).toBe('dep-1');
      expect(where.status).toBe(RequisitionStatus.DRAFT);
    });

    it('returns empty for a manager without an employee record', async () => {
      mocked.employeeFindUnique.mockResolvedValue(null);

      const result = await listRequisitions({ role: 'MANAGER', userId: 'u-1' });

      expect(result).toEqual([]);
      expect(mocked.requisitionFindMany).not.toHaveBeenCalled();
    });
  });

  describe('createRequisition', () => {
    it('throws 400 when the position does not exist', async () => {
      mocked.positionFindFirst.mockResolvedValue(null);

      await expectHttpError(
        createRequisition({
          title: 'Engineer',
          departmentId: 'dep-1',
          positionId: 'pos-1',
          headcount: 1,
          employmentType: EmploymentType.FULL_TIME,
          createdBy: 'u-1',
        }),
        400,
        'Position does not exist',
      );
    });

    it('throws 400 when headcount is not positive', async () => {
      mocked.positionFindFirst.mockResolvedValue({ id: 'pos-1' } as never);

      await expectHttpError(
        createRequisition({
          title: 'Engineer',
          departmentId: 'dep-1',
          positionId: 'pos-1',
          headcount: 0,
          employmentType: EmploymentType.FULL_TIME,
          createdBy: 'u-1',
        }),
        400,
        'Headcount must be greater than zero',
      );
    });

    it('creates a DRAFT requisition', async () => {
      mocked.positionFindFirst.mockResolvedValue({ id: 'pos-1' } as never);
      mocked.requisitionCreate.mockResolvedValue({ id: 'r-new' } as never);

      await createRequisition({
        title: 'Engineer',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        headcount: 2,
        employmentType: EmploymentType.FULL_TIME,
        createdBy: 'u-1',
      });

      expect(mocked.requisitionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: RequisitionStatus.DRAFT,
          headcount: 2,
          created_by: 'u-1',
        }),
      });
    });
  });

  describe('submitRequisition', () => {
    it('throws 404 when missing', async () => {
      mocked.requisitionFindFirst.mockResolvedValue(null);

      await expectHttpError(submitRequisition('r-x'), 404, 'Requisition not found');
    });

    it('transitions DRAFT to PENDING_APPROVAL', async () => {
      mocked.requisitionFindFirst.mockResolvedValue({
        id: 'r1',
        status: RequisitionStatus.DRAFT,
      } as never);
      mocked.requisitionUpdate.mockResolvedValue({} as never);

      await submitRequisition('r1');

      expect(mocked.assertTransition).toHaveBeenCalledWith(
        'Requisition',
        expect.any(Object),
        RequisitionStatus.DRAFT,
        RequisitionStatus.PENDING_APPROVAL,
      );
      expect(mocked.requisitionUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: RequisitionStatus.PENDING_APPROVAL },
      });
    });
  });

  describe('approveRequisition', () => {
    it('throws 404 when missing', async () => {
      mocked.requisitionFindFirst.mockResolvedValue(null);

      await expectHttpError(approveRequisition('r-x'), 404, 'Requisition not found');
    });

    it('transitions to APPROVED', async () => {
      mocked.requisitionFindFirst.mockResolvedValue({
        id: 'r1',
        status: RequisitionStatus.PENDING_APPROVAL,
      } as never);
      mocked.requisitionUpdate.mockResolvedValue({} as never);

      await approveRequisition('r1');

      expect(mocked.requisitionUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: RequisitionStatus.APPROVED },
      });
    });
  });

  describe('publishRequisition', () => {
    it('creates a job posting when published', async () => {
      mocked.requisitionFindFirst.mockResolvedValue({
        id: 'r1',
        status: RequisitionStatus.APPROVED,
        closing_date: null,
      } as never);
      mocked.requisitionUpdate.mockResolvedValue({} as never);

      await publishRequisition('r1');

      expect(mocked.requisitionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: { status: RequisitionStatus.PUBLISHED, published_at: expect.any(Date) },
        }),
      );
      expect(mocked.withAuditContext).toHaveBeenCalled();
    });
  });

  describe('closeRequisition', () => {
    it('closes a requisition', async () => {
      mocked.requisitionFindFirst.mockResolvedValue({
        id: 'r1',
        status: RequisitionStatus.PUBLISHED,
      } as never);
      mocked.requisitionUpdate.mockResolvedValue({} as never);

      await closeRequisition('r1');

      expect(mocked.requisitionUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: RequisitionStatus.CLOSED },
      });
    });
  });

  describe('listCandidates', () => {
    it('returns candidates filtered by requisition id', async () => {
      mocked.candidateFindMany.mockResolvedValue([{ id: 'c1' }] as never);

      await listCandidates({ requisitionId: 'r1', stage: CandidateStage.APPLIED });

      const where = mocked.candidateFindMany.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.requisition_id).toBe('r1');
      expect(where.stage).toBe(CandidateStage.APPLIED);
    });
  });

  describe('createCandidate', () => {
    it('throws 404 when the requisition is missing', async () => {
      mocked.requisitionFindFirst.mockResolvedValue(null);

      await expectHttpError(
        createCandidate({
          name: 'John',
          email: 'john@example.com',
          source: CandidateSource.REFERRAL,
          requisitionId: 'r-x',
          consentRecorded: true,
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        404,
        'Requisition not found',
      );
    });

    it('throws 403 when a manager posts to another department', async () => {
      mocked.requisitionFindFirst.mockResolvedValue({ id: 'r1', department_id: 'dep-2' } as never);
      mocked.employeeFindUnique.mockResolvedValue({ department_id: 'dep-1' } as never);

      await expectHttpError(
        createCandidate({
          name: 'John',
          email: 'john@example.com',
          source: CandidateSource.REFERRAL,
          requisitionId: 'r1',
          consentRecorded: true,
          actorId: 'u-1',
          actorName: 'Jane',
          role: 'MANAGER',
        }),
        403,
        'Insufficient permissions',
      );
    });

    it('creates a candidate in APPLIED stage', async () => {
      mocked.requisitionFindFirst.mockResolvedValue({ id: 'r1', department_id: 'dep-1' } as never);
      mocked.employeeFindUnique.mockResolvedValue({ department_id: 'dep-1' } as never);
      mocked.candidateFindFirst.mockResolvedValue(null);
      mocked.candidateCreate.mockResolvedValue({ id: 'c-new' } as never);

      const result = (await createCandidate({
        name: 'John',
        email: 'John@Example.com',
        source: CandidateSource.REFERRAL,
        requisitionId: 'r1',
        consentRecorded: true,
        actorId: 'u-1',
        actorName: 'Jane',
        role: 'MANAGER',
      })) as { candidate: { id: string }; duplicateWarning: unknown };

      expect(result.candidate.id).toBe('c-new');
      expect(mocked.candidateCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'john@example.com',
          stage: CandidateStage.APPLIED,
          consent_recorded: true,
        }),
      });
    });

    it('writes a ConsentRecord when the candidate has consented', async () => {
      mocked.requisitionFindFirst.mockResolvedValue({ id: 'r1', department_id: 'dep-1' } as never);
      mocked.employeeFindUnique.mockResolvedValue({ department_id: 'dep-1' } as never);
      mocked.candidateFindFirst.mockResolvedValue(null);
      mocked.candidateCreate.mockResolvedValue({ id: 'c-new' } as never);
      mocked.consentRecordCreate.mockResolvedValue({ id: 'consent-1' } as never);

      await createCandidate({
        name: 'John',
        email: 'john@example.com',
        source: CandidateSource.REFERRAL,
        requisitionId: 'r1',
        consentRecorded: true,
        actorId: 'u-1',
        actorName: 'Jane',
        role: 'MANAGER',
      });

      expect(mocked.consentRecordCreate).toHaveBeenCalledTimes(1);
      const data = mocked.consentRecordCreate.mock.calls[0][0].data;
      expect(data.data_subject_email).toBe('john@example.com');
      expect(data.processing_purpose).toBe('candidate-recruitment');
      expect(data.status).toBe('GIVEN');
      expect(data.mechanism).toBe('CHECKBOX');
    });

    it('does not write a ConsentRecord when the candidate has not consented', async () => {
      mocked.requisitionFindFirst.mockResolvedValue({ id: 'r1', department_id: 'dep-1' } as never);
      mocked.employeeFindUnique.mockResolvedValue({ department_id: 'dep-1' } as never);
      mocked.candidateFindFirst.mockResolvedValue(null);
      mocked.candidateCreate.mockResolvedValue({ id: 'c-new' } as never);

      await createCandidate({
        name: 'John',
        email: 'john@example.com',
        source: CandidateSource.REFERRAL,
        requisitionId: 'r1',
        consentRecorded: false,
        actorId: 'u-1',
        actorName: 'Jane',
        role: 'MANAGER',
      });

      expect(mocked.consentRecordCreate).not.toHaveBeenCalled();
    });
  });

  describe('updateCandidateStage', () => {
    it('throws 404 when the candidate is missing', async () => {
      mocked.candidateFindFirst.mockResolvedValue(null);

      await expectHttpError(
        updateCandidateStage({
          id: 'c-x',
          to: CandidateStage.SCREENING,
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        404,
        'Candidate not found',
      );
    });

    it('throws 400 when the candidate is already converted', async () => {
      mocked.candidateFindFirst.mockResolvedValue({
        id: 'c1',
        employee_id: 'emp-1',
        requisition_id: 'r1',
        stage: CandidateStage.OFFER,
      } as never);

      await expectHttpError(
        updateCandidateStage({
          id: 'c1',
          to: CandidateStage.SCREENING,
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        400,
        'already been converted',
      );
    });

    it('applies the transition for a valid move', async () => {
      mocked.candidateFindFirst.mockResolvedValue({
        id: 'c1',
        employee_id: null,
        requisition_id: 'r1',
        stage: CandidateStage.APPLIED,
      } as never);
      mocked.candidateUpdate.mockResolvedValue({} as never);

      await updateCandidateStage({
        id: 'c1',
        to: CandidateStage.SCREENING,
        actorId: 'u-1',
        actorName: 'Jane',
      });

      expect(mocked.assertTransition).toHaveBeenCalledWith(
        'Candidate',
        expect.any(Object),
        CandidateStage.APPLIED,
        CandidateStage.SCREENING,
      );
      expect(mocked.candidateUpdate).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { stage: CandidateStage.SCREENING },
      });
    });
  });

  describe('createInterview', () => {
    it('throws 404 when the candidate is missing', async () => {
      mocked.candidateFindFirst.mockResolvedValue(null);

      await expectHttpError(
        createInterview({
          candidateId: 'c-x',
          scheduledAt: new Date(),
          durationMin: 60,
          interviewerIds: ['i1'],
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        404,
        'Candidate not found',
      );
    });

    it('creates an interview and returns warnings', async () => {
      mocked.candidateFindFirst.mockResolvedValue({ id: 'c1' } as never);
      mocked.interviewFindMany.mockResolvedValue([] as never);
      mocked.interviewCreate.mockResolvedValue({ id: 'iv1' } as never);

      const result = (await createInterview({
        candidateId: 'c1',
        scheduledAt: new Date(Date.now() + 86400000),
        durationMin: 60,
        interviewerIds: ['i1'],
        actorId: 'u-1',
        actorName: 'Jane',
      })) as { conflictWarning: boolean; pastWarning: boolean };

      expect(result.conflictWarning).toBe(false);
      expect(result.pastWarning).toBe(false);
      expect(mocked.interviewCreate).toHaveBeenCalled();
    });
  });

  describe('listCandidateInterviews', () => {
    it('lists interviews for the candidate', async () => {
      mocked.interviewFindMany.mockResolvedValue([] as never);

      await listCandidateInterviews('c1');

      expect(mocked.interviewFindMany).toHaveBeenCalledWith({
        where: { candidate_id: 'c1', deleted_at: null },
        include: expect.any(Object),
        orderBy: { scheduled_at: 'asc' },
      });
    });
  });

  describe('deleteInterview', () => {
    it('throws 404 when the interview is missing', async () => {
      mocked.candidateFindFirst.mockResolvedValue({ id: 'c1' } as never);
      mocked.interviewFindFirst.mockResolvedValue(null);

      await expectHttpError(
        deleteInterview({
          candidateId: 'c1',
          interviewId: 'iv-x',
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        404,
        'Interview not found',
      );
    });

    it('soft-deletes the interview', async () => {
      mocked.candidateFindFirst.mockResolvedValue({ id: 'c1' } as never);
      mocked.interviewFindFirst.mockResolvedValue({ id: 'iv1' } as never);
      mocked.interviewUpdate.mockResolvedValue({} as never);

      await deleteInterview({
        candidateId: 'c1',
        interviewId: 'iv1',
        actorId: 'u-1',
        actorName: 'Jane',
      });

      expect(mocked.interviewUpdate).toHaveBeenCalledWith({
        where: { id: 'iv1' },
        data: { deleted_at: expect.any(Date) },
      });
    });
  });

  describe('updateInterviewStatus', () => {
    it('throws 404 when the interview is missing', async () => {
      mocked.interviewFindFirst.mockResolvedValue(null);

      await expectHttpError(
        updateInterviewStatus({
          interviewId: 'iv-x',
          candidateId: 'c1',
          to: InterviewStatus.COMPLETED,
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        404,
        'Interview not found',
      );
    });

    it('applies the transition', async () => {
      mocked.interviewFindFirst.mockResolvedValue({
        id: 'iv1',
        status: InterviewStatus.SCHEDULED,
      } as never);
      mocked.interviewUpdate.mockResolvedValue({} as never);

      await updateInterviewStatus({
        interviewId: 'iv1',
        candidateId: 'c1',
        to: InterviewStatus.COMPLETED,
        actorId: 'u-1',
        actorName: 'Jane',
      });

      expect(mocked.assertTransition).toHaveBeenCalledWith(
        'Interview',
        expect.any(Object),
        InterviewStatus.SCHEDULED,
        InterviewStatus.COMPLETED,
      );
      expect(mocked.interviewUpdate).toHaveBeenCalledWith({
        where: { id: 'iv1' },
        data: { status: InterviewStatus.COMPLETED },
      });
    });
  });

  describe('createOffer', () => {
    it('throws 404 when the candidate is missing', async () => {
      mocked.candidateFindFirst.mockResolvedValue(null);

      await expectHttpError(
        createOffer({
          candidateId: 'c-x',
          position: 'Eng',
          salary: 1000,
          startDate: new Date(),
          createdBy: 'u-1',
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        404,
        'Candidate not found',
      );
    });

    it('creates a DRAFT offer', async () => {
      mocked.candidateFindFirst.mockResolvedValue({ id: 'c1' } as never);
      mocked.offerCreate.mockResolvedValue({ id: 'o1' } as never);

      await createOffer({
        candidateId: 'c1',
        position: 'Eng',
        salary: 1000,
        startDate: new Date(),
        createdBy: 'u-1',
        actorId: 'u-1',
        actorName: 'Jane',
      });

      expect(mocked.offerCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: OfferStatus.DRAFT,
          salary: 1000,
          created_by: 'u-1',
        }),
      });
    });
  });

  describe('listOffers', () => {
    it('lists offers filtered by department', async () => {
      mocked.requisitionFindMany.mockResolvedValue([{ id: 'r1' }] as never);
      mocked.offerFindMany.mockResolvedValue([] as never);

      await listOffers({ role: 'HR_MANAGER', userId: 'u-1', departmentId: 'dep-1' });

      expect(mocked.offerFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ deleted_at: null }),
        orderBy: { created_at: 'desc' },
        include: { candidate: true },
      });
    });
  });

  describe('sendOffer', () => {
    it('throws 404 when the offer is missing', async () => {
      mocked.offerFindFirst.mockResolvedValue(null);

      await expectHttpError(sendOffer('o-x', 'u-1', 'Jane'), 404, 'Offer not found');
    });

    it('marks the offer SENT and sends an email', async () => {
      mocked.offerFindFirst.mockResolvedValue({
        id: 'o1',
        candidate_id: 'c1',
        position: 'Eng',
      } as never);
      mocked.offerUpdate.mockResolvedValue({} as never);
      mocked.candidateFindFirst.mockResolvedValue({
        id: 'c1',
        email: 'cand@example.com',
        name: 'Cand',
      } as never);

      await sendOffer('o1', 'u-1', 'Jane');

      expect(mocked.offerUpdate).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { status: OfferStatus.SENT, sent_at: expect.any(Date) },
      });
      expect(mocked.sendOfferLetterEmail).toHaveBeenCalledWith('cand@example.com', 'Cand', 'Eng');
    });
  });

  describe('acceptOffer', () => {
    it('throws 404 when the offer is missing', async () => {
      mocked.offerFindFirst.mockResolvedValue(null);

      await expectHttpError(acceptOffer('o-x'), 404, 'Offer not found');
    });

    it('marks the offer ACCEPTED', async () => {
      mocked.offerFindFirst.mockResolvedValue({ id: 'o1' } as never);
      mocked.offerUpdate.mockResolvedValue({} as never);

      await acceptOffer('o1');

      expect(mocked.offerUpdate).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { status: OfferStatus.ACCEPTED, accepted_at: expect.any(Date) },
      });
    });
  });

  describe('deleteOffer', () => {
    it('throws 404 when the offer is missing', async () => {
      mocked.offerFindFirst.mockResolvedValue(null);

      await expectHttpError(deleteOffer('o-x', 'u-1', 'Jane'), 404, 'Offer not found');
    });

    it('soft-deletes the offer', async () => {
      mocked.offerFindFirst.mockResolvedValue({ id: 'o1' } as never);
      mocked.offerUpdate.mockResolvedValue({} as never);

      await deleteOffer('o1', 'u-1', 'Jane');

      expect(mocked.offerUpdate).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { deleted_at: expect.any(Date) },
      });
    });
  });

  describe('convertCandidateToEmployee', () => {
    it('throws 404 when the candidate is missing', async () => {
      mocked.candidateFindFirst.mockResolvedValue(null);

      await expectHttpError(
        convertCandidateToEmployee({
          candidateId: 'c-x',
          departmentId: 'dep-1',
          positionId: 'pos-1',
          hireDate: new Date(),
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        404,
        'Candidate not found',
      );
    });

    it('throws 400 when not in Offer/Hired stage', async () => {
      mocked.candidateFindFirst.mockResolvedValue({
        id: 'c1',
        stage: CandidateStage.SCREENING,
        email: 'c@example.com',
      } as never);

      await expectHttpError(
        convertCandidateToEmployee({
          candidateId: 'c1',
          departmentId: 'dep-1',
          positionId: 'pos-1',
          hireDate: new Date(),
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        400,
        'must be in Offer or Hired stage',
      );
    });

    it('throws 409 on duplicate employee email', async () => {
      mocked.candidateFindFirst.mockResolvedValue({
        id: 'c1',
        stage: CandidateStage.OFFER,
        email: 'c@example.com',
        requisition: { employment_type: EmploymentType.FULL_TIME },
      } as never);
      mocked.employeeFindFirst.mockResolvedValue({ id: 'emp-existing' } as never);

      await expectHttpError(
        convertCandidateToEmployee({
          candidateId: 'c1',
          departmentId: 'dep-1',
          positionId: 'pos-1',
          hireDate: new Date(),
          actorId: 'u-1',
          actorName: 'Jane',
        }),
        409,
        'already exists',
      );
    });

    it('converts a candidate to an employee and creates onboarding tasks', async () => {
      mocked.candidateFindFirst.mockResolvedValue({
        id: 'c1',
        stage: CandidateStage.OFFER,
        name: 'John Smith',
        email: 'john@example.com',
        requisition: { employment_type: EmploymentType.FULL_TIME },
      } as never);
      mocked.employeeFindFirst.mockResolvedValue(null);
      mocked.offerFindFirst.mockResolvedValue({ salary: 5000 } as never);
      mocked.candidateUpdate.mockResolvedValue({} as never);
      mocked.createEmployee.mockResolvedValue({ id: 'emp-1', employeeNo: 'EMP-1' });

      const result = (await convertCandidateToEmployee({
        candidateId: 'c1',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        hireDate: new Date(),
        actorId: 'u-1',
        actorName: 'Jane',
      })) as { employeeId: string; onboardingCreated: boolean };

      expect(result.employeeId).toBe('emp-1');
      expect(result.onboardingCreated).toBe(true);
      expect(mocked.createEmployee).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'John',
          lastName: 'Smith',
          email: 'john@example.com',
          departmentId: 'dep-1',
          employmentType: EmploymentType.FULL_TIME,
          status: EmploymentStatus.NEW_HIRE,
        }),
      );
    });
  });

  describe('listOnboardingTasks', () => {
    it('throws 403 when an employee accesses another employee tasks', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-self' } as never);

      await expectHttpError(
        listOnboardingTasks('emp-other', 'u-1', 'EMPLOYEE'),
        403,
        'Access denied',
      );
    });

    it('lists onboarding tasks for the employee', async () => {
      mocked.employeeFindUnique.mockResolvedValue({ id: 'emp-1' } as never);
      mocked.onboardingTaskFindMany.mockResolvedValue([] as never);

      await listOnboardingTasks('emp-1', 'u-1', 'EMPLOYEE');

      expect(mocked.onboardingTaskFindMany).toHaveBeenCalledWith({
        where: { employee_id: 'emp-1', deleted_at: null },
        include: { assignee: { select: { id: true, email: true } } },
        orderBy: { created_at: 'asc' },
      });
    });
  });

  describe('updateOnboardingTask', () => {
    it('throws 404 when the task is missing', async () => {
      mocked.onboardingTaskFindFirst.mockResolvedValue(null);

      await expectHttpError(
        updateOnboardingTask({ id: 't-x', status: 'COMPLETE', actorId: 'u-1', role: 'HR_MANAGER' }),
        404,
        'Onboarding task not found',
      );
    });

    it('updates the task status', async () => {
      mocked.onboardingTaskFindFirst.mockResolvedValue({ id: 't1' } as never);
      mocked.onboardingTaskUpdate.mockResolvedValue({} as never);

      await updateOnboardingTask({
        id: 't1',
        status: 'COMPLETE',
        actorId: 'u-1',
        role: 'HR_MANAGER',
      });

      expect(mocked.onboardingTaskUpdate).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: 'COMPLETE', completed_at: expect.any(Date) },
      });
    });
  });
});

// silence unused import warning for OnboardingTaskType usage in template
void OnboardingTaskType;
