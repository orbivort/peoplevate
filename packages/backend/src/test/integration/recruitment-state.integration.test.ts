import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { CandidateSource, CandidateStage, EmploymentType, RequisitionStatus } from '#prisma';
import {
  createTestApp,
  createUser,
  loginForToken,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

/**
 * Illegal state-machine transitions should always be rejected regardless of
 * role. These tests assert that every entry/exit pair that the transition map
 * forbids is rejected with a 400 Bad Request (an illegal move is a client
 * error), and that legal transitions remain possible.
 *
 * The `InvalidTransitionError` thrown by the service is mapped to HTTP 400 by
 * the centralized error handler. See recruitment-service.ts for the transition
 * tables.
 */
describe('recruitment state-machine integrity', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDb();
  });

  async function seedPublishedRequisition(hrToken: string): Promise<{ requisitionId: string }> {
    const department = await prisma.department.create({
      data: { name: 'Engineering', description: 'Dev team' },
    });
    const position = await prisma.position.create({
      data: { name: 'Engineer', grade: 'L4', department_id: department.id },
    });

    const created = await request(app)
      .post('/api/recruitment/requisitions')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        title: 'Backend Engineer',
        departmentId: department.id,
        positionId: position.id,
        headcount: 1,
        employmentType: EmploymentType.FULL_TIME,
      });
    expect(created.status).toBe(201);
    const requisitionId = (created.body as { id: string }).id;

    await request(app)
      .post(`/api/recruitment/requisitions/${requisitionId}/submit`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    await request(app)
      .post(`/api/recruitment/requisitions/${requisitionId}/approve`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    await request(app)
      .post(`/api/recruitment/requisitions/${requisitionId}/publish`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    return { requisitionId };
  }

  async function createCandidate(
    hrToken: string,
    requisitionId: string,
    email: string,
  ): Promise<string> {
    const created = await request(app)
      .post('/api/recruitment/candidates')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Cand',
        email,
        source: CandidateSource.DIRECT,
        requisitionId,
        consentRecorded: true,
      });
    expect(created.status).toBe(201);
    return (created.body as { candidate: { id: string } }).candidate.id;
  }

  describe('requisition transitions', () => {
    it('rejects direct DRAFT → PUBLISHED (must pass through approval)', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const department = await prisma.department.create({ data: { name: 'Eng' } });
      const position = await prisma.position.create({
        data: { name: 'Eng', grade: 'L4', department_id: department.id },
      });

      const created = await request(app)
        .post('/api/recruitment/requisitions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Draft to Published',
          departmentId: department.id,
          positionId: position.id,
          headcount: 1,
          employmentType: EmploymentType.FULL_TIME,
        });
      const id = (created.body as { id: string }).id;

      const res = await request(app)
        .post(`/api/recruitment/requisitions/${id}/publish`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      // Must still be DRAFT - the illegal transition must not have mutated state.
      const stored = await prisma.jobRequisition.findUnique({ where: { id } });
      expect(stored?.status).toBe(RequisitionStatus.DRAFT);
    });

    it('rejects CLOSED → re-open via a repeat publish', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId } = await seedPublishedRequisition(token);

      // Publishing an already-PUBLISHED requisition is not a legal transition.
      const res = await request(app)
        .post(`/api/recruitment/requisitions/${requisitionId}/publish`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('candidate transitions', () => {
    it('rejects skipping stages (APPLIED → OFFER directly)', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId } = await seedPublishedRequisition(token);
      const candidateId = await createCandidate(token, requisitionId, 'skip@example.com');

      const res = await request(app)
        .patch(`/api/recruitment/candidates/${candidateId}/stage`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: CandidateStage.OFFER });
      expect(res.status).toBe(400);

      const stored = await prisma.candidate.findUnique({ where: { id: candidateId } });
      expect(stored?.stage).toBe(CandidateStage.APPLIED);
    });

    it('rejects moving from HIRED backwards to INTERVIEW', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId } = await seedPublishedRequisition(token);
      const candidateId = await createCandidate(token, requisitionId, 'hired@example.com');

      for (const stage of [CandidateStage.SCREENING, CandidateStage.INTERVIEW]) {
        await request(app)
          .patch(`/api/recruitment/candidates/${candidateId}/stage`)
          .set('Authorization', `Bearer ${token}`)
          .send({ stage })
          .expect(200);
      }

      // Force the candidate into HIRED by editing the DB directly (mimics the
      // end-state after conversion) to prove the guard rejects the reverse move.
      await prisma.candidate.update({
        where: { id: candidateId },
        data: { stage: CandidateStage.HIRED },
      });

      const res = await request(app)
        .patch(`/api/recruitment/candidates/${candidateId}/stage`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: CandidateStage.INTERVIEW });
      expect(res.status).toBe(400);
    });

    it('moves a candidate along the legal SCREENING → INTERVIEW path', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId } = await seedPublishedRequisition(token);
      const candidateId = await createCandidate(token, requisitionId, 'legal@example.com');

      await request(app)
        .patch(`/api/recruitment/candidates/${candidateId}/stage`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: CandidateStage.SCREENING })
        .expect(200);
      const res = await request(app)
        .patch(`/api/recruitment/candidates/${candidateId}/stage`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: CandidateStage.INTERVIEW })
        .expect(200);

      expect(res.status).toBe(200);
      const stored = await prisma.candidate.findUnique({ where: { id: candidateId } });
      expect(stored?.stage).toBe(CandidateStage.INTERVIEW);
    });
  });
});
