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
}));

vi.mock('../services/performance-service.js', () => ({
  listEvaluationCycles: vi.fn(),
  listSoonToExpireProbationEmployees: vi.fn(),
  createEvaluationCycle: vi.fn(),
  openEvaluationCycle: vi.fn(),
  closeEvaluationCycle: vi.fn(),
  getMyReviews: vi.fn(),
  submitSelfEvaluation: vi.fn(),
  submitManagerEvaluation: vi.fn(),
  finalizeReview: vi.fn(),
  addRebuttal: vi.fn(),
}));

import * as performance from '../services/performance-service.js';
import { performanceRoutes } from './performance-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  listEvaluationCycles: vi.mocked(performance.listEvaluationCycles),
  listSoonToExpireProbationEmployees: vi.mocked(performance.listSoonToExpireProbationEmployees),
  createEvaluationCycle: vi.mocked(performance.createEvaluationCycle),
  openEvaluationCycle: vi.mocked(performance.openEvaluationCycle),
  closeEvaluationCycle: vi.mocked(performance.closeEvaluationCycle),
  getMyReviews: vi.mocked(performance.getMyReviews),
  submitSelfEvaluation: vi.mocked(performance.submitSelfEvaluation),
  submitManagerEvaluation: vi.mocked(performance.submitManagerEvaluation),
  finalizeReview: vi.mocked(performance.finalizeReview),
  addRebuttal: vi.mocked(performance.addRebuttal),
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/performance', performanceRoutes);
  app.use(errorHandler);
  return app;
}

const validCycleBody = {
  type: 'PROBATION',
  periodStart: '2026-01-01',
  periodEnd: '2026-03-31',
  selfEvalStart: '2026-01-02',
  selfEvalEnd: '2026-01-10',
  managerEvalStart: '2026-01-11',
  managerEvalEnd: '2026-01-20',
  hrReviewStart: '2026-01-21',
  hrReviewEnd: '2026-01-31',
};

describe('performance-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.role = 'HR_MANAGER';
    authUser.employeeId = 'emp-1';
    mocked.listEvaluationCycles.mockResolvedValue([] as never);
    mocked.listSoonToExpireProbationEmployees.mockResolvedValue([] as never);
    mocked.createEvaluationCycle.mockResolvedValue({ id: 'cyc-1' } as never);
    mocked.openEvaluationCycle.mockResolvedValue({ id: 'cyc-1' } as never);
    mocked.closeEvaluationCycle.mockResolvedValue({ id: 'cyc-1' } as never);
    mocked.getMyReviews.mockResolvedValue([] as never);
    mocked.submitSelfEvaluation.mockResolvedValue({ id: 'rev-1' } as never);
    mocked.submitManagerEvaluation.mockResolvedValue({ id: 'rev-1' } as never);
    mocked.finalizeReview.mockResolvedValue({ id: 'rev-1' } as never);
    mocked.addRebuttal.mockResolvedValue({ id: 'rev-1' } as never);
  });

  describe('GET /api/performance/cycles', () => {
    it('lists cycles scoped by the caller role', async () => {
      mocked.listEvaluationCycles.mockResolvedValue([{ id: 'cyc-1' }] as never);

      const res = await request(buildApp()).get('/api/performance/cycles?status=OPEN');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cycles: [{ id: 'cyc-1' }] });
      expect(mocked.listEvaluationCycles).toHaveBeenCalledWith({
        status: 'OPEN',
        role: 'HR_MANAGER',
        userId: 'u-1',
      });
    });

    it('passes undefined status when the query param is absent', async () => {
      await request(buildApp()).get('/api/performance/cycles');

      expect(mocked.listEvaluationCycles).toHaveBeenCalledWith({
        status: undefined,
        role: 'HR_MANAGER',
        userId: 'u-1',
      });
    });

    it('forwards service errors', async () => {
      mocked.listEvaluationCycles.mockRejectedValue(new Error('boom'));

      const res = await request(buildApp()).get('/api/performance/cycles');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/performance/cycles/probation/eligible', () => {
    it('returns employees whose probation is ending soon', async () => {
      mocked.listSoonToExpireProbationEmployees.mockResolvedValue([{ id: 'emp-2' }] as never);

      const res = await request(buildApp()).get('/api/performance/cycles/probation/eligible');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ employees: [{ id: 'emp-2' }] });
    });
  });

  describe('POST /api/performance/cycles', () => {
    it('creates an evaluation cycle', async () => {
      const res = await request(buildApp()).post('/api/performance/cycles').send(validCycleBody);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'cyc-1' });
      const arg = mocked.createEvaluationCycle.mock.calls[0]?.[0] as { type: string };
      expect(arg.type).toBe('PROBATION');
    });

    it('returns 400 when required dates are missing', async () => {
      const res = await request(buildApp())
        .post('/api/performance/cycles')
        .send({ type: 'PROBATION' });

      expect(res.status).toBe(400);
      expect(mocked.createEvaluationCycle).not.toHaveBeenCalled();
    });

    it('returns 400 on an invalid cycle type', async () => {
      const res = await request(buildApp())
        .post('/api/performance/cycles')
        .send({ ...validCycleBody, type: 'NOT_A_TYPE' });

      expect(res.status).toBe(400);
      expect(mocked.createEvaluationCycle).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.createEvaluationCycle.mockRejectedValue(
        Object.assign(new Error('Self-evaluation window must start after the period start'), {
          status: 400,
        }),
      );

      const res = await request(buildApp()).post('/api/performance/cycles').send(validCycleBody);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Self-evaluation window must start after the period start');
    });
  });

  describe('POST /api/performance/cycles/:id/open', () => {
    it('opens a cycle', async () => {
      const res = await request(buildApp()).post('/api/performance/cycles/cyc-1/open');

      expect(res.status).toBe(200);
      expect(mocked.openEvaluationCycle).toHaveBeenCalledWith('cyc-1');
    });

    it('forwards service errors', async () => {
      mocked.openEvaluationCycle.mockRejectedValue(
        Object.assign(new Error('Evaluation cycle not found'), { status: 404 }),
      );

      const res = await request(buildApp()).post('/api/performance/cycles/cyc-1/open');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Evaluation cycle not found');
    });
  });

  describe('POST /api/performance/cycles/:id/close', () => {
    it('closes a cycle', async () => {
      const res = await request(buildApp()).post('/api/performance/cycles/cyc-1/close');

      expect(res.status).toBe(200);
      expect(mocked.closeEvaluationCycle).toHaveBeenCalledWith('cyc-1');
    });
  });

  describe('GET /api/performance/reviews', () => {
    it('returns reviews scoped to the caller', async () => {
      mocked.getMyReviews.mockResolvedValue([{ id: 'rev-1' }] as never);

      const res = await request(buildApp()).get('/api/performance/reviews');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reviews: [{ id: 'rev-1' }] });
      expect(mocked.getMyReviews).toHaveBeenCalledWith({ role: 'HR_MANAGER', userId: 'u-1' });
    });
  });

  describe('POST /api/performance/reviews/:id/self', () => {
    it('submits a self evaluation', async () => {
      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/self')
        .send({ selfEval: { q1: 'good' } });

      expect(res.status).toBe(200);
      expect(mocked.submitSelfEvaluation).toHaveBeenCalledWith({
        reviewId: 'rev-1',
        selfEval: { q1: 'good' },
        actorId: 'u-1',
        actorName: 'jane@example.com',
        actorEmployeeId: 'emp-1',
      });
    });

    it('passes null actorEmployeeId when the user has no employee profile', async () => {
      authUser.employeeId = null;

      await request(buildApp()).post('/api/performance/reviews/rev-1/self').send({ selfEval: {} });

      const arg = mocked.submitSelfEvaluation.mock.calls[0]?.[0] as {
        actorEmployeeId: string | null;
      };
      expect(arg.actorEmployeeId).toBeNull();
    });

    it('forwards service errors', async () => {
      mocked.submitSelfEvaluation.mockRejectedValue(
        Object.assign(new Error('Review not found'), { status: 404 }),
      );

      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/self')
        .send({ selfEval: {} });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Review not found');
    });
  });

  describe('POST /api/performance/reviews/:id/manager', () => {
    it('submits a manager evaluation', async () => {
      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/manager')
        .send({ managerEval: { rating: 4 } });

      expect(res.status).toBe(200);
      expect(mocked.submitManagerEvaluation).toHaveBeenCalledWith({
        reviewId: 'rev-1',
        managerEval: { rating: 4 },
        actorId: 'u-1',
        actorName: 'jane@example.com',
        actorEmployeeId: 'emp-1',
      });
    });

    it('forwards permission errors', async () => {
      mocked.submitManagerEvaluation.mockRejectedValue(
        Object.assign(new Error('Only the assigned manager can submit this evaluation'), {
          status: 403,
        }),
      );

      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/manager')
        .send({ managerEval: {} });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Only the assigned manager can submit this evaluation');
    });
  });

  describe('POST /api/performance/reviews/:id/finalize', () => {
    it('finalizes a review', async () => {
      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/finalize')
        .send({ overallRating: 4, hrComments: 'Great work' });

      expect(res.status).toBe(200);
      expect(mocked.finalizeReview).toHaveBeenCalledWith({
        reviewId: 'rev-1',
        overallRating: 4,
        hrComments: 'Great work',
        actorId: 'u-1',
        actorName: 'jane@example.com',
      });
    });

    it('returns 400 when the rating is out of range', async () => {
      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/finalize')
        .send({ overallRating: 9 });

      expect(res.status).toBe(400);
      expect(mocked.finalizeReview).not.toHaveBeenCalled();
    });

    it('returns 400 when the rating is missing', async () => {
      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/finalize')
        .send({ hrComments: 'nice' });

      expect(res.status).toBe(400);
      expect(mocked.finalizeReview).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/performance/reviews/:id/rebuttal', () => {
    it('adds a rebuttal', async () => {
      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/rebuttal')
        .send({ rebuttal: 'I disagree' });

      expect(res.status).toBe(200);
      expect(mocked.addRebuttal).toHaveBeenCalledWith({
        reviewId: 'rev-1',
        rebuttal: 'I disagree',
        actorId: 'u-1',
        actorName: 'jane@example.com',
        actorEmployeeId: 'emp-1',
      });
    });

    it('returns 400 on an empty rebuttal', async () => {
      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/rebuttal')
        .send({ rebuttal: '' });

      expect(res.status).toBe(400);
      expect(mocked.addRebuttal).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      mocked.addRebuttal.mockRejectedValue(
        Object.assign(new Error('Only the reviewee can add a rebuttal'), { status: 403 }),
      );

      const res = await request(buildApp())
        .post('/api/performance/reviews/rev-1/rebuttal')
        .send({ rebuttal: 'I disagree' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Only the reviewee can add a rebuttal');
    });
  });
});
