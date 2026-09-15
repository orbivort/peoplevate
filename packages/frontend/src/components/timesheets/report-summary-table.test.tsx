import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReportSummaryTable } from './report-summary-table';
import type { DepartmentReportRow, EmployeeReportRow, ProjectReportRow } from '@/types/timesheet';

const employeeRows: EmployeeReportRow[] = [
  {
    employeeId: 'e-alice',
    employeeNo: 'EMP-001',
    employeeName: 'Alice Anderson',
    departmentId: 'd-eng',
    departmentName: 'Engineering',
    totalHours: 40,
    billableHours: 32,
    entryCount: 5,
  },
  {
    employeeId: 'e-bob',
    employeeNo: 'EMP-002',
    employeeName: 'Bob Brown',
    // No department assigned — the table must fall back to an em dash.
    departmentId: null,
    departmentName: null,
    totalHours: 10,
    billableHours: 0,
    entryCount: 2,
  },
];

const projectRows: ProjectReportRow[] = [
  {
    projectId: 'p-web',
    projectCode: 'WEB-002',
    projectName: 'Website Redesign',
    isBillable: true,
    totalHours: 20,
    entryCount: 3,
  },
  {
    projectId: 'p-int',
    projectCode: 'INT-001',
    projectName: 'Internal Tooling',
    isBillable: false,
    totalHours: 5,
    entryCount: 1,
  },
];

const departmentRows: DepartmentReportRow[] = [
  {
    departmentId: 'd-eng',
    departmentName: 'Engineering',
    employeeCount: 3,
    totalHours: 50,
    entryCount: 12,
  },
  {
    departmentId: 'd-mkt',
    departmentName: 'Marketing',
    employeeCount: 1,
    totalHours: 5,
    entryCount: 1,
  },
];

describe('ReportSummaryTable', () => {
  describe('employee grouping', () => {
    it('renders employee-specific column headers plus the shared distribution column', () => {
      render(<ReportSummaryTable rows={employeeRows} groupBy="employee" />);

      expect(screen.getAllByRole('columnheader')).toHaveLength(6);
      for (const name of ['Employee', 'Department', 'Total hours', 'Billable', 'Entries']) {
        expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
      }
      expect(screen.getByRole('columnheader', { name: 'Distribution' })).toBeInTheDocument();
      // Columns belonging to other groupings must not leak through.
      expect(screen.queryByRole('columnheader', { name: 'Project' })).not.toBeInTheDocument();
    });

    it('renders one row per employee with name, number, department and totals', () => {
      render(<ReportSummaryTable rows={employeeRows} groupBy="employee" />);

      const aliceRow = screen.getByText('Alice Anderson').closest('tr');
      expect(aliceRow).not.toBeNull();
      expect(within(aliceRow as HTMLElement).getByText('EMP-001')).toBeInTheDocument();
      expect(within(aliceRow as HTMLElement).getByText('Engineering')).toBeInTheDocument();
      expect(within(aliceRow as HTMLElement).getByText('40h')).toBeInTheDocument();
      expect(within(aliceRow as HTMLElement).getByText('32h')).toBeInTheDocument();
      expect(within(aliceRow as HTMLElement).getByText('5')).toBeInTheDocument();

      const bobRow = screen.getByText('Bob Brown').closest('tr');
      expect(within(bobRow as HTMLElement).getByText('EMP-002')).toBeInTheDocument();
      expect(within(bobRow as HTMLElement).getByText('10h')).toBeInTheDocument();
      expect(within(bobRow as HTMLElement).getByText('0h')).toBeInTheDocument();
      expect(within(bobRow as HTMLElement).getByText('2')).toBeInTheDocument();
    });

    it('falls back to an em dash when the employee has no department', () => {
      render(<ReportSummaryTable rows={employeeRows} groupBy="employee" />);

      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('scales each distribution bar against the largest total', () => {
      render(<ReportSummaryTable rows={employeeRows} groupBy="employee" />);

      // maxHours = 40 → 40/40 = 100% and 10/40 = 25%.
      expect(screen.getByTitle('40h')).toHaveStyle({ width: '100%' });
      expect(screen.getByTitle('10h')).toHaveStyle({ width: '25%' });
    });

    it('always colours employee bars as billable', () => {
      render(<ReportSummaryTable rows={employeeRows} groupBy="employee" />);

      expect(screen.getByTitle('40h')).toHaveClass('bg-accent-500');
      expect(screen.getByTitle('10h')).toHaveClass('bg-accent-500');
    });
  });

  describe('project grouping', () => {
    it('renders project-specific column headers', () => {
      render(<ReportSummaryTable rows={projectRows} groupBy="project" />);

      expect(screen.getAllByRole('columnheader')).toHaveLength(5);
      for (const name of ['Project', 'Billable', 'Total hours', 'Entries', 'Distribution']) {
        expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
      }
      expect(screen.queryByRole('columnheader', { name: 'Employee' })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Employees' })).not.toBeInTheDocument();
    });

    it('renders the project code badge, name and totals', () => {
      render(<ReportSummaryTable rows={projectRows} groupBy="project" />);

      const webRow = screen.getByText('Website Redesign').closest('tr') as HTMLElement;
      expect(within(webRow).getByText('WEB-002')).toHaveClass('bg-ink-900', 'font-mono');
      expect(within(webRow).getByText('20h')).toBeInTheDocument();
      expect(within(webRow).getByText('3')).toBeInTheDocument();

      const intRow = screen.getByText('Internal Tooling').closest('tr') as HTMLElement;
      expect(within(intRow).getByText('INT-001')).toBeInTheDocument();
      expect(within(intRow).getByText('5h')).toBeInTheDocument();
      expect(within(intRow).getByText('1')).toBeInTheDocument();
    });

    it('distinguishes billable from non-billable projects', () => {
      render(<ReportSummaryTable rows={projectRows} groupBy="project" />);

      const webRow = screen.getByText('Website Redesign').closest('tr') as HTMLElement;
      const billableBadge = within(webRow).getByText('Billable');
      expect(billableBadge).toHaveClass('bg-accent-100', 'text-accent-800');

      const intRow = screen.getByText('Internal Tooling').closest('tr') as HTMLElement;
      const nonBillableBadge = within(intRow).getByText('Non-billable');
      expect(nonBillableBadge).toHaveClass('border-ink-300', 'text-ink-500');
    });

    it('colours the bar according to the project billable flag and scales it', () => {
      render(<ReportSummaryTable rows={projectRows} groupBy="project" />);

      // maxHours = 20.
      const billableBar = screen.getByTitle('20h');
      expect(billableBar).toHaveClass('bg-accent-500');
      expect(billableBar).toHaveStyle({ width: '100%' });

      const nonBillableBar = screen.getByTitle('5h');
      expect(nonBillableBar).toHaveClass('bg-ink-400');
      expect(nonBillableBar).toHaveStyle({ width: '25%' });
    });
  });

  describe('department grouping', () => {
    it('renders department-specific column headers', () => {
      render(<ReportSummaryTable rows={departmentRows} groupBy="department" />);

      expect(screen.getAllByRole('columnheader')).toHaveLength(5);
      for (const name of ['Department', 'Employees', 'Total hours', 'Entries', 'Distribution']) {
        expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
      }
      expect(screen.queryByRole('columnheader', { name: 'Project' })).not.toBeInTheDocument();
    });

    it('renders department totals with the employee count', () => {
      render(<ReportSummaryTable rows={departmentRows} groupBy="department" />);

      const engRow = screen.getByText('Engineering').closest('tr') as HTMLElement;
      expect(within(engRow).getByText('3')).toBeInTheDocument();
      expect(within(engRow).getByText('50h')).toBeInTheDocument();
      expect(within(engRow).getByText('12')).toBeInTheDocument();

      const mktRow = screen.getByText('Marketing').closest('tr') as HTMLElement;
      expect(within(mktRow).getByText('5h')).toBeInTheDocument();
    });

    it('scales department bars against the largest total', () => {
      render(<ReportSummaryTable rows={departmentRows} groupBy="department" />);

      // maxHours = 50 → 50/50 = 100% and 5/50 = 10%.
      expect(screen.getByTitle('50h')).toHaveStyle({ width: '100%' });
      expect(screen.getByTitle('5h')).toHaveStyle({ width: '10%' });
    });
  });

  describe('empty state', () => {
    it('shows a full-width placeholder message when there are no rows', () => {
      render(<ReportSummaryTable rows={[]} groupBy="employee" />);

      const message = screen.getByText('No data for the selected filters.');
      expect(message).toBeInTheDocument();
      expect(message.closest('td')).toHaveAttribute('colspan', '6');
    });

    it('renders only the header row and the placeholder when empty', () => {
      render(<ReportSummaryTable rows={[]} groupBy="project" />);

      // One header row plus the single placeholder row.
      expect(screen.getAllByRole('row')).toHaveLength(2);
      expect(screen.getByText('No data for the selected filters.').closest('td')).toHaveAttribute(
        'colspan',
        '6',
      );
    });

    it('shows the placeholder for every grouping dimension', () => {
      for (const groupBy of ['employee', 'project', 'department'] as const) {
        const { unmount } = render(<ReportSummaryTable rows={[]} groupBy={groupBy} />);
        expect(screen.getByText('No data for the selected filters.')).toBeInTheDocument();
        unmount();
      }
    });
  });

  describe('distribution bar edge cases', () => {
    it('renders a zero-width bar when every total is zero', () => {
      const zeroRows: EmployeeReportRow[] = [
        { ...employeeRows[0]!, employeeId: 'e-zero', employeeName: 'Zero Hours', totalHours: 0 },
      ];

      render(<ReportSummaryTable rows={zeroRows} groupBy="employee" />);

      const bar = screen.getByTitle('0h');
      expect(bar).toHaveStyle({ width: '0%' });
    });

    it('labels the bar with the two-decimal rounded hours', () => {
      const fractionalRows: EmployeeReportRow[] = [
        { ...employeeRows[0]!, employeeId: 'e-a', employeeName: 'A', totalHours: 7.5 },
        { ...employeeRows[1]!, employeeId: 'e-b', employeeName: 'B', totalHours: 7.555 },
      ];

      render(<ReportSummaryTable rows={fractionalRows} groupBy="employee" />);

      // formatHours rounds to two decimals and drops trailing zeros.
      expect(screen.getByTitle('7.5h')).toBeInTheDocument();
      expect(screen.getByTitle('7.56h')).toBeInTheDocument();
      // maxHours = 7.555 → 7.5 / 7.555 ≈ 99.27%.
      expect(screen.getByTitle('7.5h').style.width).toMatch(/^99\.2\d*%$/);
    });
  });
});
