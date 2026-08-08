import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const dashboardState = vi.hoisted(() => ({
  employees: [] as Record<string, unknown>[],
  departments: [] as Record<string, unknown>[],
  positions: [] as Record<string, unknown>[],
  expiryAlerts: [] as Record<string, unknown>[],
  auditLog: [] as Record<string, unknown>[],
  mode: 'mock' as const,
  error: null as string | null,
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/data/data-layer', () => ({
  useEmployees: () => ({
    data: dashboardState.employees,
    mode: dashboardState.mode,
    error: dashboardState.error,
  }),
  useDepartments: () => ({
    data: dashboardState.departments,
    mode: dashboardState.mode,
    error: dashboardState.error,
  }),
  usePositions: () => ({
    data: dashboardState.positions,
    mode: dashboardState.mode,
    error: dashboardState.error,
  }),
  useExpiryAlerts: () => ({
    data: dashboardState.expiryAlerts,
    mode: dashboardState.mode,
    error: dashboardState.error,
  }),
  useAuditLog: () => ({
    data: { logs: dashboardState.auditLog, total: dashboardState.auditLog.length },
    mode: dashboardState.mode,
    error: dashboardState.error,
  }),
}));

import { DashboardPage } from './dashboard-page';

const employees = [
  {
    id: 'e1',
    firstName: 'Alice',
    lastName: 'Admin',
    email: 'alice@acme.com',
    employeeNo: 'E001',
    positionName: 'HR Lead',
    departmentName: 'HR',
    departmentId: 'd1',
    employmentType: 'Full-time',
    status: 'Active' as const,
    hireDate: '2022-01-01',
  },
  {
    id: 'e2',
    firstName: 'Bob',
    lastName: 'Probie',
    email: 'bob@acme.com',
    employeeNo: 'E002',
    positionName: 'Engineer',
    departmentName: 'Eng',
    departmentId: 'd2',
    employmentType: 'Full-time',
    status: 'Probation' as const,
    hireDate: '2025-06-01',
  },
];

const departments = [
  { id: 'd1', name: 'HR', code: 'HR' },
  { id: 'd2', name: 'Engineering', code: 'ENG' },
];

const positions = [
  { id: 'p1', title: 'HR Lead' },
  { id: 'p2', title: 'Engineer' },
];

const alerts = [
  {
    id: 'x1',
    employeeName: 'Carol Expiring',
    documentType: 'Passport',
    severity: 'expired' as const,
    daysUntilExpiry: -3,
    acknowledged: false,
  },
  {
    id: 'x2',
    employeeName: 'Dave Soon',
    documentType: 'Visa',
    severity: 'warning' as const,
    daysUntilExpiry: 12,
    acknowledged: true,
  },
];

const auditEntries = [
  {
    id: 'a1',
    actorName: 'Alice Admin',
    action: 'CREATE',
    entity: 'employees',
    entityLabel: 'Employees',
    entityId: 'e1',
    changes: [{ field: 'name', label: 'name', old: null, new: 'Bob', sensitive: false }],
    timestamp: '2026-01-15T10:00:00.000Z',
  },
];

beforeEach(() => {
  dashboardState.employees = employees;
  dashboardState.departments = departments;
  dashboardState.positions = positions;
  dashboardState.expiryAlerts = alerts;
  dashboardState.auditLog = auditEntries;
  dashboardState.mode = 'mock';
  dashboardState.error = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DashboardPage', () => {
  it('renders nothing when there is no authenticated user', () => {
    useAuthMock.mockReturnValue({
      user: null,
      employee: null,
      hasPermission: vi.fn(() => false),
      canViewEmployee: vi.fn(() => false),
    });
    const { container } = render(<DashboardPage />);
    expect(container).toBeEmptyDOMElement();
  });

  it('greets the user by first name for HR/Admin', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1', role: 'Admin', email: 'alice@acme.com', name: 'Alice' },
      employee: employees[0],
      hasPermission: vi.fn(() => true),
      canViewEmployee: vi.fn(() => true),
    });
    render(<DashboardPage />);
    expect(screen.getByRole('heading', { name: /welcome, alice/i })).toBeInTheDocument();
  });

  it('shows HR/Admin stat cards with aggregated counts', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1', role: 'Admin', email: 'alice@acme.com', name: 'Alice' },
      employee: employees[0],
      hasPermission: vi.fn(() => true),
      canViewEmployee: vi.fn(() => true),
    });
    render(<DashboardPage />);
    expect(screen.getByText('Total employees')).toBeInTheDocument();
    expect(screen.getByText('Departments')).toBeInTheDocument();
    expect(screen.getByText('Expiring documents')).toBeInTheDocument();
    expect(screen.getByText('On probation')).toBeInTheDocument();
    // 2 employees total, 1 on probation
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('counts only unacknowledged expiry alerts', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1', role: 'Admin', email: 'alice@acme.com', name: 'Alice' },
      employee: employees[0],
      hasPermission: vi.fn(() => true),
      canViewEmployee: vi.fn(() => true),
    });
    render(<DashboardPage />);
    // Only 1 of 2 alerts is unacknowledged
    expect(screen.getByText('Document alerts')).toBeInTheDocument();
    expect(screen.getByText('Carol Expiring')).toBeInTheDocument();
    expect(screen.queryByText('Dave Soon')).not.toBeInTheDocument();
  });

  it('renders recent audit activity', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1', role: 'Admin', email: 'alice@acme.com', name: 'Alice' },
      employee: employees[0],
      hasPermission: vi.fn(() => true),
      canViewEmployee: vi.fn(() => true),
    });
    render(<DashboardPage />);
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    expect(screen.getByText(/alice admin/i)).toBeInTheDocument();
  });

  it('shows the "View all" audit link when the user can view the audit log', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1', role: 'Admin', email: 'alice@acme.com', name: 'Alice' },
      employee: employees[0],
      hasPermission: vi.fn(() => true),
      canViewEmployee: vi.fn(() => true),
    });
    render(<DashboardPage />);
    const viewAll = screen.getByRole('link', { name: /view all/i });
    expect(viewAll).toHaveAttribute('href', '/app/audit-log');
  });

  it('hides the "View all" audit link when the user lacks permission', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1', role: 'Employee', email: 'bob@acme.com', name: 'Bob' },
      employee: employees[1],
      hasPermission: vi.fn(() => false),
      canViewEmployee: vi.fn(() => true),
    });
    render(<DashboardPage />);
    expect(screen.queryByRole('link', { name: /view all/i })).not.toBeInTheDocument();
  });

  it('shows a personal employment summary for Employees', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u2', role: 'Employee', email: 'bob@acme.com', name: 'Bob' },
      employee: { ...employees[1], managerName: 'Alice Admin', hireDate: '2023-02-01' },
      hasPermission: vi.fn(() => false),
      canViewEmployee: vi.fn(() => true),
    });
    render(<DashboardPage />);
    expect(screen.getByText('My employment')).toBeInTheDocument();
    expect(screen.getByText('My documents')).toBeInTheDocument();
    expect(screen.getByText('Tenure')).toBeInTheDocument();
    expect(screen.getByText('Reports to')).toBeInTheDocument();
  });

  it('does not render HR-only stat cards for an Employee', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u2', role: 'Employee', email: 'bob@acme.com', name: 'Bob' },
      employee: employees[1],
      hasPermission: vi.fn(() => false),
      canViewEmployee: vi.fn(() => true),
    });
    render(<DashboardPage />);
    expect(screen.queryByText('Total employees')).not.toBeInTheDocument();
    expect(screen.queryByText('Document alerts')).not.toBeInTheDocument();
  });
});
