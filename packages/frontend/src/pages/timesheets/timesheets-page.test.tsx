import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted repository mocks (same pattern as attendance-leave-page.test.tsx).
const getCurrentMock = vi.fn();
const submitMock = vi.fn();
const applyWeekChangesMock = vi.fn();
const listProjectsMock = vi.fn();
const listTasksMock = vi.fn();

vi.mock('@/lib/timesheet-api', () => ({
  timesheetRepo: {
    getCurrent: (...args: unknown[]) => getCurrentMock(...args),
    submit: (...args: unknown[]) => submitMock(...args),
  },
  timesheetEntryRepo: {
    applyWeekChanges: (...args: unknown[]) => applyWeekChangesMock(...args),
  },
  projectRepo: {
    list: (...args: unknown[]) => listProjectsMock(...args),
    listTasks: (...args: unknown[]) => listTasksMock(...args),
  },
}));

import { TimesheetsPage } from './timesheets-page';
import type { TimesheetDetail, TimesheetEntry } from '@/types/timesheet';

const project = {
  id: 'p-erp',
  code: 'ERP-001',
  name: 'ERP Migration',
  description: null,
  client: 'Acme Corp',
  isBillable: true,
  startDate: null,
  endDate: null,
  isActive: true,
  taskCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeEntry(overrides: Partial<TimesheetEntry> = {}): TimesheetEntry {
  return {
    id: 'entry-1',
    timesheetId: 'ts-1',
    employeeId: 'e-006',
    entryDate: '2026-09-14',
    projectId: 'p-erp',
    project: { id: 'p-erp', code: 'ERP-001', name: 'ERP Migration', isBillable: true },
    taskId: null,
    task: null,
    hours: 8,
    description: 'Kick-off',
    createdAt: '2026-09-14T08:00:00Z',
    updatedAt: '2026-09-14T08:00:00Z',
    ...overrides,
  };
}

function makeTimesheet(overrides: Partial<TimesheetDetail> = {}): TimesheetDetail {
  return {
    id: 'ts-1',
    employeeId: 'e-006',
    employee: { id: 'e-006', employeeNo: 'EMP-0006', firstName: 'Charlie', lastName: 'Doe' },
    periodStart: '2026-09-14T00:00:00.000Z',
    periodEnd: '2026-09-20T23:59:59.999Z',
    status: 'DRAFT',
    submittedAt: null,
    weeklyTotalHours: 10.5,
    entryCount: 2,
    createdAt: '2026-09-14T08:00:00Z',
    updatedAt: '2026-09-16T08:00:00Z',
    entries: [
      makeEntry(),
      makeEntry({
        id: 'entry-2',
        entryDate: '2026-09-16',
        projectId: 'p-web',
        project: { id: 'p-web', code: 'WEB-002', name: 'Website Redesign', isBillable: true },
        hours: 2.5,
        description: null,
      }),
    ],
    approvals: [],
    perDayTotals: [
      { date: '2026-09-14', hours: 8 },
      { date: '2026-09-16', hours: 2.5 },
    ],
    perProjectTotals: [
      { projectId: 'p-erp', projectCode: 'ERP-001', projectName: 'ERP Migration', hours: 8 },
      { projectId: 'p-web', projectCode: 'WEB-002', projectName: 'Website Redesign', hours: 2.5 },
    ],
    ...overrides,
  };
}

/** The grid renders a desktop and a mobile variant; the first match is desktop. */
function cell(projectName: string, dateLabel: string): HTMLElement {
  const [input] = screen.getAllByLabelText(`Hours for ${projectName} on ${dateLabel}`);
  if (!input) throw new Error(`No hour input for ${projectName} on ${dateLabel}`);
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentMock.mockResolvedValue(makeTimesheet());
  submitMock.mockResolvedValue(makeTimesheet({ status: 'SUBMITTED' }));
  applyWeekChangesMock.mockResolvedValue(makeTimesheet({ updatedAt: '2026-09-16T09:00:00Z' }));
  listProjectsMock.mockResolvedValue([project]);
  listTasksMock.mockResolvedValue([]);
});

describe('TimesheetsPage', () => {
  it('renders the week as an editable grid with live weekly totals', async () => {
    render(<TimesheetsPage />);

    expect(await screen.findByText('Sep 14 – Sep 20, 2026')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();

    // Both projects are rows of the week grid with their hours pre-filled.
    await screen.findAllByText('ERP Migration');
    expect(cell('ERP Migration', 'Mon, Sep 14')).toHaveValue('8');
    expect(cell('Website Redesign', 'Wed, Sep 16')).toHaveValue('2.5');
    expect(screen.getAllByText('Website Redesign').length).toBeGreaterThan(0);

    // Weekly summary: every total is derived from the grid.
    const summary = document.querySelector('[data-slot="week-summary"]');
    expect(summary).toHaveTextContent('Week total');
    expect(summary).toHaveTextContent('10.5h');
    expect(summary).toHaveTextContent('8h');
    expect(summary).toHaveTextContent('2.5h');

    expect(getCurrentMock).toHaveBeenCalledTimes(1);
  });

  it('saves the whole week in one action and reports only the changed cells', async () => {
    const user = userEvent.setup();
    render(<TimesheetsPage />);

    await screen.findAllByText('ERP Migration');
    fireEvent.change(cell('ERP Migration', 'Mon, Sep 14'), { target: { value: '6' } });
    fireEvent.change(cell('ERP Migration', 'Tue, Sep 15'), { target: { value: '4' } });

    expect(screen.getByText('Unsaved')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save week/i }));

    await waitFor(() =>
      expect(applyWeekChangesMock).toHaveBeenCalledWith([
        {
          projectId: 'p-erp',
          taskId: null,
          entryDate: '2026-09-14',
          hours: 6,
          entryIds: ['entry-1'],
        },
        {
          projectId: 'p-erp',
          taskId: null,
          entryDate: '2026-09-15',
          hours: 4,
          entryIds: [],
        },
      ]),
    );
    expect(await screen.findByText(/saved 2 cells/i)).toBeInTheDocument();
    // The draft is re-seeded from the saved week, so it is no longer dirty.
    await waitFor(() => expect(screen.queryByText('Unsaved')).not.toBeInTheDocument());
  });

  it('deletes an entry by clearing its cell and saving', async () => {
    const user = userEvent.setup();
    render(<TimesheetsPage />);

    await screen.findAllByText('ERP Migration');
    fireEvent.change(cell('Website Redesign', 'Wed, Sep 16'), { target: { value: '' } });

    await user.click(screen.getByRole('button', { name: /save week/i }));

    await waitFor(() =>
      expect(applyWeekChangesMock).toHaveBeenCalledWith([
        {
          projectId: 'p-web',
          taskId: null,
          entryDate: '2026-09-16',
          hours: 0,
          entryIds: ['entry-2'],
        },
      ]),
    );
    expect(await screen.findByText(/entry saved/i)).toBeInTheDocument();
  });

  it('blocks saving when a day exceeds 24 hours', async () => {
    render(<TimesheetsPage />);

    await screen.findAllByText('ERP Migration');
    fireEvent.change(cell('ERP Migration', 'Mon, Sep 14'), { target: { value: '20' } });
    fireEvent.change(cell('Website Redesign', 'Mon, Sep 14'), { target: { value: '6' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/exceed the 24h limit/i);
    expect(screen.getByRole('button', { name: /save week/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /submit week/i })).toBeDisabled();
  });

  it('opens the submit dialog with a totals recap and confirms submission', async () => {
    const user = userEvent.setup();
    render(<TimesheetsPage />);

    await screen.findAllByText('ERP Migration');
    await user.click(screen.getByRole('button', { name: /submit week/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/weekly total/i)).toBeInTheDocument();
    expect(within(dialog).getByText('10.5h')).toBeInTheDocument();
    expect(within(dialog).getByText('ERP Migration')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /submit for approval/i }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledWith('ts-1'));
    expect(await screen.findByText(/submitted for approval/i)).toBeInTheDocument();
  });

  it('warns about working days with zero hours in the grid and the dialog', async () => {
    const user = userEvent.setup();
    render(<TimesheetsPage />);

    await screen.findAllByText('ERP Migration');
    expect(screen.getByText(/working days without hours/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /submit week/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/working days without logged hours/i)).toBeInTheDocument();
  });

  it('guards week navigation while the grid has unsaved edits', async () => {
    const user = userEvent.setup();
    render(<TimesheetsPage />);

    await screen.findAllByText('ERP Migration');
    const previous = screen.getByRole('button', { name: 'Previous week' });
    expect(previous).toBeEnabled();

    // Without edits the week switches immediately.
    await user.click(previous);
    await waitFor(() => expect(getCurrentMock).toHaveBeenCalledTimes(2));

    await screen.findAllByText('ERP Migration');
    fireEvent.change(cell('ERP Migration', 'Mon, Sep 14'), { target: { value: '6' } });
    await user.click(screen.getByRole('button', { name: 'Next week' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/discard unsaved changes/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /keep editing/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getCurrentMock).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    const confirmDialog = await screen.findByRole('dialog');
    await user.click(
      within(confirmDialog).getByRole('button', { name: /discard and switch week/i }),
    );
    await waitFor(() => expect(getCurrentMock).toHaveBeenCalledTimes(3));
  });

  it('locks the grid while the timesheet is submitted', async () => {
    getCurrentMock.mockResolvedValue(
      makeTimesheet({ status: 'SUBMITTED', submittedAt: '2026-09-17T08:00:00Z' }),
    );

    render(<TimesheetsPage />);

    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(cell('ERP Migration', 'Mon, Sep 14')).toBeDisabled();
    expect(
      screen.getByText(/entries are locked while the timesheet is submitted/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Add project row')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit week/i })).toBeDisabled();
  });

  it('shows the rejected banner with the manager comment and unlocked editing', async () => {
    getCurrentMock.mockResolvedValue(
      makeTimesheet({
        status: 'REJECTED',
        submittedAt: '2026-09-17T08:00:00Z',
        approvals: [
          {
            id: 'ap-1',
            action: 'REJECT',
            comment: 'Tuesday is missing — please add it.',
            approverId: 'u-mgr',
            approverEmail: 'marcus.manager@peoplevate.io',
            createdAt: '2026-09-17T14:03:00Z',
          },
        ],
      }),
    );

    render(<TimesheetsPage />);

    expect(await screen.findByText(/rejected by marcus\.manager@peoplevate\.io/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Tuesday is missing — please add it\./i).length).toBeGreaterThan(0);
    // Editing is unlocked.
    expect(cell('ERP Migration', 'Mon, Sep 14')).toBeEnabled();
    expect(screen.getByText('Approval history')).toBeInTheDocument();
  });

  it('surfaces a 400 week-window notice when the API rejects an older week', async () => {
    const { ApiError } = await import('@/lib/api-client');
    getCurrentMock.mockRejectedValue(new ApiError(400, 'Week out of range'));

    render(<TimesheetsPage />);

    expect(
      await screen.findByText(/only the current and previous week are available/i),
    ).toBeInTheDocument();
  });
});
