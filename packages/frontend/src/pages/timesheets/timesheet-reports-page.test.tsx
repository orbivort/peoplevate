import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listProjectsMock = vi.fn();
const summaryMock = vi.fn();
const detailsMock = vi.fn();
const exportCsvMock = vi.fn();

vi.mock('@/lib/timesheet-api', () => ({
  projectRepo: {
    list: (...args: unknown[]) => listProjectsMock(...args),
  },
  timesheetReportRepo: {
    summary: (...args: unknown[]) => summaryMock(...args),
    details: (...args: unknown[]) => detailsMock(...args),
    exportCsv: (...args: unknown[]) => exportCsvMock(...args),
  },
}));

const employeesState = vi.hoisted(() => ({
  employees: [] as { id: string; firstName: string; lastName: string; employeeNo: string }[],
}));
const departmentsState = vi.hoisted(() => ({
  departments: [] as { id: string; name: string }[],
}));

vi.mock('@/data/data-layer', () => ({
  useEmployees: () => ({ data: employeesState.employees, mode: 'mock', error: null }),
  useDepartments: () => ({ data: departmentsState.departments, mode: 'mock', error: null }),
}));

import { TimesheetReportsPage } from './timesheet-reports-page';

beforeEach(() => {
  vi.clearAllMocks();
  employeesState.employees = [
    { id: 'e-006', firstName: 'Charlie', lastName: 'Doe', employeeNo: 'EMP-0006' },
  ];
  departmentsState.departments = [{ id: 'd-eng', name: 'Engineering' }];
  listProjectsMock.mockResolvedValue([
    {
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
    },
  ]);
  summaryMock.mockResolvedValue({
    rows: [
      {
        employeeId: 'e-006',
        employeeNo: 'EMP-0006',
        employeeName: 'Charlie Doe',
        departmentId: 'd-eng',
        departmentName: 'Engineering',
        totalHours: 152,
        billableHours: 120,
        entryCount: 19,
      },
    ],
    groupBy: 'employee',
    from: '2026-09-01',
    to: '2026-09-30',
    includeAllStatuses: false,
  });
  detailsMock.mockResolvedValue({
    entries: [
      {
        id: 'entry-1',
        timesheetId: 'ts-1',
        employeeId: 'e-006',
        employeeName: 'Charlie Doe',
        timesheetStatus: 'APPROVED',
        entryDate: '2026-09-14',
        projectId: 'p-erp',
        project: { id: 'p-erp', code: 'ERP-001', name: 'ERP Migration', isBillable: true },
        taskId: null,
        task: null,
        hours: 8,
        description: 'Sprint work',
        createdAt: '2026-09-14T08:00:00Z',
        updatedAt: '2026-09-14T08:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  exportCsvMock.mockResolvedValue(undefined);
});

describe('TimesheetReportsPage', () => {
  it('renders the filter bar with employee, department, and project selects', async () => {
    render(<TimesheetReportsPage />);

    expect(screen.getByRole('heading', { name: /timesheet reports/i })).toBeInTheDocument();
    expect(screen.getByLabelText('From *')).toBeInTheDocument();
    expect(screen.getByLabelText('To *')).toBeInTheDocument();

    await waitFor(() => {
      const employeeSelect = screen.getByLabelText('Employee') as HTMLSelectElement;
      expect([...employeeSelect.options].some((o) => o.text.includes('Charlie Doe'))).toBe(true);
      const departmentSelect = screen.getByLabelText('Department') as HTMLSelectElement;
      expect([...departmentSelect.options].some((o) => o.text === 'Engineering')).toBe(true);
      const projectSelect = screen.getByLabelText('Project') as HTMLSelectElement;
      expect([...projectSelect.options].some((o) => o.text.includes('ERP-001'))).toBe(true);
    });
  });

  it('requires both date bounds and a valid range', async () => {
    const user = userEvent.setup();
    render(<TimesheetReportsPage />);

    fireEvent.change(screen.getByLabelText('From *'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: /run report/i }));
    expect(await screen.findByText(/from and to dates are required/i)).toBeInTheDocument();
    expect(summaryMock).not.toHaveBeenCalled();
  });

  it('runs the summary report and renders grouped rows', async () => {
    const user = userEvent.setup();
    render(<TimesheetReportsPage />);

    await user.click(screen.getByRole('button', { name: /run report/i }));

    await waitFor(() => expect(summaryMock).toHaveBeenCalledTimes(1));
    expect(summaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.any(String),
        to: expect.any(String),
        groupBy: 'employee',
      }),
    );
    expect(await screen.findByText('Charlie Doe')).toBeInTheDocument();
    expect(screen.getByText('152h')).toBeInTheDocument();
    expect(screen.getByText('120h')).toBeInTheDocument();
  });

  it('switches grouping via the tabs', async () => {
    const user = userEvent.setup();
    render(<TimesheetReportsPage />);

    await user.click(screen.getByRole('button', { name: /by project/i }));
    await user.click(screen.getByRole('button', { name: /run report/i }));

    await waitFor(() =>
      expect(summaryMock).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'project' })),
    );
  });

  it('loads paged details on the Details tab', async () => {
    const user = userEvent.setup();
    render(<TimesheetReportsPage />);

    await user.click(screen.getByRole('button', { name: /run report/i }));
    await screen.findByText('Charlie Doe');
    await user.click(screen.getByRole('tab', { name: /details/i }));

    await waitFor(() => expect(detailsMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Sprint work')).toBeInTheDocument();
    expect(screen.getAllByText('ERP-001 — ERP Migration').length).toBeGreaterThan(0); // details row + project filter option
    // The summary is split across nested spans inside the pagination control.
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'SPAN' && element.textContent === 'Showing 1–1 of 1',
      ),
    ).toBeInTheDocument();
  });

  it('exports the CSV with the applied filters', async () => {
    const user = userEvent.setup();
    render(<TimesheetReportsPage />);

    const exportButton = screen.getByRole('button', { name: /export csv/i });
    expect(exportButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /run report/i }));
    await screen.findByText('Charlie Doe');
    await user.click(exportButton);

    await waitFor(() => expect(exportCsvMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/csv export downloaded/i)).toBeInTheDocument();
  });
});
