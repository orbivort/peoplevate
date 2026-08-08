import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const createDepartmentMock = vi.fn();
const updateDepartmentMock = vi.fn();
const deleteDepartmentMock = vi.fn();
const orgState = vi.hoisted(() => ({
  departments: [] as unknown[],
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange: (v: string) => void;
    value?: string;
  }) => (
    <select data-testid="select" value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock('@/data/data-layer', () => ({
  useDepartments: () => ({ data: orgState.departments, mode: 'live', error: null }),
  createDepartment: (...args: unknown[]) => createDepartmentMock(...args),
  updateDepartment: (...args: unknown[]) => updateDepartmentMock(...args),
  deleteDepartment: (...args: unknown[]) => deleteDepartmentMock(...args),
}));

import { DepartmentsPage } from './departments-page';

const departments = [
  {
    id: 'd1',
    name: 'Human Resources',
    description: 'People operations',
    parentId: null,
    positionCount: 0,
    employeeCount: 0,
  },
  {
    id: 'd2',
    name: 'Engineering',
    description: 'Builds the product',
    parentId: 'd1',
    positionCount: 2,
    employeeCount: 5,
  },
];

beforeEach(() => {
  orgState.departments = departments;
  useAuthMock.mockReturnValue({
    user: { id: 'u1', role: 'Admin' },
    hasPermission: vi.fn(() => true),
    canViewEmployee: vi.fn(() => true),
  });
  createDepartmentMock.mockImplementation((payload: Record<string, unknown>) => ({
    id: 'd-new',
    ...payload,
  }));
  updateDepartmentMock.mockResolvedValue({});
  deleteDepartmentMock.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DepartmentsPage', () => {
  it('renders the departments heading and existing departments', () => {
    render(<DepartmentsPage />);
    expect(screen.getByRole('heading', { name: /departments/i })).toBeInTheDocument();
    expect(screen.getByText('Human Resources')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
  });

  it('marks root departments with a Root badge', () => {
    render(<DepartmentsPage />);
    expect(screen.getByText('Human Resources').closest('div')?.parentElement).toBeInTheDocument();
    expect(screen.getAllByText('Root').length).toBeGreaterThanOrEqual(1);
  });

  it('shows an empty state when there are no departments', () => {
    orgState.departments = [];
    render(<DepartmentsPage />);
    expect(screen.getByText(/no departments yet/i)).toBeInTheDocument();
  });

  it('opens the create dialog and validates the required name', async () => {
    const user = userEvent.setup();
    render(<DepartmentsPage />);
    await user.click(screen.getByRole('button', { name: /add department/i }));
    // Dialog is now open
    expect(await screen.findByText('New department')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create department/i }));
    expect(await screen.findByText(/department name is required/i)).toBeInTheDocument();
    expect(createDepartmentMock).not.toHaveBeenCalled();
  });

  it('creates a new root department via the dialog', async () => {
    const user = userEvent.setup();
    render(<DepartmentsPage />);
    await user.click(screen.getByRole('button', { name: /add department/i }));
    await screen.findByText('New department');
    await user.type(screen.getByLabelText(/name/i), 'Finance');
    await user.click(screen.getByRole('button', { name: /create department/i }));

    await waitFor(() =>
      expect(createDepartmentMock).toHaveBeenCalledWith({
        name: 'Finance',
        description: undefined,
        parentId: null,
      }),
    );
  });

  it('rejects a circular parent reference on edit', async () => {
    const user = userEvent.setup();
    render(<DepartmentsPage />);
    // Edit Human Resources (d1), then set its parent to Engineering (d2), which is
    // a descendant of Human Resources -> circular reference.
    const editButtons = screen.getAllByTitle('Edit');
    await user.click(editButtons[0]);
    expect(await screen.findByText('Edit department')).toBeInTheDocument();
    const parentSelect = screen.getByDisplayValue('None (root department)');
    await user.selectOptions(parentSelect, 'd2');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/circular reference detected/i)).toBeInTheDocument();
    expect(updateDepartmentMock).not.toHaveBeenCalled();
  });

  it('blocks deletion when the department has assigned positions or employees', async () => {
    const user = userEvent.setup();
    render(<DepartmentsPage />);
    const deleteButtons = screen.getAllByTitle('Delete');
    // Engineering has positionCount=2, employeeCount=5 -> blocked
    await user.click(deleteButtons[1]);
    expect(await screen.findByText(/cannot delete/i)).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
  });

  it('deletes a department with no assignments', async () => {
    const user = userEvent.setup();
    render(<DepartmentsPage />);
    const deleteButtons = screen.getAllByTitle('Delete');
    // Human Resources has zero positions/employees
    await user.click(deleteButtons[0]);
    expect(await screen.findByText(/this action cannot be undone/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deleteDepartmentMock).toHaveBeenCalledWith('d1'));
  });
});
