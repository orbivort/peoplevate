import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('../api-client', () => ({ api }));

import {
  attendanceRepo,
  offboardingRepo,
  performanceRepo,
  recruitmentRepo,
} from './workflow-repositories';

describe('workflow-repositories', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
  });

  it('recruitmentRepo.listRequisitions with/without status', async () => {
    api.get.mockResolvedValue({ requisitions: [{ id: 1, title: 'T' }] });
    const list = await recruitmentRepo.listRequisitions('OPEN');
    expect(api.get).toHaveBeenCalledWith('/api/recruitment/requisitions?status=OPEN');
    expect(list[0].title).toBe('T');
    await recruitmentRepo.listRequisitions();
    expect(api.get).toHaveBeenCalledWith('/api/recruitment/requisitions');
  });

  it('recruitmentRepo requisition lifecycle', async () => {
    api.post.mockResolvedValue({ id: 1 });
    await recruitmentRepo.createRequisition({
      title: 'T',
      departmentId: 'd',
      positionId: 'p',
      headcount: 1,
      employmentType: 'FULL_TIME',
    });
    await recruitmentRepo.submitRequisition('1');
    await recruitmentRepo.approveRequisition('1');
    await recruitmentRepo.publishRequisition('1');
    await recruitmentRepo.closeRequisition('1');
    const calls = api.post.mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      '/api/recruitment/requisitions',
      '/api/recruitment/requisitions/1/submit',
      '/api/recruitment/requisitions/1/approve',
      '/api/recruitment/requisitions/1/publish',
      '/api/recruitment/requisitions/1/close',
    ]);
  });

  it('recruitmentRepo candidates', async () => {
    api.get.mockResolvedValue({ candidates: [{ id: 1 }] });
    const list = await recruitmentRepo.listCandidates('r1', 'INTERVIEW');
    expect(api.get).toHaveBeenCalledWith(
      '/api/recruitment/candidates?requisitionId=r1&stage=INTERVIEW',
    );
    expect(list).toHaveLength(1);
    await recruitmentRepo.listCandidates();
    expect(api.get).toHaveBeenCalledWith('/api/recruitment/candidates');

    api.post.mockResolvedValue({ id: 1 });
    await recruitmentRepo.createCandidate({ name: 'A', email: 'a@x', requisitionId: 'r1' });
    await recruitmentRepo.updateCandidateStage('1', 'OFFER');
    expect(api.patch).toHaveBeenCalledWith('/api/recruitment/candidates/1/stage', {
      stage: 'OFFER',
    });
  });

  it('recruitmentRepo interviews', async () => {
    api.get.mockResolvedValue({ interviews: [{ id: 1 }] });
    expect(await recruitmentRepo.listInterviews('c1')).toHaveLength(1);
    api.post.mockResolvedValue({ id: 1 });
    await recruitmentRepo.createInterview('c1', { scheduledAt: '2020' });
    await recruitmentRepo.deleteInterview('c1', 'i1');
    await recruitmentRepo.updateInterviewStatus('c1', 'i1', 'COMPLETED');
    expect(api.patch).toHaveBeenCalledWith('/api/recruitment/candidates/c1/interviews/i1/status', {
      status: 'COMPLETED',
    });
  });

  it('recruitmentRepo offers', async () => {
    api.post.mockResolvedValue({ id: 1 });
    await recruitmentRepo.createOffer('c1', { position: 'SE', salary: 1, startDate: '2020' });
    api.get.mockResolvedValue({ offers: [{ id: 1 }] });
    expect(await recruitmentRepo.listOffers()).toHaveLength(1);
    await recruitmentRepo.sendOffer('1');
    await recruitmentRepo.acceptOffer('1');
    await recruitmentRepo.deleteOffer('1');
    expect(api.del).toHaveBeenCalledWith('/api/recruitment/offers/1');
  });

  it('recruitmentRepo convert + onboarding', async () => {
    api.post.mockResolvedValue({ id: 1 });
    await recruitmentRepo.convertCandidate('c1', {
      departmentId: 'd',
      positionId: 'p',
      hireDate: '2020',
    });
    api.get.mockResolvedValue({ tasks: [{ id: 1 }] });
    expect(await recruitmentRepo.listOnboarding('e1')).toHaveLength(1);
    api.patch.mockResolvedValue({ id: 1 });
    await recruitmentRepo.updateOnboardingTask('1', {
      status: 'COMPLETE',
      assigneeId: 'a',
      dueDate: '2020',
    });
    expect(api.patch).toHaveBeenCalledWith('/api/recruitment/onboarding-tasks/1', {
      status: 'COMPLETE',
      assigneeId: 'a',
      dueDate: '2020',
    });
  });

  it('attendanceRepo.clock', async () => {
    api.post.mockResolvedValue({ id: 1 });
    await attendanceRepo.clock('IN');
    expect(api.post).toHaveBeenCalledWith('/api/attendance/clock', { type: 'IN' });
  });

  it('attendanceRepo.summary with params', async () => {
    api.get.mockResolvedValue({ summaries: [{ id: 1 }] });
    const list = await attendanceRepo.summary({ employeeId: 'e1', date: '2020' });
    expect(api.get).toHaveBeenCalledWith('/api/attendance/summary?employeeId=e1&date=2020');
    expect(list).toHaveLength(1);
    await attendanceRepo.summary();
    expect(api.get).toHaveBeenCalledWith('/api/attendance/summary');
  });

  it('attendanceRepo leave types/requests/approve/reject', async () => {
    api.get.mockResolvedValue({ leaveTypes: [{ id: 1, name: 'Sick' }] });
    const lts = await attendanceRepo.listLeaveTypes();
    expect(lts[0]).toEqual({ id: '1', name: 'Sick' });

    api.post.mockResolvedValue({ id: 1 });
    await attendanceRepo.submitLeaveRequest({
      leaveTypeId: 'l1',
      startDate: '2020',
      endDate: '2020',
      reason: 'r',
    });
    api.get.mockResolvedValue({ requests: [{ id: 1 }] });
    expect(await attendanceRepo.listLeaveRequests('APPROVED')).toHaveLength(1);
    await attendanceRepo.listLeaveRequests();
    await attendanceRepo.approveLeave('1', 'ok');
    await attendanceRepo.rejectLeave('1', 'no');
  });

  it('attendanceRepo.balance flattens employee wrapper', async () => {
    api.get.mockResolvedValue({
      balances: [{ employee_id: 'e1', balances: [{ id: 1, entitlement: 10 }] }],
    });
    const list = await attendanceRepo.balance();
    expect(list).toHaveLength(1);
    expect(list[0].employeeId).toBe('e1');
    expect(list[0].entitlement).toBe(10);
  });

  it('attendanceRepo balance with empty', async () => {
    api.get.mockResolvedValue({});
    expect(await attendanceRepo.balance()).toEqual([]);
  });

  it('attendanceRepo policy groups', async () => {
    api.get.mockResolvedValue({ policyGroups: [{ id: 1 }] });
    expect(await attendanceRepo.listPolicyGroups(2024)).toHaveLength(1);
    await attendanceRepo.listPolicyGroups();
    api.post.mockResolvedValue({ id: 1 });
    await attendanceRepo.createPolicyGroup({ name: 'G', year: 2024, entitlements: [] });
    api.put.mockResolvedValue({ id: 1 });
    await attendanceRepo.updatePolicyGroup('1', { name: 'G2' });
    api.del.mockResolvedValue({ id: 1 });
    await attendanceRepo.deletePolicyGroup('1');
  });

  it('attendanceRepo holidays', async () => {
    api.get.mockResolvedValue({ holidays: [{ id: 1 }] });
    expect(await attendanceRepo.listHolidays(2024)).toHaveLength(1);
    await attendanceRepo.listHolidays();
    api.put.mockResolvedValue({ id: 1 });
    await attendanceRepo.upsertHoliday({
      name: 'X',
      date: '2020',
      year: 2024,
      type: 'STATUTORY',
      recurring: true,
    });
    api.del.mockResolvedValue({ id: 1 });
    await attendanceRepo.deleteHoliday('1');
  });

  it('performanceRepo cycles', async () => {
    api.get.mockResolvedValue({ cycles: [{ id: 1, status: 'OPEN' }] });
    expect(await performanceRepo.listCycles('OPEN')).toHaveLength(1);
    await performanceRepo.listCycles();
    api.post.mockResolvedValue({ id: 1 });
    await performanceRepo.createCycle({ type: 'END_YEAR' });
    await performanceRepo.listProbationEligible();
    expect(api.get).toHaveBeenCalledWith('/api/performance/cycles/probation/eligible');
    await performanceRepo.openCycle('1');
    await performanceRepo.closeCycle('1');
  });

  it('performanceRepo reviews', async () => {
    api.get.mockResolvedValue({ reviews: [{ id: 1 }] });
    expect(await performanceRepo.listReviews()).toHaveLength(1);
    api.post.mockResolvedValue({ id: 1 });
    await performanceRepo.submitSelf('1', { a: 1 });
    await performanceRepo.submitManager('1', { b: 2 });
    await performanceRepo.finalize('1', 4, 'good');
    await performanceRepo.addRebuttal('1', 'r');
    expect(api.post).toHaveBeenCalledWith('/api/performance/reviews/1/finalize', {
      overallRating: 4,
      hrComments: 'good',
    });
  });

  it('offboardingRepo', async () => {
    api.post.mockResolvedValue({ id: 1 });
    await offboardingRepo.submitResignation({ lastWorkingDay: '2020' });
    await offboardingRepo.initiateTermination({
      employeeId: 'e1',
      separationType: 'RESIGNATION',
      effectiveDate: '2020',
    });
    api.get.mockResolvedValue({ records: [{ id: 1 }] });
    expect(await offboardingRepo.list('CLOSED')).toHaveLength(1);
    await offboardingRepo.list();
    api.get.mockResolvedValue({ items: [{ id: 1 }] });
    expect(await offboardingRepo.listClearance('o1')).toHaveLength(1);
    api.patch.mockResolvedValue({ id: 1 });
    await offboardingRepo.updateClearanceItem('1', {
      status: 'COMPLETE',
      responsiblePartyId: 'u',
      waivedReason: 'x',
    });
    api.post.mockResolvedValue({ id: 1 });
    await offboardingRepo.close('o1');
    await offboardingRepo.conductExitInterview('o1', { responses: [1], declined: false });
  });
});
