import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listTasksMock = vi.fn();

vi.mock('@/lib/timesheet-api', () => ({
  projectRepo: {
    listTasks: (...args: unknown[]) => listTasksMock(...args),
  },
}));

import { WeekTimesheetEditor } from './week-timesheet-editor';
import type { Project, TimesheetDetail, TimesheetEntry } from '@/types/timesheet';

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
    description: null,
    createdAt: '2026-09-14T08:00:00Z',
    updatedAt: '2026-09-14T08:00:00Z',
    ...overrides,
  };
}

const erpProject: Project = {
  id: 'p-erp',
  code: 'ERP-001',
  name: 'ERP Migration',
  description: null,
  client: null,
  isBillable: true,
  startDate: null,
  endDate: null,
  isActive: true,
  taskCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const webProject: Project = {
  ...erpProject,
  id: 'p-web',
  code: 'WEB-002',
  name: 'Website Redesign',
  isBillable: false,
};

const timesheet: TimesheetDetail = {
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
      project: { id: 'p-web', code: 'WEB-002', name: 'Website Redesign', isBillable: false },
      hours: 2.5,
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
};

interface RenderOptions {
  editable?: boolean;
  saving?: boolean;
  projects?: Project[];
  onSave?: (changes: unknown[]) => Promise<void>;
  onSubmit?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function renderEditor(options: RenderOptions = {}) {
  const onSave = options.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onSubmit = options.onSubmit ?? vi.fn();
  const onDirtyChange = options.onDirtyChange ?? vi.fn();
  render(
    <WeekTimesheetEditor
      timesheet={timesheet}
      projects={options.projects ?? [erpProject, webProject]}
      editable={options.editable ?? true}
      saving={options.saving ?? false}
      onSave={onSave}
      onSubmit={onSubmit}
      onDirtyChange={onDirtyChange}
    />,
  );
  return { onSave, onSubmit, onDirtyChange };
}

/** The grid renders a desktop and a mobile variant; the first match is desktop. */
function cell(project: string, dateLabel: string, taskName: string | null = null): HTMLElement {
  const label = `Hours for ${project}${taskName ? ` (${taskName})` : ''} on ${dateLabel}`;
  const [input] = screen.getAllByLabelText(label);
  if (!input) throw new Error(`No hour input rendered for ${label}`);
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  listTasksMock.mockResolvedValue([
    { id: 't-impl', projectId: 'p-web', name: 'Implementation', isActive: true },
  ]);
});

describe('WeekTimesheetEditor', () => {
  it('renders the whole week with one row per project and the loaded hours', () => {
    renderEditor();

    expect(screen.getByText('Project / task')).toBeInTheDocument();
    expect(screen.getByText('Week total')).toBeInTheDocument();
    // Project names appear in the row header, the mobile ledger, and the summary.
    expect(screen.getAllByText('ERP Migration').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Website Redesign').length).toBeGreaterThan(0);

    // Seven day columns, three of them (Mon/Tue/Wed) repeated in each layout.
    expect(screen.getAllByText('Mon').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sun').length).toBeGreaterThan(0);

    expect(cell('ERP Migration', 'Mon, Sep 14')).toHaveValue('8');
    expect(cell('Website Redesign', 'Wed, Sep 16')).toHaveValue('2.5');
    expect(cell('ERP Migration', 'Tue, Sep 15')).toHaveValue('');
  });

  it('saves only the changed cells and reports the dirty state', async () => {
    const user = userEvent.setup();
    const { onSave, onDirtyChange } = renderEditor();

    fireEvent.change(cell('ERP Migration', 'Mon, Sep 14'), { target: { value: '6' } });
    fireEvent.change(cell('ERP Migration', 'Tue, Sep 15'), { target: { value: '4' } });

    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    await user.click(screen.getByRole('button', { name: /save week/i }));

    expect(onSave).toHaveBeenCalledWith([
      {
        rowId: 'p-erp|',
        projectId: 'p-erp',
        taskId: null,
        date: '2026-09-14',
        hours: 6,
        entryIds: ['entry-1'],
      },
      {
        rowId: 'p-erp|',
        projectId: 'p-erp',
        taskId: null,
        date: '2026-09-15',
        hours: 4,
        entryIds: [],
      },
    ]);
  });

  it('clears a cell so the entry is deleted on save', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    fireEvent.change(cell('ERP Migration', 'Mon, Sep 14'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: /save week/i }));

    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ date: '2026-09-14', hours: 0, entryIds: ['entry-1'] }),
    ]);
  });

  it('discards unsaved edits', async () => {
    const user = userEvent.setup();
    renderEditor();

    fireEvent.change(cell('ERP Migration', 'Mon, Sep 14'), { target: { value: '3' } });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /discard/i }));
    expect(cell('ERP Migration', 'Mon, Sep 14')).toHaveValue('8');
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();
  });

  it('blocks the day cap and explains why', () => {
    renderEditor();

    fireEvent.change(cell('ERP Migration', 'Mon, Sep 14'), { target: { value: '20' } });
    fireEvent.change(cell('Website Redesign', 'Mon, Sep 14'), { target: { value: '6' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/exceed the 24h limit/i);
    expect(screen.getByRole('button', { name: /save week/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /submit week/i })).toBeDisabled();
  });

  it('marks unparseable input as invalid', () => {
    renderEditor();

    const input = cell('ERP Migration', 'Tue, Sep 15');
    fireEvent.change(input, { target: { value: 'soon' } });

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(/cells need attention/i);
    expect(screen.getByRole('button', { name: /save week/i })).toBeDisabled();
  });

  it('requires a saved week before submitting', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEditor();

    const submit = screen.getByRole('button', { name: /submit week/i });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.change(cell('ERP Migration', 'Tue, Sep 15'), { target: { value: '4' } });
    expect(screen.getByRole('button', { name: /submit week/i })).toBeDisabled();
    expect(screen.getByText(/save your changes before submitting/i)).toBeInTheDocument();
  });

  it('adds a project row (with a task) ready for hours', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.selectOptions(screen.getByLabelText('Add project row'), 'p-web');
    await waitFor(() => expect(listTasksMock).toHaveBeenCalledWith('p-web'));

    await user.selectOptions(screen.getByLabelText('Task for new row'), 't-impl');
    await user.click(screen.getByRole('button', { name: /add row/i }));

    const input = cell('Website Redesign', 'Mon, Sep 14', 'Implementation');
    fireEvent.change(input, { target: { value: '2' } });
    expect(input).toHaveValue('2');
    // The row is new, so there is no server entry behind the cell yet.
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('hides row editing and inputs when the timesheet is locked', () => {
    renderEditor({ editable: false });

    expect(cell('ERP Migration', 'Mon, Sep 14')).toBeDisabled();
    expect(
      screen.getByText(/entries are locked while the timesheet is submitted/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Add project row')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save week/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /submit week/i })).toBeDisabled();
  });

  it('switches the mobile day ledger through the day chips', async () => {
    const user = userEvent.setup();
    renderEditor();

    const chip = screen.getAllByRole('button', { name: 'Show Tue, Sep 15' })[0];
    if (!chip) throw new Error('day chip not rendered');
    await user.click(chip);

    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});
