import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserManagementPage } from './user-management-page';
import type { Employee, User } from '@/types';

// --- Mocks (hoisted so vi.mock factories can reference them) ---

const {
  changeUserRoleMock,
  changeUserStatusMock,
  adminResetPasswordMock,
  deleteUserMock,
  inviteUserMock,
} = vi.hoisted(() => ({
  changeUserRoleMock: vi.fn(),
  changeUserStatusMock: vi.fn(),
  adminResetPasswordMock: vi.fn(),
  deleteUserMock: vi.fn(),
  inviteUserMock: vi.fn(),
}));

const state = vi.hoisted(() => ({
  isRealBackendValue: false,
  seedUsersMock: [] as User[],
  employeesMock: [] as Employee[],
  currentUserMock: null as User | null,
}));

vi.mock('@/data/data-layer', () => ({
  isRealBackend: () => state.isRealBackendValue,
  useUsers: () => ({
    data: state.seedUsersMock,
    loading: false,
    error: null,
    mode: 'mock' as const,
  }),
  useEmployees: () => ({
    data: state.employeesMock,
    loading: false,
    error: null,
    mode: 'mock' as const,
  }),
  changeUserRole: changeUserRoleMock,
  changeUserStatus: changeUserStatusMock,
  adminResetPassword: adminResetPasswordMock,
  deleteUser: deleteUserMock,
  inviteUser: inviteUserMock,
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: state.currentUserMock }),
}));

// Radix Select renders its options in a portal that jsdom has trouble
// opening reliably. Mock the Select primitives with lightweight native
// <select>/<option> elements so the page's onChange handlers still run.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="select"
      value={value ?? ''}
      onChange={(e) => onValueChange?.(e.target.value)}
      disabled={disabled}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// --- Test fixtures ---

const users: User[] = [
  {
    id: 'u-admin',
    email: 'admin@example.com',
    role: 'Admin',
    status: 'active',
    employeeId: 'e-001',
  },
  {
    id: 'u-hr',
    email: 'hr@example.com',
    role: 'HR Manager',
    status: 'active',
    employeeId: 'e-002',
  },
  {
    id: 'u-emp',
    email: 'employee@example.com',
    role: 'Employee',
    status: 'pending_setup',
    employeeId: 'e-006',
  },
  {
    id: 'u-mgr',
    email: 'manager@example.com',
    role: 'Manager',
    status: 'deactivated',
    employeeId: 'e-003',
  },
];

const employees: Employee[] = [
  {
    id: 'e-001',
    employeeNo: 'EMP-0001',
    firstName: 'Sarah',
    lastName: 'Chen',
    dateOfBirth: '1985-03-12',
    gender: 'Female',
    nationalId: 'ID-8821-44571',
    email: 'sarah.chen@example.com',
    phone: '+1 415 555 0142',
    address: '204 Larkin St, San Francisco, CA 94102',
    emergencyContactName: 'David Chen',
    emergencyContactRelationship: 'Spouse',
    emergencyContactPhone: '+1 415 555 0188',
    departmentId: 'd-eng',
    departmentName: 'Engineering',
    positionId: 'p-cto',
    positionName: 'Chief Technology Officer',
    managerId: null,
    managerName: null,
    hireDate: '2021-06-01',
    employmentType: 'Full-time',
    salary: 245000,
    status: 'Active',
    deactivationDate: null,
    createdAt: '2021-06-01T08:00:00Z',
    updatedAt: '2025-11-10T08:00:00Z',
  },
  {
    id: 'e-002',
    employeeNo: 'EMP-0002',
    firstName: 'Marcus',
    lastName: 'Okafor',
    dateOfBirth: '1988-09-23',
    gender: 'Male',
    nationalId: 'ID-7732-12903',
    email: 'marcus.okafor@example.com',
    phone: '+1 415 555 0231',
    address: '118 Pine St, San Francisco, CA 94104',
    emergencyContactName: 'Ada Okafor',
    emergencyContactRelationship: 'Sister',
    emergencyContactPhone: '+1 415 555 0299',
    departmentId: 'd-hr',
    departmentName: 'Human Resources',
    positionId: 'p-hr-dir',
    positionName: 'HR Director',
    managerId: null,
    managerName: null,
    hireDate: '2020-03-15',
    employmentType: 'Full-time',
    salary: 185000,
    status: 'Active',
    createdAt: '2020-03-15T08:00:00Z',
    updatedAt: '2025-10-01T08:00:00Z',
  },
  {
    id: 'e-003',
    employeeNo: 'EMP-0003',
    firstName: 'Elena',
    lastName: 'Vasquez',
    dateOfBirth: '1990-07-04',
    gender: 'Female',
    nationalId: 'ID-6610-77820',
    email: 'elena.vasquez@example.com',
    phone: '+1 415 555 0312',
    address: '55 Mint St, San Francisco, CA 94103',
    emergencyContactName: 'Carlos Vasquez',
    emergencyContactRelationship: 'Brother',
    emergencyContactPhone: '+1 415 555 0388',
    departmentId: 'd-eng-fe',
    departmentName: 'Frontend',
    positionId: 'p-eng-mgr',
    positionName: 'Engineering Manager',
    managerId: 'e-001',
    managerName: 'Sarah Chen',
    hireDate: '2022-01-10',
    employmentType: 'Full-time',
    salary: 175000,
    status: 'Active',
    createdAt: '2022-01-10T08:00:00Z',
    updatedAt: '2025-09-15T08:00:00Z',
  },
  {
    id: 'e-006',
    employeeNo: 'EMP-0006',
    firstName: 'Tom',
    lastName: 'Andersen',
    dateOfBirth: '1996-12-03',
    gender: 'Male',
    nationalId: 'ID-3398-44510',
    email: 'tom.andersen@example.com',
    phone: '+1 415 555 0612',
    address: '77 Howard St, San Francisco, CA 94105',
    emergencyContactName: 'Lisa Andersen',
    emergencyContactRelationship: 'Mother',
    emergencyContactPhone: '+1 415 555 0688',
    departmentId: 'd-eng-fe',
    departmentName: 'Frontend',
    positionId: 'p-fe-eng',
    positionName: 'Frontend Engineer',
    managerId: 'e-003',
    managerName: 'Elena Vasquez',
    hireDate: '2024-02-05',
    employmentType: 'Full-time',
    salary: 118000,
    status: 'Active',
    createdAt: '2024-02-05T08:00:00Z',
    updatedAt: '2025-12-01T08:00:00Z',
  },
];

const adminUser: User = {
  id: 'u-admin',
  email: 'admin@example.com',
  role: 'Admin',
  status: 'active',
  employeeId: 'e-001',
};

beforeEach(() => {
  state.seedUsersMock = [...users];
  state.employeesMock = [...employees];
  state.currentUserMock = { ...adminUser };
  state.isRealBackendValue = false;
  changeUserRoleMock.mockReset();
  changeUserStatusMock.mockReset();
  adminResetPasswordMock.mockReset();
  deleteUserMock.mockReset();
  inviteUserMock.mockReset();
  changeUserRoleMock.mockResolvedValue(undefined);
  changeUserStatusMock.mockResolvedValue(undefined);
  adminResetPasswordMock.mockResolvedValue(undefined);
  deleteUserMock.mockResolvedValue(undefined);
  inviteUserMock.mockResolvedValue(undefined);
});

describe('UserManagementPage', () => {
  it('renders the page header and invite button', () => {
    render(<UserManagementPage />);

    expect(screen.getByText('User Management')).toBeInTheDocument();
    expect(
      screen.getByText('Manage user accounts, roles, and access permissions across the system.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invite user/ })).toBeInTheDocument();
  });

  it('renders the stats cards with per-role counts', () => {
    render(<UserManagementPage />);

    // One user per role -> each of the four role cards shows a count of 1.
    expect(screen.getAllByText('1')).toHaveLength(4);
  });

  it('renders all users with linked employee info and status badges', () => {
    render(<UserManagementPage />);

    expect(screen.getByText('Sarah Chen')).toBeInTheDocument();
    expect(screen.getByText('Marcus Okafor')).toBeInTheDocument();
    expect(screen.getByText('Tom Andersen')).toBeInTheDocument();
    expect(screen.getByText('Elena Vasquez')).toBeInTheDocument();
    expect(screen.getByText('hr@example.com')).toBeInTheDocument();
    // Linked employee info rendered with employeeNo.
    expect(screen.getByText(/EMP-0001/)).toBeInTheDocument();
    // Status badges for active, pending_setup and deactivated.
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('Pending setup')).toBeInTheDocument();
    expect(screen.getByText('Deactivated')).toBeInTheDocument();
  });

  it('marks the current user with a "(you)" indicator and disables their actions', () => {
    render(<UserManagementPage />);

    expect(screen.getByText('(you)')).toBeInTheDocument();

    const adminRow = screen.getByText('admin@example.com').closest('tr') as HTMLElement;
    // Role select is a combobox and is disabled for the current user.
    expect(within(adminRow).getByRole('combobox')).toBeDisabled();
    expect(within(adminRow).getByRole('button', { name: /Deactivate/ })).toBeDisabled();
    expect(within(adminRow).getByRole('button', { name: /Delete/ })).toBeDisabled();
  });

  it('filters users by search text', async () => {
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const searchInput = screen.getByPlaceholderText(/Search by email, name, or role/);
    await user.type(searchInput, 'marcus');

    expect(screen.getByText('Marcus Okafor')).toBeInTheDocument();
    expect(screen.queryByText('Sarah Chen')).not.toBeInTheDocument();
    expect(screen.queryByText('Tom Andersen')).not.toBeInTheDocument();
  });

  it('filters users by email and role keywords', async () => {
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const searchInput = screen.getByPlaceholderText(/Search by email, name, or role/);

    await user.type(searchInput, 'employee@');
    expect(screen.getByText('Tom Andersen')).toBeInTheDocument();
    expect(screen.queryByText('Sarah Chen')).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, 'manager');
    expect(screen.getByText('Elena Vasquez')).toBeInTheDocument();
  });

  it('shows the empty state when the search matches nothing', async () => {
    const user = userEvent.setup();
    render(<UserManagementPage />);

    await user.type(screen.getByPlaceholderText(/Search by email, name, or role/), 'zzz-no-match');

    expect(await screen.findByText('No users found')).toBeInTheDocument();
    expect(
      screen.getByText('Try adjusting your search or filters, or invite a new user.'),
    ).toBeInTheDocument();
  });

  it('filters users by role using the filter select', async () => {
    const user = userEvent.setup();
    render(<UserManagementPage />);

    // The filter select is the first combobox on the page.
    const filterSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(filterSelect, 'HR Manager');

    expect(screen.getByText('Marcus Okafor')).toBeInTheDocument();
    expect(screen.queryByText('Sarah Chen')).not.toBeInTheDocument();
  });

  it('opens the invite dialog and validates an empty email', async () => {
    const user = userEvent.setup();
    render(<UserManagementPage />);

    await user.click(screen.getByRole('button', { name: /Invite user/ }));

    expect(await screen.findByRole('heading', { name: 'Invite user' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(inviteUserMock).not.toHaveBeenCalled();
  });

  it('rejects an invite for a duplicate email', async () => {
    const user = userEvent.setup();
    render(<UserManagementPage />);

    await user.click(screen.getByRole('button', { name: /Invite user/ }));

    const emailInput = await screen.findByPlaceholderText('newuser@company.com');
    await user.type(emailInput, 'hr@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByText('A user with this email already exists.')).toBeInTheDocument();
    expect(inviteUserMock).not.toHaveBeenCalled();
  });

  it('invites a new user successfully in mock mode', async () => {
    const user = userEvent.setup();
    render(<UserManagementPage />);

    await user.click(screen.getByRole('button', { name: /Invite user/ }));

    const emailInput = await screen.findByPlaceholderText('newuser@company.com');
    await user.type(emailInput, 'new.user@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Invite user' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('new.user@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Pending setup').length).toBeGreaterThan(0);
    expect(inviteUserMock).not.toHaveBeenCalled();
  });

  it('calls inviteUser when using a real backend', async () => {
    state.isRealBackendValue = true;
    const user = userEvent.setup();
    render(<UserManagementPage />);

    await user.click(screen.getByRole('button', { name: /Invite user/ }));

    const emailInput = await screen.findByPlaceholderText('newuser@company.com');
    await user.type(emailInput, 'backend.user@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    await waitFor(() =>
      expect(inviteUserMock).toHaveBeenCalledWith({
        email: 'backend.user@example.com',
        role: 'Employee',
        employeeId: undefined,
      }),
    );
  });

  it('shows an error banner when inviting fails on a real backend', async () => {
    state.isRealBackendValue = true;
    inviteUserMock.mockRejectedValue(new Error('Invite service down'));
    const user = userEvent.setup();
    render(<UserManagementPage />);

    await user.click(screen.getByRole('button', { name: /Invite user/ }));

    const emailInput = await screen.findByPlaceholderText('newuser@company.com');
    await user.type(emailInput, 'fail.user@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByText('Invite service down')).toBeInTheDocument();
  });

  it('changes a user role via the role select', async () => {
    state.isRealBackendValue = true;
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const hrRow = screen.getByText('hr@example.com').closest('tr') as HTMLElement;
    await user.selectOptions(within(hrRow).getByRole('combobox'), 'Manager');

    await waitFor(() => expect(changeUserRoleMock).toHaveBeenCalledWith('u-hr', 'Manager'));
  });

  it('reverts the role change and shows an error when the backend call fails', async () => {
    state.isRealBackendValue = true;
    changeUserRoleMock.mockRejectedValue(new Error('Role update failed'));
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const hrRow = screen.getByText('hr@example.com').closest('tr') as HTMLElement;
    await user.selectOptions(within(hrRow).getByRole('combobox'), 'Manager');

    expect(await screen.findByText('Role update failed')).toBeInTheDocument();
    // State reverted back to HR Manager (the select value is unchanged).
    await waitFor(() => expect(within(hrRow).getByRole('combobox')).toHaveValue('HR Manager'));
  });

  it('toggles a user status (deactivate) and calls the backend', async () => {
    state.isRealBackendValue = true;
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const hrRow = screen.getByText('hr@example.com').closest('tr') as HTMLElement;
    await user.click(within(hrRow).getByRole('button', { name: /Deactivate/ }));

    await waitFor(() => expect(changeUserStatusMock).toHaveBeenCalledWith('u-hr', 'deactivated'));
    await waitFor(() => expect(within(hrRow).getByText('Deactivated')).toBeInTheDocument());
  });

  it('reactivates a deactivated user', async () => {
    state.isRealBackendValue = true;
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const mgrRow = screen.getByText('manager@example.com').closest('tr') as HTMLElement;
    await user.click(within(mgrRow).getByRole('button', { name: /Activate/ }));

    await waitFor(() => expect(changeUserStatusMock).toHaveBeenCalledWith('u-mgr', 'active'));
    await waitFor(() => expect(within(mgrRow).getByText('Active')).toBeInTheDocument());
  });

  it('shows an error banner when the status update fails', async () => {
    state.isRealBackendValue = true;
    changeUserStatusMock.mockRejectedValue(new Error('Status update failed'));
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const hrRow = screen.getByText('hr@example.com').closest('tr') as HTMLElement;
    await user.click(within(hrRow).getByRole('button', { name: /Deactivate/ }));

    expect(await screen.findByText('Status update failed')).toBeInTheDocument();
  });

  it('opens the reset dialog and sends a reset link', async () => {
    state.isRealBackendValue = true;
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const hrRow = screen.getByText('hr@example.com').closest('tr') as HTMLElement;
    await user.click(within(hrRow).getByRole('button', { name: /Reset/ }));

    expect(await screen.findByRole('heading', { name: /Reset password/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Send reset link/ }));

    await waitFor(() => expect(adminResetPasswordMock).toHaveBeenCalledWith('u-hr'));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Reset password/ })).not.toBeInTheDocument(),
    );
  });

  it('shows an error banner when the reset link request fails', async () => {
    state.isRealBackendValue = true;
    adminResetPasswordMock.mockRejectedValue(new Error('Reset failed'));
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const hrRow = screen.getByText('hr@example.com').closest('tr') as HTMLElement;
    await user.click(within(hrRow).getByRole('button', { name: /Reset/ }));

    await screen.findByRole('heading', { name: /Reset password/ });
    await user.click(screen.getByRole('button', { name: /Send reset link/ }));

    expect(await screen.findByText('Reset failed')).toBeInTheDocument();
  });

  it('deletes a user after confirmation', async () => {
    state.isRealBackendValue = true;
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const hrRow = screen.getByText('hr@example.com').closest('tr') as HTMLElement;
    await user.click(within(hrRow).getByRole('button', { name: /Delete/ }));

    expect(await screen.findByRole('heading', { name: 'Delete user' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Delete$/ }));

    await waitFor(() => expect(deleteUserMock).toHaveBeenCalledWith('u-hr'));
    await waitFor(() => expect(screen.queryByText('hr@example.com')).not.toBeInTheDocument());
  });

  it('cancels deletion without removing the user', async () => {
    state.isRealBackendValue = true;
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const hrRow = screen.getByText('hr@example.com').closest('tr') as HTMLElement;
    await user.click(within(hrRow).getByRole('button', { name: /Delete/ }));

    await screen.findByRole('heading', { name: 'Delete user' });
    await user.click(screen.getByRole('button', { name: /Cancel/ }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Delete user' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('hr@example.com')).toBeInTheDocument();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('shows an error banner when deleting fails', async () => {
    state.isRealBackendValue = true;
    deleteUserMock.mockRejectedValue(new Error('Delete failed'));
    const user = userEvent.setup();
    render(<UserManagementPage />);

    const hrRow = screen.getByText('hr@example.com').closest('tr') as HTMLElement;
    await user.click(within(hrRow).getByRole('button', { name: /Delete/ }));

    await screen.findByRole('heading', { name: 'Delete user' });
    await user.click(screen.getByRole('button', { name: /^Delete$/ }));

    expect(await screen.findByText('Delete failed')).toBeInTheDocument();
  });

  it('re-syncs users from the seed data via useEffect', async () => {
    const { rerender } = render(<UserManagementPage />);
    expect(screen.getByText('hr@example.com')).toBeInTheDocument();

    state.seedUsersMock = [
      { id: 'u-new', email: 'brand.new@example.com', role: 'Admin', status: 'active' },
    ];
    rerender(<UserManagementPage />);

    expect(await screen.findByText('brand.new@example.com')).toBeInTheDocument();
    expect(screen.queryByText('hr@example.com')).not.toBeInTheDocument();
  });
});
