import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const clockMock = vi.fn();
const summaryMock = vi.fn();
const listLeaveRequestsMock = vi.fn();
const balanceMock = vi.fn();
const listLeaveTypesMock = vi.fn();
const submitLeaveRequestMock = vi.fn();
const approveLeaveMock = vi.fn();
const rejectLeaveMock = vi.fn();
const employeesState = vi.hoisted(() => ({ employees: [] as Record<string, unknown>[] }));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/data/data-layer', () => ({
  useEmployees: () => ({ data: employeesState.employees, mode: 'live', error: null }),
}));

vi.mock('@/lib/api/workflow-repositories', () => ({
  attendanceRepo: {
    clock: (...args: unknown[]) => clockMock(...args),
    summary: (...args: unknown[]) => summaryMock(...args),
    listLeaveRequests: (...args: unknown[]) => listLeaveRequestsMock(...args),
    balance: (...args: unknown[]) => balanceMock(...args),
    listLeaveTypes: (...args: unknown[]) => listLeaveTypesMock(...args),
    submitLeaveRequest: (...args: unknown[]) => submitLeaveRequestMock(...args),
    approveLeave: (...args: unknown[]) => approveLeaveMock(...args),
    rejectLeave: (...args: unknown[]) => rejectLeaveMock(...args),
  },
}));

import { AttendanceLeavePage } from './attendance-leave-page';

const employee = {
  id: 'e1',
  firstName: 'Alice',
  lastName: 'Admin',
  email: 'alice@example.com',
  employeeNo: 'E001',
  departmentId: 'd1',
  departmentName: 'HR',
  managerId: 'm1',
  managerName: 'Big Boss',
  status: 'Active' as const,
};

const makeAuth = (overrides: Record<string, unknown> = {}) => ({
  employee: { ...employee, ...(overrides.employee ?? {}) },
  hasPermission: vi.fn((p: string) => (overrides.perms ? overrides.perms.includes(p) : true)),
});

beforeEach(() => {
  clockMock.mockResolvedValue({});
  summaryMock.mockResolvedValue([]);
  listLeaveRequestsMock.mockResolvedValue([]);
  balanceMock.mockResolvedValue([]);
  listLeaveTypesMock.mockResolvedValue([
    { id: 'lt1', name: 'Annual' },
    { id: 'lt2', name: 'Personal' },
    { id: 'lt3', name: 'Sick' },
    { id: 'lt4', name: 'Unpaid' },
  ]);
  submitLeaveRequestMock.mockResolvedValue({});
  approveLeaveMock.mockResolvedValue({});
  rejectLeaveMock.mockResolvedValue({});
  employeesState.employees = [
    employee,
    { id: 'e2', firstName: 'Bob', lastName: 'Report', managerId: 'e1', departmentId: 'd1' },
  ];
  useAuthMock.mockReturnValue(makeAuth());
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AttendanceLeavePage', () => {
  it('renders the heading and the clock tab by default', () => {
    render(<AttendanceLeavePage />);
    expect(screen.getByRole('heading', { name: /attendance & leave/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clock in/i })).toBeInTheDocument();
  });

  it('clocks in and shows the clocked-in status', async () => {
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /clock in/i }));
    expect(clockMock).toHaveBeenCalledWith('IN');
    expect(await screen.findByText(/clocked in at/i)).toBeInTheDocument();
  });

  it('clocks out after clocking in', async () => {
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /clock in/i }));
    await screen.findByText(/clocked in at/i);
    await user.click(screen.getByRole('button', { name: /clock out/i }));
    expect(clockMock).toHaveBeenCalledWith('OUT');
    expect(await screen.findByText(/clocked out at/i)).toBeInTheDocument();
  });

  it('shows the leave request dialog with validation', async () => {
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /request leave/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/start and end dates are required/i)).toBeInTheDocument();
    expect(submitLeaveRequestMock).not.toHaveBeenCalled();
  });

  it('rejects a leave request when the end date precedes the start date', async () => {
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /request leave/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Start date *'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('End date *'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('Reason *'), { target: { value: 'Vacation' } });
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/end date cannot be before start date/i)).toBeInTheDocument();
    expect(submitLeaveRequestMock).not.toHaveBeenCalled();
  });

  it('submits a valid leave request and routes to the My leave tab', async () => {
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /request leave/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Start date *'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('End date *'), { target: { value: '2026-06-12' } });
    fireEvent.change(screen.getByLabelText('Reason *'), { target: { value: 'Vacation' } });
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() =>
      expect(submitLeaveRequestMock).toHaveBeenCalledWith({
        leaveTypeId: 'lt1',
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        reason: 'Vacation',
      }),
    );
  });

  it('shows an empty state on the My leave tab when there are no requests', async () => {
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /my leave/i }));
    expect(await screen.findByText(/no leave requests/i)).toBeInTheDocument();
  });

  it('shows the Balances and Approvals tabs for HR/Admin only', () => {
    render(<AttendanceLeavePage />);
    expect(screen.getByRole('tab', { name: /balances/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /approvals/i })).toBeInTheDocument();
  });

  it('hides the Balances and Approvals tabs for regular employees', () => {
    useAuthMock.mockReturnValue(
      makeAuth({
        employee: { id: 'e2', firstName: 'Bob', lastName: 'Report', managerId: 'e1' },
        perms: [],
      }),
    );
    render(<AttendanceLeavePage />);
    expect(screen.queryByRole('tab', { name: /balances/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /approvals/i })).not.toBeInTheDocument();
  });

  it('approves a pending leave request from the approvals queue (HR)', async () => {
    listLeaveRequestsMock.mockResolvedValue([
      {
        id: 'lr1',
        employeeId: 'e2',
        employeeName: 'Bob Report',
        leaveType: 'Annual',
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        days: 3,
        reason: 'Vacation',
        status: 'Pending HR Approval',
        submittedAt: '2026-05-01T00:00:00.000Z',
        approvals: [],
      },
    ]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /approvals/i }));
    await screen.findByText(/leave approvals queue/i);
    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    expect(approveLeaveMock).toHaveBeenCalledWith('lr1', undefined);
  });

  it('approves a pending request with an optional comment', async () => {
    listLeaveRequestsMock.mockResolvedValue([
      {
        id: 'lr2',
        employeeId: 'e2',
        employeeName: 'Bob Report',
        leaveType: 'Sick',
        startDate: '2026-06-10',
        endDate: '2026-06-11',
        days: 2,
        reason: 'Illness',
        status: 'Pending HR Approval',
        submittedAt: '2026-05-01T00:00:00.000Z',
        approvals: [],
      },
    ]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /approvals/i }));
    await screen.findByText(/leave approvals queue/i);
    fireEvent.change(screen.getByPlaceholderText(/comment \(optional\)/i), {
      target: { value: 'Approved, take care' },
    });
    await user.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(approveLeaveMock).toHaveBeenCalledWith('lr2', 'Approved, take care'),
    );
  });

  it('rejects a pending request from the approvals queue', async () => {
    listLeaveRequestsMock.mockResolvedValue([
      {
        id: 'lr3',
        employeeId: 'e2',
        employeeName: 'Bob Report',
        leaveType: 'Personal',
        startDate: '2026-06-10',
        endDate: '2026-06-10',
        days: 1,
        reason: 'Errand',
        status: 'Pending HR Approval',
        submittedAt: '2026-05-01T00:00:00.000Z',
        approvals: [],
      },
    ]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /approvals/i }));
    await screen.findByText(/leave approvals queue/i);
    fireEvent.change(screen.getByPlaceholderText(/comment \(optional\)/i), {
      target: { value: 'Not eligible' },
    });
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    await waitFor(() => expect(rejectLeaveMock).toHaveBeenCalledWith('lr3', 'Not eligible'));
  });

  it('closes the leave request dialog via Cancel', async () => {
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /request leave/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: balances matrix, my balance (empty/probation/prorated),
// role gating (manager), approvals edge cases, leave-request validation paths,
// submission success/error, and clock-in failure.
// ---------------------------------------------------------------------------

const balanceFixture: LeaveBalance[] = [
  {
    employeeId: 'e1',
    leaveType: 'Annual',
    entitlement: 20,
    used: 5,
    pending: 2,
    available: 13,
    policyGroupName: 'Standard',
  },
  {
    employeeId: 'e2',
    leaveType: 'Sick',
    entitlement: 10,
    used: 1,
    pending: 0,
    available: 9,
    policyGroupName: 'Standard',
  },
];

const approvalRequestFixture: LeaveRequest = {
  id: 'lr1',
  employeeId: 'e1',
  employeeName: 'Alice Admin',
  leaveType: 'Annual',
  startDate: '2026-06-10',
  endDate: '2026-06-12',
  days: 3,
  reason: 'Vacation',
  status: 'Pending HR Approval',
  submittedAt: '2026-05-01T00:00:00.000Z',
  approvals: [],
};

describe('AttendanceLeavePage — balances matrix (HR/Admin)', () => {
  beforeEach(() => {
    balanceMock.mockResolvedValue(balanceFixture);
  });

  it('renders the balances matrix with grouped employees and policy groups', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AttendanceLeavePage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('tab', { name: /balances/i }));
    expect(await screen.findByText(/leave balances — all employees/i)).toBeInTheDocument();
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob Report')).toBeInTheDocument();
    expect(screen.getAllByText('Standard').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the policy group management link for HR/Admin', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AttendanceLeavePage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('tab', { name: /balances/i }));
    expect(await screen.findByRole('link', { name: /manage policy groups/i })).toBeInTheDocument();
  });

  it('shows an empty message when there are no balances', async () => {
    balanceMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AttendanceLeavePage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('tab', { name: /balances/i }));
    expect(await screen.findByText(/no leave balance data available/i)).toBeInTheDocument();
  });
});

describe('AttendanceLeavePage — my balance', () => {
  it('renders an empty state when the employee has no balances', async () => {
    balanceMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /my balance/i }));
    expect(await screen.findByText(/no balance data/i)).toBeInTheDocument();
  });

  it('renders a balance card with the probation notice', async () => {
    balanceMock.mockResolvedValue([
      {
        employeeId: 'e1',
        leaveType: 'Annual',
        entitlement: 0,
        used: 0,
        pending: 0,
        available: 0,
        probation: {
          probationMonths: 6,
          probationEndDate: '2026-12-01',
          remainingDays: 100,
        },
      },
    ]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /my balance/i }));
    expect(await screen.findByText(/no leave entitlement during probation/i)).toBeInTheDocument();
    expect(screen.getByText(/100 days remaining/i)).toBeInTheDocument();
    expect(screen.getByText('Probation')).toBeInTheDocument();
  });

  it('renders a pro-rated balance breakdown with the policy group name', async () => {
    balanceMock.mockResolvedValue([
      {
        employeeId: 'e1',
        leaveType: 'Annual',
        entitlement: 12,
        used: 3,
        pending: 0,
        available: 9,
        prorated: true,
        policyGroupName: 'Standard',
        proration: {
          hireDate: '2026-04-01',
          fullEntitlement: 20,
          fraction: 0.6,
          remainingDays: 220,
          totalDays: 365,
          proratedEntitlement: 12,
        },
      },
    ]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /my balance/i }));
    expect(await screen.findAllByText('Pro-rated')).toHaveLength(2);
    expect(screen.getAllByText('Standard').length).toBeGreaterThanOrEqual(1);
  });
});

describe('AttendanceLeavePage — manager role gating', () => {
  it('shows the Approvals and Balances tabs for a manager but hides policy management', () => {
    useAuthMock.mockReturnValue(
      makeAuth({
        employee: {
          id: 'e2',
          firstName: 'Bob',
          lastName: 'Report',
          managerId: 'e1',
          departmentId: 'd1',
          departmentName: 'Engineering',
        },
        perms: ['viewTeamAttendance'],
      }),
    );
    balanceMock.mockResolvedValue(balanceFixture);
    render(<AttendanceLeavePage />);
    expect(screen.getByRole('tab', { name: /approvals/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /balances/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /manage policy groups/i })).not.toBeInTheDocument();
  });
});

describe('AttendanceLeavePage — approvals edge cases', () => {
  beforeEach(() => {
    // Default auth grants all permissions (HR/Admin), so the Approvals tab shows.
    listLeaveRequestsMock.mockResolvedValue([approvalRequestFixture]);
  });

  it('shows an empty approvals queue when there are no pending requests', async () => {
    listLeaveRequestsMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /approvals/i }));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  it('shows the attachment filename on an approval row', async () => {
    listLeaveRequestsMock.mockResolvedValue([
      { ...approvalRequestFixture, attachmentFilename: 'cert.pdf' },
    ]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /approvals/i }));
    expect(await screen.findByText('cert.pdf')).toBeInTheDocument();
  });

  it('keeps the request queued when approveLeave returns a non-OK response', async () => {
    approveLeaveMock.mockResolvedValue({ ok: false, error: 'Not authorized' });
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /approvals/i }));
    await screen.findByText(/leave approvals queue/i);
    await user.click(screen.getByRole('button', { name: /approve/i }));
    // The error branch runs; the queue remains and the approve call was made.
    expect(approveLeaveMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/leave approvals queue/i)).toBeInTheDocument();
  });

  it('keeps the request queued when rejectLeave returns a non-OK response', async () => {
    rejectLeaveMock.mockResolvedValue({ ok: false, error: 'Reject failed' });
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('tab', { name: /approvals/i }));
    await screen.findByText(/leave approvals queue/i);
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(rejectLeaveMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/leave approvals queue/i)).toBeInTheDocument();
  });
});

describe('AttendanceLeavePage — leave request validation & submission', () => {
  it('requires a reason for a valid date range', async () => {
    balanceMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /request leave/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Start date *'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('End date *'), { target: { value: '2026-06-12' } });
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/a reason is required/i)).toBeInTheDocument();
    expect(submitLeaveRequestMock).not.toHaveBeenCalled();
  });

  it('blocks submission when the requested days exceed the available balance', async () => {
    // Employee e1 with only 1 available Annual day but requesting 3 days.
    balanceMock.mockResolvedValue([
      {
        employeeId: 'e1',
        leaveType: 'Annual',
        entitlement: 1,
        used: 0,
        pending: 0,
        available: 0,
      },
    ]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /request leave/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Start date *'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('End date *'), { target: { value: '2026-06-12' } });
    fireEvent.change(screen.getByLabelText('Reason *'), { target: { value: 'Vacation' } });
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/insufficient annual leave balance/i)).toBeInTheDocument();
    expect(submitLeaveRequestMock).not.toHaveBeenCalled();
  });

  it('submits a valid request and routes to My leave', async () => {
    balanceMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /request leave/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Start date *'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('End date *'), { target: { value: '2026-06-12' } });
    fireEvent.change(screen.getByLabelText('Reason *'), { target: { value: 'Vacation' } });
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    await waitFor(() => expect(submitLeaveRequestMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the repository error message when submission fails', async () => {
    balanceMock.mockResolvedValue([]);
    submitLeaveRequestMock.mockRejectedValue(new Error('Server unavailable'));
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /request leave/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Start date *'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('End date *'), { target: { value: '2026-06-12' } });
    fireEvent.change(screen.getByLabelText('Reason *'), { target: { value: 'Vacation' } });
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/server unavailable/i)).toBeInTheDocument();
  });
});

describe('AttendanceLeavePage — clock-in failure', () => {
  it('handles a clock-in failure without crashing', async () => {
    clockMock.mockRejectedValue(new Error('Clock service down'));
    const user = userEvent.setup();
    render(<AttendanceLeavePage />);
    await user.click(screen.getByRole('button', { name: /clock in/i }));
    // The rejection is handled in a catch block; the click handler ran.
    expect(clockMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', { name: /my leave/i })).toBeInTheDocument();
  });
});
