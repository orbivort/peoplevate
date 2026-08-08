import { describe, it, expect } from 'vitest';

import {
  adaptAttendance,
  adaptCandidate,
  adaptClearanceItem,
  adaptEvaluationCycle,
  adaptExitInterview,
  adaptHoliday,
  adaptInterview,
  adaptJobRequisition,
  adaptLeaveBalance,
  adaptLeaveRequest,
  adaptOfferLetter,
  adaptOffboardingRecord,
  adaptOnboardingTask,
  adaptPerformanceReview,
  adaptSettlement,
} from './workflow-adapters';

describe('workflow-adapters', () => {
  it('adaptJobRequisition with full nested data', () => {
    const r = adaptJobRequisition({
      id: 1,
      title: 'Dev',
      department: { id: 2, name: 'Eng' },
      position: { id: 3, name: 'SE' },
      headcount: 5,
      employment_type: 'FULL_TIME',
      status: 'PUBLISHED',
      created_by: 'u',
      created_at: '2020-01-01',
      published_at: '2020-02-01',
      closing_date: '2020-03-01',
      _count: { candidates: 9 },
    });
    expect(r.title).toBe('Dev');
    expect(r.departmentName).toBe('Eng');
    expect(r.positionName).toBe('SE');
    expect(r.employmentType).toBe('Full-time');
    expect(r.status).toBe('Published');
    expect(r.publishedAt).toBe('2020-02-01');
    expect(r.applicantCount).toBe(9);
  });

  it('adaptJobRequisition defaults and fallbacks', () => {
    const r = adaptJobRequisition({ id: 1 });
    expect(r.status).toBe('Closed');
    expect(r.employmentType).toBe('Full-time');
    expect(r.departmentName).toBe('');
    expect(r.applicantCount).toBe(0);
  });

  it('adaptCandidate', () => {
    const c = adaptCandidate({
      id: 1,
      requisition_id: 'r1',
      requisition: { title: 'T' },
      name: 'Jane',
      email: 'j@x',
      phone: '1',
      source: 'REFERRAL',
      stage: 'INTERVIEW',
      resume_path: 'cv.pdf',
      consent_recorded: true,
      applied_at: '2020',
      employee_id: 'e1',
    });
    expect(c.source).toBe('Referral');
    expect(c.stage).toBe('Interview');
    expect(c.resumeFilename).toBe('cv.pdf');
    expect(c.consentRecorded).toBe(true);
    expect(c.employeeId).toBe('e1');
  });

  it('adaptCandidate defaults', () => {
    const c = adaptCandidate({ id: 1 });
    expect(c.source).toBe('Direct');
    expect(c.stage).toBe('Applied');
    expect(c.resumeFilename).toBeUndefined();
  });

  it('adaptInterview with nested candidate', () => {
    const i = adaptInterview({
      id: 1,
      candidate: { id: 2, name: 'Bob', requisition: { title: 'T' } },
      scheduled_at: '2020',
      duration_min: 60,
      interviewer_ids: [1, 2],
      location: 'R1',
      notes: 'n',
      status: 'COMPLETED',
    });
    expect(i.candidateName).toBe('Bob');
    expect(i.requisitionTitle).toBe('T');
    expect(i.interviewers).toEqual(['1', '2']);
    expect(i.status).toBe('Completed');
  });

  it('adaptInterview default status', () => {
    expect(adaptInterview({ id: 1 }).status).toBe('Scheduled');
  });

  it('adaptOfferLetter', () => {
    const o = adaptOfferLetter({
      id: 1,
      candidate_id: 'c1',
      candidate: { name: 'A' },
      position: 'SE',
      salary: 100,
      start_date: '2020',
      status: 'ACCEPTED',
      sent_at: '2020-01',
      accepted_at: '2020-02',
      created_by: 'u',
      created_at: '2020-00',
    });
    expect(o.status).toBe('Accepted');
    expect(o.candidateName).toBe('A');
    expect(o.salary).toBe(100);
  });

  it('adaptOnboardingTask', () => {
    const t = adaptOnboardingTask({
      id: 1,
      employee_id: 'e1',
      type: 'EQUIPMENT_ASSIGNMENT',
      assignee: { email: 'a@x' },
      due_date: '2020',
      status: 'COMPLETE',
      completed_at: '2020',
    });
    expect(t.type).toBe('Equipment Assignment');
    expect(t.assignee).toBe('a@x');
    expect(t.status).toBe('Complete');
    expect(t.completedAt).toBe('2020');
  });

  it('adaptAttendance', () => {
    const a = adaptAttendance({
      id: 1,
      employeeId: 'e1',
      employeeName: 'J',
      clockIn: '08:00',
      clockOut: '17:00',
      totalHours: 8,
      status: 'PRESENT',
      ip_address: '1.2.3.4',
    });
    expect(a.status).toBe('Present');
    expect(a.ipAddress).toBe('1.2.3.4');
    expect(a.totalHours).toBe(8);
  });

  it('adaptAttendance unknown status defaults to Absent', () => {
    expect(adaptAttendance({ id: 1 }).status).toBe('Absent');
  });

  it('adaptLeaveRequest with approvals', () => {
    const l = adaptLeaveRequest({
      id: 1,
      employee: { first_name: 'A', last_name: 'B' },
      leave_type: { name: 'ANNUAL' },
      start_date: '2020',
      end_date: '2020',
      days: 3,
      reason: 'r',
      status: 'APPROVED',
      submitted_by: 'u',
      submitted_at: '2020',
      approvals: [
        { level: 1, approver_id: 'm', action: 'APPROVE', comment: 'ok', created_at: '2020' },
      ],
    });
    expect(l.employeeName).toBe('A B');
    expect(l.leaveType).toBe('Annual');
    expect(l.status).toBe('Approved');
    expect(l.approvals[0].decision).toBe('Approved');
  });

  it('adaptLeaveBalance with proration and probation', () => {
    const b = adaptLeaveBalance({
      employeeId: 'e1',
      leaveTypeId: 'l1',
      name: 'Sick',
      entitlement: 10,
      accrued: 2,
      used: 1,
      pending: 1,
      carryForward: 3,
      available: 12,
      source: 'policy',
      policyGroupName: 'PG',
      prorated: true,
      proration: {
        fullEntitlement: 10,
        proratedEntitlement: 5,
        hireDate: '2020',
        remainingDays: 1,
        totalDays: 2,
        remainingMonths: 3,
        fraction: 0.5,
      },
      probation: {
        underProbation: true,
        hireDate: '2020',
        probationMonths: 6,
        probationEndDate: '2021',
        remainingDays: 2,
      },
    });
    expect(b.leaveType).toBe('Sick');
    expect(b.carryForward).toBe(3);
    expect(b.proration?.proratedEntitlement).toBe(5);
    expect(b.probation?.underProbation).toBe(true);
  });

  it('adaptLeaveBalance without proration/probation', () => {
    const b = adaptLeaveBalance({ employeeId: 'e1' });
    expect(b.proration).toBeNull();
    expect(b.probation).toBeNull();
    expect(b.leaveType).toBe('Annual');
  });

  it('adaptHoliday', () => {
    const h = adaptHoliday({
      id: 1,
      name: 'X',
      date: '2020',
      year: 2020,
      type: 'COMPANY',
      recurring: true,
    });
    expect(h.type).toBe('COMPANY');
    expect(h.recurring).toBe(true);
  });

  it('adaptEvaluationCycle computes phase for Open status', () => {
    const c = adaptEvaluationCycle({
      id: 1,
      type: 'END_YEAR',
      status: 'OPEN',
      self_eval_start: '2000-01-01',
      self_eval_end: '2100-01-01',
      manager_eval_start: '2000',
      manager_eval_end: '2000',
      hr_review_start: '2000',
      hr_review_end: '2000',
    });
    expect(c.status).toBe('Open');
    expect(c.currentPhase).toBe('Self-Evaluation');
    expect(c.type).toBe('End-Year');
  });

  it('adaptEvaluationCycle Closed status', () => {
    const c = adaptEvaluationCycle({ id: 1, type: 'MID_YEAR', status: 'CLOSED' });
    expect(c.status).toBe('Closed');
    expect(c.currentPhase).toBe('Completed');
  });

  it('adaptEvaluationCycle Draft default', () => {
    const c = adaptEvaluationCycle({ id: 1 });
    expect(c.status).toBe('Draft');
    expect(c.type).toBe('End-Year');
  });

  it('adaptPerformanceReview parses competencies and manager merge', () => {
    const r = adaptPerformanceReview({
      id: 1,
      employee: { first_name: 'A', last_name: 'B', manager: { first_name: 'M', last_name: 'N' } },
      cycle: { id: 2, type: 'PROBATION' },
      status: 'COMPLETED',
      self_eval: {
        competencies: [{ name: 'Comm', selfRating: 4, comment: 'good' }],
        achievements: 'a',
        goals: 'g',
      },
      manager_eval: { competencies: [{ name: 'Comm', managerRating: 5 }], comments: 'great' },
      overall_rating: 4,
    });
    expect(r.employeeName).toBe('A B');
    expect(r.managerName).toBe('M N');
    expect(r.status).toBe('Completed');
    expect(r.competencies[0].selfRating).toBe(4);
    expect(r.competencies[0].managerRating).toBe(5);
    expect(r.achievements).toBe('a');
    expect(r.managerComments).toBe('great');
    expect(r.overallRating).toBe(4);
  });

  it('adaptPerformanceReview without evals', () => {
    const r = adaptPerformanceReview({ id: 1 });
    expect(r.competencies).toEqual([]);
    expect(r.status).toBe('Not Started');
  });

  it('adaptClearanceItem', () => {
    const c = adaptClearanceItem({
      id: 1,
      category: 'ASSET_RETURN',
      description: 'laptop',
      responsible_party: { email: 'a@x' },
      status: 'COMPLETE',
      completed_at: '2020',
      sign_off_by: 'm',
      waived_reason: 'n/a',
    });
    expect(c.category).toBe('Asset Return');
    expect(c.responsibleParty).toBe('a@x');
    expect(c.status).toBe('Complete');
  });

  it('adaptExitInterview', () => {
    const e = adaptExitInterview({
      conducted_by: 'u',
      conducted_at: '2020',
      declined: true,
      responses: [1],
    });
    expect(e.declined).toBe(true);
    expect(e.responses).toEqual([1]);
  });

  it('adaptSettlement', () => {
    const s = adaptSettlement({
      generated_at: '2020',
      last_working_day: '2020',
      leave_encashment_days: 2,
      leave_encashment_amount: 100,
      pending_dues: [1],
      total_amount: 200,
      outstanding_flagged: true,
    });
    expect(s.totalAmount).toBe(200);
    expect(s.outstandingFlagged).toBe(true);
  });

  it('adaptOffboardingRecord with nested arrays', () => {
    const o = adaptOffboardingRecord({
      id: 1,
      employee: { first_name: 'A', last_name: 'B' },
      separation_type: 'RESIGNATION',
      reason: 'r',
      last_working_day: '2020',
      status: 'CLOSED',
      initiated_by: 'u',
      initiated_at: '2020',
      deactivation_date: '2020',
      clearance_items: [{ id: 1, category: 'ASSET_RETURN', status: 'COMPLETE' }],
      exit_interviews: [{ conducted_by: 'u' }],
      settlements: [{ total_amount: 5 }],
    });
    expect(o.employeeName).toBe('A B');
    expect(o.separationType).toBe('Resignation');
    expect(o.status).toBe('Closed');
    expect(o.clearanceItems).toHaveLength(1);
    expect(o.exitInterview?.conductedBy).toBe('u');
    expect(o.settlement?.totalAmount).toBe(5);
  });

  it('adaptOffboardingRecord without nested arrays', () => {
    const o = adaptOffboardingRecord({ id: 1 });
    expect(o.clearanceItems).toEqual([]);
    expect(o.exitInterview).toBeNull();
    expect(o.settlement).toBeNull();
  });
});
