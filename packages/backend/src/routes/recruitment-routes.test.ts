import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const authUser: {
  userId: string;
  email: string;
  role: string;
  employeeId: string | null;
} = { userId: 'u-1', email: 'jane@example.com', role: 'HR_MANAGER', employeeId: 'emp-1' };

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = authUser;
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

vi.mock('../middleware/rbac.js', () => ({
  requireHR: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  requireHRorManager: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../services/recruitment-service.js', () => ({
  listRequisitions: vi.fn(),
  createRequisition: vi.fn(),
  submitRequisition: vi.fn(),
  approveRequisition: vi.fn(),
  publishRequisition: vi.fn(),
  closeRequisition: vi.fn(),
  listCandidates: vi.fn(),
  createCandidate: vi.fn(),
  updateCandidateStage: vi.fn(),
  listCandidateInterviews: vi.fn(),
  createInterview: vi.fn(),
  deleteInterview: vi.fn(),
  updateInterviewStatus: vi.fn(),
  createOffer: vi.fn(),
  listOffers: vi.fn(),
  sendOffer: vi.fn(),
  acceptOffer: vi.fn(),
  deleteOffer: vi.fn(),
  convertCandidateToEmployee: vi.fn(),
  listOnboardingTasks: vi.fn(),
  updateOnboardingTask: vi.fn(),
}));

import * as recruitment from '../services/recruitment-service.js';
import { recruitmentRoutes } from './recruitment-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  listRequisitions: vi.mocked(recruitment.listRequisitions),
  createRequisition: vi.mocked(recruitment.createRequisition),
  submitRequisition: vi.mocked(recruitment.submitRequisition),
  approveRequisition: vi.mocked(recruitment.approveRequisition),
  publishRequisition: vi.mocked(recruitment.publishRequisition),
  closeRequisition: vi.mocked(recruitment.closeRequisition),
  listCandidates: vi.mocked(recruitment.listCandidates),
  createCandidate: vi.mocked(recruitment.createCandidate),
  updateCandidateStage: vi.mocked(recruitment.updateCandidateStage),
  listCandidateInterviews: vi.mocked(recruitment.listCandidateInterviews),
  createInterview: vi.mocked(recruitment.createInterview),
  deleteInterview: vi.mocked(recruitment.deleteInterview),
  updateInterviewStatus: vi.mocked(recruitment.updateInterviewStatus),
  createOffer: vi.mocked(recruitment.createOffer),
  listOffers: vi.mocked(recruitment.listOffers),
  sendOffer: vi.mocked(recruitment.sendOffer),
  acceptOffer: vi.mocked(recruitment.acceptOffer),
  deleteOffer: vi.mocked(recruitment.deleteOffer),
  convertCandidateToEmployee: vi.mocked(recruitment.convertCandidateToEmployee),
  listOnboardingTasks: vi.mocked(recruitment.listOnboardingTasks),
  updateOnboardingTask: vi.mocked(recruitment.updateOnboardingTask),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/recruitment', recruitmentRoutes);
  app.use(errorHandler);
  return app;
}

describe('recruitment-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.role = 'HR_MANAGER';
    authUser.employeeId = 'emp-1';
    mocked.listRequisitions.mockResolvedValue([] as never);
    mocked.createRequisition.mockResolvedValue({ id: 'req-1' } as never);
    mocked.submitRequisition.mockResolvedValue({ id: 'req-1' } as never);
    mocked.approveRequisition.mockResolvedValue({ id: 'req-1' } as never);
    mocked.publishRequisition.mockResolvedValue({ id: 'req-1' } as never);
    mocked.closeRequisition.mockResolvedValue({ id: 'req-1' } as never);
    mocked.listCandidates.mockResolvedValue([] as never);
    mocked.createCandidate.mockResolvedValue({ id: 'cand-1' } as never);
    mocked.updateCandidateStage.mockResolvedValue({ id: 'cand-1' } as never);
    mocked.listCandidateInterviews.mockResolvedValue([] as never);
    mocked.createInterview.mockResolvedValue({ id: 'int-1' } as never);
    mocked.deleteInterview.mockResolvedValue({ id: 'int-1' } as never);
    mocked.updateInterviewStatus.mockResolvedValue({ id: 'int-1' } as never);
    mocked.createOffer.mockResolvedValue({ id: 'off-1' } as never);
    mocked.listOffers.mockResolvedValue([] as never);
    mocked.sendOffer.mockResolvedValue({ id: 'off-1' } as never);
    mocked.acceptOffer.mockResolvedValue({ id: 'off-1' } as never);
    mocked.deleteOffer.mockResolvedValue({ id: 'off-1' } as never);
    mocked.convertCandidateToEmployee.mockResolvedValue({ id: 'emp-2' } as never);
    mocked.listOnboardingTasks.mockResolvedValue([] as never);
    mocked.updateOnboardingTask.mockResolvedValue({ id: 'task-1' } as never);
  });

  describe('GET /api/recruitment/requisitions', () => {
    it('lists requisitions scoped by role', async () => {
      mocked.listRequisitions.mockResolvedValue([{ id: 'req-1' }] as never);

      const res = await request(buildApp()).get('/api/recruitment/requisitions?status=DRAFT');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ requisitions: [{ id: 'req-1' }] });
      expect(mocked.listRequisitions).toHaveBeenCalledWith({
        role: 'HR_MANAGER',
        userId: 'u-1',
        status: 'DRAFT',
      });
    });

    it('passes undefined status when the query param is absent', async () => {
      await request(buildApp()).get('/api/recruitment/requisitions');

      expect(mocked.listRequisitions).toHaveBeenCalledWith({
        role: 'HR_MANAGER',
        userId: 'u-1',
        status: undefined,
      });
    });
  });

  describe('POST /api/recruitment/requisitions', () => {
    it('creates a requisition', async () => {
      const res = await request(buildApp()).post('/api/recruitment/requisitions').send({
        title: 'Backend Engineer',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        headcount: 2,
        employmentType: 'FULL_TIME',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'req-1' });
      const arg = mocked.createRequisition.mock.calls[0]?.[0] as {
        title: string;
        headcount: number;
        createdBy: string;
      };
      expect(arg.title).toBe('Backend Engineer');
      expect(arg.headcount).toBe(2);
      expect(arg.createdBy).toBe('u-1');
    });

    it('returns 400 when headcount is below one', async () => {
      const res = await request(buildApp()).post('/api/recruitment/requisitions').send({
        title: 'Backend Engineer',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        headcount: 0,
        employmentType: 'FULL_TIME',
      });

      expect(res.status).toBe(400);
      expect(mocked.createRequisition).not.toHaveBeenCalled();
    });

    it('returns 400 on an invalid employment type', async () => {
      const res = await request(buildApp()).post('/api/recruitment/requisitions').send({
        title: 'Backend Engineer',
        departmentId: 'dep-1',
        positionId: 'pos-1',
        headcount: 1,
        employmentType: 'NOT_A_TYPE',
      });

      expect(res.status).toBe(400);
      expect(mocked.createRequisition).not.toHaveBeenCalled();
    });
  });

  describe('requisition state transitions', () => {
    it('submits a requisition', async () => {
      const res = await request(buildApp()).post('/api/recruitment/requisitions/req-1/submit');

      expect(res.status).toBe(200);
      expect(mocked.submitRequisition).toHaveBeenCalledWith('req-1');
    });

    it('approves a requisition', async () => {
      const res = await request(buildApp()).post('/api/recruitment/requisitions/req-1/approve');

      expect(res.status).toBe(200);
      expect(mocked.approveRequisition).toHaveBeenCalledWith('req-1');
    });

    it('publishes a requisition', async () => {
      const res = await request(buildApp()).post('/api/recruitment/requisitions/req-1/publish');

      expect(res.status).toBe(200);
      expect(mocked.publishRequisition).toHaveBeenCalledWith('req-1');
    });

    it('closes a requisition', async () => {
      const res = await request(buildApp()).post('/api/recruitment/requisitions/req-1/close');

      expect(res.status).toBe(200);
      expect(mocked.closeRequisition).toHaveBeenCalledWith('req-1');
    });

    it('forwards invalid transition errors', async () => {
      mocked.submitRequisition.mockRejectedValue(
        Object.assign(new Error('Invalid transition'), { status: 400 }),
      );

      const res = await request(buildApp()).post('/api/recruitment/requisitions/req-1/submit');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid transition');
    });
  });

  describe('GET /api/recruitment/candidates', () => {
    it('lists candidates with filters', async () => {
      mocked.listCandidates.mockResolvedValue([{ id: 'cand-1' }] as never);

      const res = await request(buildApp()).get(
        '/api/recruitment/candidates?requisitionId=req-1&stage=SCREENING',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ candidates: [{ id: 'cand-1' }] });
      expect(mocked.listCandidates).toHaveBeenCalledWith({
        requisitionId: 'req-1',
        stage: 'SCREENING',
        role: 'HR_MANAGER',
        userId: 'u-1',
      });
    });
  });

  describe('POST /api/recruitment/candidates', () => {
    it('creates a candidate with defaults applied', async () => {
      const res = await request(buildApp()).post('/api/recruitment/candidates').send({
        name: 'John Smith',
        email: 'john@example.com',
        requisitionId: 'req-1',
      });

      expect(res.status).toBe(201);
      expect(mocked.createCandidate).toHaveBeenCalledWith({
        name: 'John Smith',
        email: 'john@example.com',
        requisitionId: 'req-1',
        source: 'DIRECT',
        consentRecorded: false,
        actorId: 'u-1',
        actorName: 'jane@example.com',
        role: 'HR_MANAGER',
      });
    });

    it('returns 400 on an invalid email', async () => {
      const res = await request(buildApp()).post('/api/recruitment/candidates').send({
        name: 'John Smith',
        email: 'not-an-email',
        requisitionId: 'req-1',
      });

      expect(res.status).toBe(400);
      expect(mocked.createCandidate).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.createCandidate.mockRejectedValue(
        Object.assign(new Error('Requisition is not published'), { status: 400 }),
      );

      const res = await request(buildApp()).post('/api/recruitment/candidates').send({
        name: 'John Smith',
        email: 'john@example.com',
        requisitionId: 'req-1',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Requisition is not published');
    });
  });

  describe('PATCH /api/recruitment/candidates/:id/stage', () => {
    it('updates the candidate stage', async () => {
      const res = await request(buildApp())
        .patch('/api/recruitment/candidates/cand-1/stage')
        .send({ stage: 'INTERVIEW' });

      expect(res.status).toBe(200);
      expect(mocked.updateCandidateStage).toHaveBeenCalledWith({
        id: 'cand-1',
        to: 'INTERVIEW',
        actorId: 'u-1',
        actorName: 'jane@example.com',
        role: 'HR_MANAGER',
      });
    });

    it('returns 400 on an unknown stage', async () => {
      const res = await request(buildApp())
        .patch('/api/recruitment/candidates/cand-1/stage')
        .send({ stage: 'UNKNOWN' });

      expect(res.status).toBe(400);
      expect(mocked.updateCandidateStage).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/recruitment/candidates/:id/interviews', () => {
    it('lists candidate interviews', async () => {
      mocked.listCandidateInterviews.mockResolvedValue([{ id: 'int-1' }] as never);

      const res = await request(buildApp()).get('/api/recruitment/candidates/cand-1/interviews');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ interviews: [{ id: 'int-1' }] });
      expect(mocked.listCandidateInterviews).toHaveBeenCalledWith('cand-1');
    });
  });

  describe('POST /api/recruitment/candidates/:id/interviews', () => {
    it('schedules an interview with defaults applied', async () => {
      const res = await request(buildApp())
        .post('/api/recruitment/candidates/cand-1/interviews')
        .send({ scheduledAt: '2026-09-01T10:00:00.000Z' });

      expect(res.status).toBe(201);
      const arg = mocked.createInterview.mock.calls[0]?.[0] as {
        candidateId: string;
        durationMin: number;
        interviewerIds: string[];
        actorId: string;
      };
      expect(arg.candidateId).toBe('cand-1');
      expect(arg.durationMin).toBe(30);
      expect(arg.interviewerIds).toEqual([]);
      expect(arg.actorId).toBe('u-1');
    });

    it('returns 400 when scheduledAt is missing', async () => {
      const res = await request(buildApp())
        .post('/api/recruitment/candidates/cand-1/interviews')
        .send({ durationMin: 45 });

      expect(res.status).toBe(400);
      expect(mocked.createInterview).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/recruitment/candidates/:id/interviews/:interviewId', () => {
    it('deletes an interview', async () => {
      const res = await request(buildApp()).delete(
        '/api/recruitment/candidates/cand-1/interviews/int-1',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ interview: { id: 'int-1' } });
      expect(mocked.deleteInterview).toHaveBeenCalledWith({
        candidateId: 'cand-1',
        interviewId: 'int-1',
        actorId: 'u-1',
        actorName: 'jane@example.com',
      });
    });

    it('forwards service errors', async () => {
      mocked.deleteInterview.mockRejectedValue(
        Object.assign(new Error('Interview not found'), { status: 404 }),
      );

      const res = await request(buildApp()).delete(
        '/api/recruitment/candidates/cand-1/interviews/int-1',
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Interview not found');
    });
  });

  describe('PATCH /api/recruitment/candidates/:id/interviews/:interviewId/status', () => {
    it('updates the interview status', async () => {
      const res = await request(buildApp())
        .patch('/api/recruitment/candidates/cand-1/interviews/int-1/status')
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ interview: { id: 'int-1' } });
      expect(mocked.updateInterviewStatus).toHaveBeenCalledWith({
        candidateId: 'cand-1',
        interviewId: 'int-1',
        to: 'COMPLETED',
        actorId: 'u-1',
        actorName: 'jane@example.com',
      });
    });

    it('returns 400 on an unknown status', async () => {
      const res = await request(buildApp())
        .patch('/api/recruitment/candidates/cand-1/interviews/int-1/status')
        .send({ status: 'UNKNOWN' });

      expect(res.status).toBe(400);
      expect(mocked.updateInterviewStatus).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/recruitment/candidates/:id/offers', () => {
    it('creates an offer', async () => {
      const res = await request(buildApp())
        .post('/api/recruitment/candidates/cand-1/offers')
        .send({ position: 'Backend Engineer', salary: 90000, startDate: '2026-10-01' });

      expect(res.status).toBe(201);
      const arg = mocked.createOffer.mock.calls[0]?.[0] as {
        candidateId: string;
        salary: number;
        createdBy: string;
      };
      expect(arg.candidateId).toBe('cand-1');
      expect(arg.salary).toBe(90000);
      expect(arg.createdBy).toBe('u-1');
    });

    it('returns 400 on a negative salary', async () => {
      const res = await request(buildApp())
        .post('/api/recruitment/candidates/cand-1/offers')
        .send({ position: 'Backend Engineer', salary: -1, startDate: '2026-10-01' });

      expect(res.status).toBe(400);
      expect(mocked.createOffer).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/recruitment/offers', () => {
    it('lists offers with an optional department filter', async () => {
      mocked.listOffers.mockResolvedValue([{ id: 'off-1' }] as never);

      const res = await request(buildApp()).get('/api/recruitment/offers?departmentId=dep-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ offers: [{ id: 'off-1' }] });
      expect(mocked.listOffers).toHaveBeenCalledWith({
        role: 'HR_MANAGER',
        userId: 'u-1',
        departmentId: 'dep-1',
      });
    });
  });

  describe('offer actions', () => {
    it('sends an offer', async () => {
      const res = await request(buildApp()).post('/api/recruitment/offers/off-1/send');

      expect(res.status).toBe(200);
      expect(mocked.sendOffer).toHaveBeenCalledWith('off-1', 'u-1', 'jane@example.com');
    });

    it('accepts an offer', async () => {
      const res = await request(buildApp()).post('/api/recruitment/offers/off-1/accept');

      expect(res.status).toBe(200);
      expect(mocked.acceptOffer).toHaveBeenCalledWith('off-1');
    });

    it('deletes an offer', async () => {
      const res = await request(buildApp()).delete('/api/recruitment/offers/off-1');

      expect(res.status).toBe(200);
      expect(mocked.deleteOffer).toHaveBeenCalledWith('off-1', 'u-1', 'jane@example.com');
    });

    it('forwards service errors', async () => {
      mocked.acceptOffer.mockRejectedValue(
        Object.assign(new Error('Offer has not been sent'), { status: 400 }),
      );

      const res = await request(buildApp()).post('/api/recruitment/offers/off-1/accept');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Offer has not been sent');
    });
  });

  describe('POST /api/recruitment/candidates/:id/convert', () => {
    it('converts a candidate to an employee', async () => {
      const res = await request(buildApp())
        .post('/api/recruitment/candidates/cand-1/convert')
        .send({ departmentId: 'dep-1', positionId: 'pos-1', hireDate: '2026-10-01' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'emp-2' });
      const arg = mocked.convertCandidateToEmployee.mock.calls[0]?.[0] as {
        candidateId: string;
        departmentId: string;
        actorId: string;
      };
      expect(arg.candidateId).toBe('cand-1');
      expect(arg.departmentId).toBe('dep-1');
      expect(arg.actorId).toBe('u-1');
    });

    it('returns 400 when the hire date is missing', async () => {
      const res = await request(buildApp())
        .post('/api/recruitment/candidates/cand-1/convert')
        .send({ departmentId: 'dep-1', positionId: 'pos-1' });

      expect(res.status).toBe(400);
      expect(mocked.convertCandidateToEmployee).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.convertCandidateToEmployee.mockRejectedValue(
        Object.assign(new Error('Candidate must have an accepted offer'), { status: 400 }),
      );

      const res = await request(buildApp())
        .post('/api/recruitment/candidates/cand-1/convert')
        .send({ departmentId: 'dep-1', positionId: 'pos-1', hireDate: '2026-10-01' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Candidate must have an accepted offer');
    });
  });

  describe('GET /api/recruitment/employees/:id/onboarding', () => {
    it('lists onboarding tasks', async () => {
      mocked.listOnboardingTasks.mockResolvedValue([{ id: 'task-1' }] as never);

      const res = await request(buildApp()).get('/api/recruitment/employees/emp-2/onboarding');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tasks: [{ id: 'task-1' }] });
      expect(mocked.listOnboardingTasks).toHaveBeenCalledWith('emp-2', 'u-1', 'HR_MANAGER');
    });

    it('forwards permission errors', async () => {
      mocked.listOnboardingTasks.mockRejectedValue(
        Object.assign(new Error('Access denied'), { status: 403 }),
      );

      const res = await request(buildApp()).get('/api/recruitment/employees/emp-2/onboarding');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });
  });

  describe('PATCH /api/recruitment/onboarding-tasks/:id', () => {
    it('updates an onboarding task', async () => {
      const res = await request(buildApp())
        .patch('/api/recruitment/onboarding-tasks/task-1')
        .send({ status: 'COMPLETE' });

      expect(res.status).toBe(200);
      expect(mocked.updateOnboardingTask).toHaveBeenCalledWith({
        id: 'task-1',
        status: 'COMPLETE',
        actorId: 'u-1',
        role: 'HR_MANAGER',
      });
    });

    it('returns 400 on an unknown status', async () => {
      const res = await request(buildApp())
        .patch('/api/recruitment/onboarding-tasks/task-1')
        .send({ status: 'UNKNOWN' });

      expect(res.status).toBe(400);
      expect(mocked.updateOnboardingTask).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.updateOnboardingTask.mockRejectedValue(
        Object.assign(new Error('Onboarding task not found'), { status: 404 }),
      );

      const res = await request(buildApp())
        .patch('/api/recruitment/onboarding-tasks/task-1')
        .send({ status: 'PENDING' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Onboarding task not found');
    });
  });
});
