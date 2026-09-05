import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const navigateMock = vi.fn();
const listState = vi.hoisted(() => ({
  employees: [] as Record<string, unknown>[],
  departments: [] as Record<string, unknown>[],
  error: null as string | null,
  mode: 'live' as const,
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
  useNavigate: () => navigateMock,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange: (v: string) => void;
    value: string;
  }) => (
    <select data-testid="select" value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder: string }) => (
    <option value="">{placeholder}</option>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock('@/data/data-layer', () => ({
  useEmployees: () => ({ data: listState.employees, error: listState.error, mode: listState.mode }),
  useDepartments: () => ({
    data: listState.departments,
    error: listState.error,
    mode: listState.mode,
  }),
}));

import { EmployeeListPage } from './employee-list-page';

const employees = [
  {
    id: 'e1',
    firstName: 'Alice',
    lastName: 'Admin',
    email: 'alice@example.com',
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
    email: 'bob@example.com',
    employeeNo: 'E002',
    positionName: 'Engineer',
    departmentName: 'Engineering',
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

const makeAuth = (overrides: Record<string, unknown> = {}) => ({
  user: { id: 'u1', role: 'Admin', email: 'alice@example.com' },
  hasPermission: vi.fn(() => true),
  canViewEmployee: vi.fn(() => true),
  ...overrides,
});

beforeEach(() => {
  listState.employees = employees;
  listState.departments = departments;
  listState.error = null;
  listState.mode = 'live';
  navigateMock.mockReset();
  useAuthMock.mockReturnValue(makeAuth());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EmployeeListPage', () => {
  it('renders the heading and all employee cards', () => {
    render(<EmployeeListPage />);
    expect(screen.getByRole('heading', { name: /employees/i })).toBeInTheDocument();
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob Probie')).toBeInTheDocument();
  });

  it('shows the "Add employee" button for HR/Admin and navigates on click', async () => {
    const user = userEvent.setup();
    render(<EmployeeListPage />);
    const addBtn = screen.getByRole('button', { name: /add employee/i });
    expect(addBtn).toBeInTheDocument();
    await user.click(addBtn);
    expect(navigateMock).toHaveBeenCalledWith('/app/employees/new');
  });

  it('filters employees by search query', async () => {
    const user = userEvent.setup();
    render(<EmployeeListPage />);
    const search = screen.getByPlaceholderText(/search by name, email, id/i);
    await user.type(search, 'Bob');
    await waitFor(() => expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument());
    expect(screen.getByText('Bob Probie')).toBeInTheDocument();
  });

  it('filters employees by status', async () => {
    const user = userEvent.setup();
    render(<EmployeeListPage />);
    const statusSelect = screen.getByDisplayValue('All statuses');
    await user.selectOptions(statusSelect, 'Probation');
    await waitFor(() => expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument());
    expect(screen.getByText('Bob Probie')).toBeInTheDocument();
  });

  it('filters employees by department', async () => {
    const user = userEvent.setup();
    render(<EmployeeListPage />);
    const deptSelect = screen.getByDisplayValue('All departments');
    await user.selectOptions(deptSelect, 'd1');
    await waitFor(() => expect(screen.queryByText('Bob Probie')).not.toBeInTheDocument());
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
  });

  it('clears active filters when the Clear button is clicked', async () => {
    const user = userEvent.setup();
    render(<EmployeeListPage />);
    const search = screen.getByPlaceholderText(/search by name, email, id/i);
    await user.type(search, 'Bob');
    await waitFor(() => expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
  });

  it('renders an empty state when no employees match', async () => {
    listState.employees = [];
    render(<EmployeeListPage />);
    expect(await screen.findByText(/no employees found/i)).toBeInTheDocument();
  });

  it('shows an error banner when the data request fails', () => {
    listState.error = 'Session expired';
    render(<EmployeeListPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load employees/i);
  });

  it('shows a demo-data note when running in fallback mode', () => {
    listState.mode = 'fallback';
    render(<EmployeeListPage />);
    expect(screen.getByRole('note')).toHaveTextContent(/demo data/i);
  });

  it('hides filters and the add button for Employees', () => {
    useAuthMock.mockReturnValue(
      makeAuth({
        user: { id: 'u2', role: 'Employee', email: 'bob@example.com' },
        hasPermission: vi.fn(() => false),
        canViewEmployee: vi.fn((e: { id: string }) => e.id === 'e2'),
      }),
    );
    render(<EmployeeListPage />);
    expect(screen.queryByPlaceholderText(/search by name, email, id/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add employee/i })).not.toBeInTheDocument();
  });

  it('scopes the visible employees via canViewEmployee', () => {
    useAuthMock.mockReturnValue(
      makeAuth({
        user: { id: 'u2', role: 'Manager', email: 'boss@example.com' },
        hasPermission: vi.fn(() => false),
        canViewEmployee: vi.fn((e: { id: string }) => e.id === 'e2'),
      }),
    );
    render(<EmployeeListPage />);
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Probie')).toBeInTheDocument();
  });

  it('links each employee card to its profile page', () => {
    render(<EmployeeListPage />);
    const profileLink = screen.getByRole('link', { name: /alice admin/i });
    expect(profileLink).toHaveAttribute('href', '/app/employees/e1');
  });
});
