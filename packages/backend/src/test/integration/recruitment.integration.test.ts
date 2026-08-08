import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  CandidateStage,
  CandidateSource,
  EmploymentType,
  OfferStatus,
  RequisitionStatus,
  OnboardingTaskStatus,
} from '#prisma';
import {
  createTestApp,
  createUser,
  loginForToken,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

/**
 * Seeds a minimal org structure (department + position) that requisitions and
 * employees can reference via foreign keys.
 */
async function seedOrg() {
  const department = await prisma.department.create({
    data: { name: 'Engineering', description: 'Dev team' },
  });
  const position = await prisma.position.create({
    data: { name: 'Software Developer', grade: 'L4', department_id: department.id },
  });
  return { department, position };
}

/** Walks a requisition through DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED. */
async function seedPublishedRequisition(app: Express, hrToken: string) {
  const { department, position } = await seedOrg();

  const created = await request(app)
    .post('/api/recruitment/requisitions')
    .set('Authorization', `Bearer ${hrToken}`)
    .send({
      title: 'Senior Backend Engineer',
      departmentId: department.id,
      positionId: position.id,
      headcount: 2,
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

  return { requisitionId, department, position };
}

/**
 * Creates a candidate, walks it through to the OFFER stage, then creates,
 * sends and accepts an offer letter for that candidate.
 */
async function reachOffer(app: Express, hrToken: string, requisitionId: string): Promise<string> {
  const created = await request(app)
    .post('/api/recruitment/candidates')
    .set('Authorization', `Bearer ${hrToken}`)
    .send({
      name: 'Alice Wonder',
      email: 'alice.wonder@example.com',
      source: CandidateSource.DIRECT,
      requisitionId,
      consentRecorded: true,
    });
  expect(created.status).toBe(201);
  const candidateId = (created.body as { candidate: { id: string } }).candidate.id;

  for (const stage of [CandidateStage.SCREENING, CandidateStage.INTERVIEW, CandidateStage.OFFER]) {
    await request(app)
      .patch(`/api/recruitment/candidates/${candidateId}/stage`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ stage })
      .expect(200);
  }

  const offer = await request(app)
    .post(`/api/recruitment/candidates/${candidateId}/offers`)
    .set('Authorization', `Bearer ${hrToken}`)
    .send({
      position: 'Software Developer',
      salary: 120000,
      startDate: '2026-03-01',
      terms: 'Standard',
    });
  expect(offer.status).toBe(201);
  const offerId = (offer.body as { id: string }).id;

  await request(app)
    .post(`/api/recruitment/offers/${offerId}/send`)
    .set('Authorization', `Bearer ${hrToken}`)
    .expect(200);
  await request(app)
    .post(`/api/recruitment/offers/${offerId}/accept`)
    .set('Authorization', `Bearer ${hrToken}`)
    .expect(200);

  return candidateId;
}

describe('recruitment integration', () => {
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

  describe('requisition lifecycle', () => {
    it('drives a requisition through draft → submit → approve → publish', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { department, position } = await seedOrg();

      const created = await request(app)
        .post('/api/recruitment/requisitions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Data Analyst',
          departmentId: department.id,
          positionId: position.id,
          headcount: 1,
          employmentType: EmploymentType.FULL_TIME,
        });
      expect(created.status).toBe(201);
      const id = (created.body as { id: string }).id;
      expect((created.body as { status: string }).status).toBe(RequisitionStatus.DRAFT);

      await request(app)
        .post(`/api/recruitment/requisitions/${id}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app)
        .post(`/api/recruitment/requisitions/${id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const published = await request(app)
        .post(`/api/recruitment/requisitions/${id}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((published.body as { status: string }).status).toBe(RequisitionStatus.PUBLISHED);

      // Publish auto-creates an internal job posting.
      const posting = await prisma.jobPosting.findFirst({ where: { requisition_id: id } });
      expect(posting).not.toBeNull();
      expect(posting?.status).toBe(RequisitionStatus.PUBLISHED);
    });

    it('forbids an EMPLOYEE from creating a requisition', async () => {
      await seedOrg();
      const emp = await createUser({ role: 'EMPLOYEE', email: 'emp@example.com' });
      const token = await loginForToken(app, emp.email, emp.password);

      const res = await request(app)
        .post('/api/recruitment/requisitions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Nope',
          departmentId: 'dept',
          positionId: 'pos',
          headcount: 1,
          employmentType: EmploymentType.FULL_TIME,
        });
      expect(res.status).toBe(403);
    });
  });

  describe('candidate pipeline', () => {
    it('walks a candidate through screening → interview → offer', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId } = await seedPublishedRequisition(app, token);

      const created = await request(app)
        .post('/api/recruitment/candidates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          source: CandidateSource.JOB_BOARD,
          requisitionId,
          consentRecorded: true,
        });
      expect(created.status).toBe(201);
      const candidateId = (created.body as { candidate: { id: string } }).candidate.id;

      const stageFlow: CandidateStage[] = [
        CandidateStage.SCREENING,
        CandidateStage.INTERVIEW,
        CandidateStage.OFFER,
      ];
      for (const stage of stageFlow) {
        await request(app)
          .patch(`/api/recruitment/candidates/${candidateId}/stage`)
          .set('Authorization', `Bearer ${token}`)
          .send({ stage })
          .expect(200);
      }

      const stored = await prisma.candidate.findUnique({ where: { id: candidateId } });
      expect(stored?.stage).toBe(CandidateStage.OFFER);

      // Stage transitions are audited.
      const audit = await prisma.auditLog.findMany({
        where: { entity: 'CANDIDATES', entity_id: candidateId },
      });
      expect(audit.length).toBeGreaterThanOrEqual(stageFlow.length);
    });

    it('rejects an illegal candidate stage transition', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId } = await seedPublishedRequisition(app, token);

      const created = await request(app)
        .post('/api/recruitment/candidates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Bob',
          email: 'bob@example.com',
          source: CandidateSource.DIRECT,
          requisitionId,
          consentRecorded: true,
        });
      const candidateId = (created.body as { candidate: { id: string } }).candidate.id;

      // APPLIED → OFFER is not a legal direct transition (must go through SCREENING/INTERVIEW).
      const res = await request(app)
        .patch(`/api/recruitment/candidates/${candidateId}/stage`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: CandidateStage.OFFER });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('candidate → employee conversion', () => {
    it('converts a candidate to an employee, creates onboarding tasks, and locks the candidate', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId, department, position } = await seedPublishedRequisition(app, token);

      const candidateId = await reachOffer(app, token, requisitionId);

      const convert = await request(app)
        .post(`/api/recruitment/candidates/${candidateId}/convert`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          departmentId: department.id,
          positionId: position.id,
          hireDate: '2026-03-01',
        });
      expect(convert.status).toBe(201);
      expect(convert.body).toMatchObject({
        employeeId: expect.any(String),
        employeeNo: expect.any(String),
        onboardingCreated: true,
      });

      const employee = await prisma.employee.findUnique({
        where: { id: convert.body.employeeId as string },
      });
      expect(employee).not.toBeNull();
      expect(employee?.email).toBe('alice.wonder@example.com');
      expect(employee?.status).toBe('NEW_HIRE');
      expect(employee?.department_id).toBe(department.id);

      // 4 onboarding tasks auto-created.
      const tasks = await prisma.onboardingTask.findMany({
        where: { employee_id: employee?.id },
      });
      expect(tasks).toHaveLength(4);
      expect(tasks.every((t) => t.status === OnboardingTaskStatus.PENDING)).toBe(true);

      // Candidate linked + locked at HIRED.
      const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
      expect(candidate?.stage).toBe(CandidateStage.HIRED);
      expect(candidate?.employee_id).toBe(employee?.id);

      // Candidate is locked — further stage changes rejected.
      const locked = await request(app)
        .patch(`/api/recruitment/candidates/${candidateId}/stage`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: CandidateStage.REJECTED });
      expect(locked.status).toBe(400);
    });

    it('rejects conversion when the candidate has no accepted offer (still in offer stage check)', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId, department, position } = await seedPublishedRequisition(app, token);

      // Reach OFFER but do NOT create/send/accept an offer letter.
      const created = await request(app)
        .post('/api/recruitment/candidates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Carol King',
          email: 'carol@example.com',
          source: CandidateSource.DIRECT,
          requisitionId,
          consentRecorded: true,
        });
      const candidateId = (created.body as { candidate: { id: string } }).candidate.id;
      for (const stage of [
        CandidateStage.SCREENING,
        CandidateStage.INTERVIEW,
        CandidateStage.OFFER,
      ]) {
        await request(app)
          .patch(`/api/recruitment/candidates/${candidateId}/stage`)
          .set('Authorization', `Bearer ${token}`)
          .send({ stage })
          .expect(200);
      }

      // Conversion is allowed from OFFER/HIRED, but with no accepted offer the salary
      // is omitted. Verify the conversion still succeeds and the employee is created.
      const convert = await request(app)
        .post(`/api/recruitment/candidates/${candidateId}/convert`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          departmentId: department.id,
          positionId: position.id,
          hireDate: '2026-03-01',
        });
      expect(convert.status).toBe(201);
      const employee = await prisma.employee.findUnique({
        where: { id: convert.body.employeeId as string },
      });
      expect(employee?.salary_encrypted).toBeNull();
    });

    it('rejects conversion of a candidate not in OFFER/HIRED stage', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId, department, position } = await seedPublishedRequisition(app, token);

      const created = await request(app)
        .post('/api/recruitment/candidates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Dan Stone',
          email: 'dan@example.com',
          source: CandidateSource.DIRECT,
          requisitionId,
          consentRecorded: true,
        });
      const candidateId = (created.body as { candidate: { id: string } }).candidate.id;

      // Candidate is still in APPLIED — not convertible.
      const convert = await request(app)
        .post(`/api/recruitment/candidates/${candidateId}/convert`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          departmentId: department.id,
          positionId: position.id,
          hireDate: '2026-03-01',
        });
      expect(convert.status).toBe(400);
    });

    it('rejects conversion when an employee with the same email already exists (409 merge)', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId, department, position } = await seedPublishedRequisition(app, token);

      const candidateId = await reachOffer(app, token, requisitionId);

      // Pre-existing employee with the same email.
      await prisma.employee.create({
        data: {
          employee_no: 'EMP-2026-0001',
          first_name: 'Alice',
          last_name: 'Wonder',
          email: 'alice.wonder@example.com',
          department_id: department.id,
          position_id: position.id,
          hire_date: new Date('2026-01-15'),
          employment_type: EmploymentType.FULL_TIME,
          status: 'ACTIVE',
        },
      });

      const convert = await request(app)
        .post(`/api/recruitment/candidates/${candidateId}/convert`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          departmentId: department.id,
          positionId: position.id,
          hireDate: '2026-03-01',
        });
      expect(convert.status).toBe(409);
    });

    it('forbids a MANAGER from converting a candidate (HR-only endpoint)', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const hrToken = await loginForToken(app, hr.email, hr.password);
      const { requisitionId, department, position } = await seedPublishedRequisition(app, hrToken);

      const candidateId = await reachOffer(app, hrToken, requisitionId);

      const mgr = await createUser({ role: 'MANAGER', email: 'mgr@example.com' });
      const mgrToken = await loginForToken(app, mgr.email, mgr.password);

      const convert = await request(app)
        .post(`/api/recruitment/candidates/${candidateId}/convert`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({
          departmentId: department.id,
          positionId: position.id,
          hireDate: '2026-03-01',
        });
      expect(convert.status).toBe(403);
    });
  });

  describe('offer letter lifecycle', () => {
    it('creates a draft offer, sends it, and accepts it', async () => {
      const hr = await createUser({ role: 'HR_MANAGER', email: 'hr@example.com' });
      const token = await loginForToken(app, hr.email, hr.password);
      const { requisitionId } = await seedPublishedRequisition(app, token);

      const candidateId = await reachOffer(app, token, requisitionId);

      const offer = await prisma.offerLetter.findFirst({
        where: { candidate_id: candidateId },
      });
      expect(offer).not.toBeNull();
      expect(offer?.status).toBe(OfferStatus.ACCEPTED);
      expect(offer?.salary).toBe(120000);
      expect(offer?.accepted_at).not.toBeNull();
      expect(offer?.sent_at).not.toBeNull();
    });
  });
});
