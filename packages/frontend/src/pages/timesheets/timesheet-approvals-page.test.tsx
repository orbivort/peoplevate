import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getPendingMock = vi.fn();
const getByIdMock = vi.fn();
const approveMock = vi.fn();
const rejectMock = vi.fn();

vi.mock('@/lib/timesheet-api', () => ({
  timesheetRepo: {
    getPending: (...args: unknown[]) => getPendingMock(...args),
    getById: (...args: unknown[]) => getByIdMock(...args),
    approve: (...args: unknown[]) => approveMock(...args),
    reject: (...args: unknown[]) => rejectMock(...args),
  },
}));

import { TimesheetApprovalsPage } from './timesheet-approvals-page';
import type { TimesheetDetail, TimesheetSummary } from '@/types/timesheet';

const summary: TimesheetSummary = {
  id: 'ts-9',
  employeeId: 'e-002',
  employee: { id: 'e-002', employeeNo: 'EMP-0002', firstName: 'Bob', lastName: 'Report' },
  periodStart: '2026-09-07T00:00:00.000Z',
  periodEnd: '2026-09-13T23:59:59.999Z',
  status: 'SUBMITTED',
  submittedAt: '2026-09-14T08:12:00Z',
  weeklyTotalHours: 38.5,
  entryCount: 5,
};

const detail: TimesheetDetail = {
  ...summary,
  createdAt: '2026-09-07T08:00:00Z',
  updatedAt: '2026-09-14T08:12:00Z',
  entries: [
    {
      id: 'entry-9',
      timesheetId: 'ts-9',
      employeeId: 'e-002',
      entryDate: '2026-09-07',
      projectId: 'p-erp',
      project: { id: 'p-erp', code: 'ERP-001', name: 'ERP Migration', isBillable: true },
      taskId: null,
      task: null,
      hours: 8,
      description: 'Sprint work',
      createdAt: '2026-09-07T08:00:00Z',
      updatedAt: '2026-09-07T08:00:00Z',
    },
  ],
  approvals: [],
  perDayTotals: [{ date: '2026-09-07', hours: 8 }],
  perProjectTotals: [
    { projectId: 'p-erp', projectCode: 'ERP-001', projectName: 'ERP Migration', hours: 8 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getPendingMock.mockResolvedValue([summary]);
  getByIdMock.mockResolvedValue(detail);
  approveMock.mockResolvedValue(detail);
  rejectMock.mockResolvedValue(detail);
});

describe('TimesheetApprovalsPage', () => {
  it('renders the approval queue with the workload summary', async () => {
    render(<TimesheetApprovalsPage />);

    expect(await screen.findByText('Bob Report')).toBeInTheDocument();
    expect(screen.getByText('EMP-0002')).toBeInTheDocument();
    expect(screen.getByText('Sep 7 – Sep 13, 2026')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('5 entries')).toBeInTheDocument();
    expect(screen.getAllByText('38.5h').length).toBeGreaterThan(0);

    const summary = document.querySelector('[data-slot="queue-summary"]');
    expect(summary).toHaveTextContent('Awaiting review');
    expect(summary).toHaveTextContent('Hours in queue');
    expect(summary).toHaveTextContent('38.5h');
    expect(summary).toHaveTextContent('Oldest waiting');
  });

  it('shows an empty state when the queue is empty', async () => {
    getPendingMock.mockResolvedValue([]);
    render(<TimesheetApprovalsPage />);

    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  it('expands a row into the same week ledger the employee filled in', async () => {
    const user = userEvent.setup();
    render(<TimesheetApprovalsPage />);

    await screen.findByText('Bob Report');
    await user.click(screen.getByRole('button', { name: /review timesheet/i }));

    expect(getByIdMock).toHaveBeenCalledWith('ts-9');

    // The review view reuses the ledger shell: Mon–Sun columns, per-project
    // rows, and the same headline summary.
    expect(await screen.findByText('Project / task')).toBeInTheDocument();
    expect(screen.getByText('Week total')).toBeInTheDocument();
    expect(screen.getByText('Daily total')).toBeInTheDocument();
    expect(screen.getAllByText('ERP Migration').length).toBeGreaterThan(0);
    expect(screen.getByText('Approval history')).toBeInTheDocument();
    expect(screen.getByText('Your decision')).toBeInTheDocument();
  });

  it('flags working days the employee left empty before a decision', async () => {
    const user = userEvent.setup();
    render(<TimesheetApprovalsPage />);

    await screen.findByText('Bob Report');
    await user.click(screen.getByRole('button', { name: /review timesheet/i }));

    expect(await screen.findByText(/working days without hours/i)).toBeInTheDocument();
    expect(screen.getByText(/check before approving/i)).toBeInTheDocument();
  });

  it('approves a timesheet with an optional comment and removes it from the queue', async () => {
    const user = userEvent.setup();
    render(<TimesheetApprovalsPage />);

    await screen.findByText('Bob Report');
    await user.click(screen.getByRole('button', { name: /review timesheet/i }));
    await screen.findByText('Project / task');

    fireEvent.change(screen.getByLabelText(/comment \(optional/i), {
      target: { value: 'Looks good' },
    });
    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('ts-9', 'Looks good'));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  it('requires a comment when rejecting', async () => {
    const user = userEvent.setup();
    render(<TimesheetApprovalsPage />);

    await screen.findByText('Bob Report');
    await user.click(screen.getByRole('button', { name: /review timesheet/i }));
    await screen.findByText('Project / task');
    await user.click(screen.getByRole('button', { name: /^reject/i }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /reject timesheet/i }));
    expect(await within(dialog).findByText(/comment is required/i)).toBeInTheDocument();
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it('carries the panel comment into the reject dialog instead of asking twice', async () => {
    const user = userEvent.setup();
    render(<TimesheetApprovalsPage />);

    await screen.findByText('Bob Report');
    await user.click(screen.getByRole('button', { name: /review timesheet/i }));
    await screen.findByText('Project / task');

    fireEvent.change(screen.getByLabelText(/comment \(optional/i), {
      target: { value: 'Please fix Thursday' },
    });
    await user.click(screen.getByRole('button', { name: /^reject/i }));

    const dialog = screen.getByRole('dialog');
    const rejectField = within(dialog).getByLabelText(/comment/i);
    expect(rejectField).toHaveValue('Please fix Thursday');

    await user.click(within(dialog).getByRole('button', { name: /reject timesheet/i }));
    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith('ts-9', 'Please fix Thursday'));
  });

  it('marks the reject field invalid when the carried-over comment is only whitespace', async () => {
    const user = userEvent.setup();
    render(<TimesheetApprovalsPage />);

    await screen.findByText('Bob Report');
    await user.click(screen.getByRole('button', { name: /review timesheet/i }));
    await screen.findByText('Project / task');

    fireEvent.change(screen.getByLabelText(/comment \(optional/i), { target: { value: '   ' } });
    await user.click(screen.getByRole('button', { name: /^reject/i }));

    const dialog = screen.getByRole('dialog');
    const rejectField = within(dialog).getByLabelText(/comment/i);
    await user.click(within(dialog).getByRole('button', { name: /reject timesheet/i }));

    expect(await within(dialog).findByText(/comment is required/i)).toBeInTheDocument();
    expect(rejectField).toHaveAttribute('aria-invalid', 'true');
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it('batch-approves selected timesheets', async () => {
    const user = userEvent.setup();
    render(<TimesheetApprovalsPage />);

    await screen.findByText('Bob Report');
    await user.click(
      screen.getByRole('checkbox', { name: /select bob report's timesheet/i }),
    );
    await user.click(screen.getByRole('button', { name: /approve selected/i }));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('ts-9', undefined));
    expect(await screen.findByText(/approved 1 timesheets?/i)).toBeInTheDocument();
  });
});
