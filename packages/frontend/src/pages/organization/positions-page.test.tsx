import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const createPositionMock = vi.fn();
const updatePositionMock = vi.fn();
const deletePositionMock = vi.fn();
const posState = vi.hoisted(() => ({
  departments: [] as unknown[],
  positions: [] as unknown[],
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
  useDepartments: () => ({ data: posState.departments, mode: 'live', error: null }),
  usePositions: () => ({ data: posState.positions, mode: 'live', error: null }),
  createPosition: (...args: unknown[]) => createPositionMock(...args),
  updatePosition: (...args: unknown[]) => updatePositionMock(...args),
  deletePosition: (...args: unknown[]) => deletePositionMock(...args),
}));

import { PositionsPage } from './positions-page';

const departments = [
  { id: 'd1', name: 'Human Resources' },
  { id: 'd2', name: 'Engineering' },
];

const positions = [
  {
    id: 'p1',
    name: 'HR Lead',
    grade: 'L5',
    description: 'Leads people ops',
    departmentId: 'd1',
    departmentName: 'Human Resources',
    employeeCount: 0,
  },
  {
    id: 'p2',
    name: 'Software Engineer',
    grade: 'L4',
    description: 'Builds features',
    departmentId: 'd2',
    departmentName: 'Engineering',
    employeeCount: 3,
  },
];

beforeEach(() => {
  posState.departments = departments;
  posState.positions = positions;
  useAuthMock.mockReturnValue({
    user: { id: 'u1', role: 'Admin' },
    hasPermission: vi.fn(() => true),
    canViewEmployee: vi.fn(() => true),
  });
  createPositionMock.mockImplementation((payload: Record<string, unknown>) => ({
    id: 'p-new',
    ...payload,
  }));
  updatePositionMock.mockResolvedValue({});
  deletePositionMock.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PositionsPage', () => {
  it('renders the positions heading and a table of positions', () => {
    render(<PositionsPage />);
    expect(screen.getByRole('heading', { name: /positions/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /position/i })).toBeInTheDocument();
    expect(screen.getByText('HR Lead')).toBeInTheDocument();
    expect(screen.getByText('Software Engineer')).toBeInTheDocument();
  });

  it('shows a count summary of filtered positions', () => {
    render(<PositionsPage />);
    expect(screen.getByText(/2 of 2 positions/i)).toBeInTheDocument();
  });

  it('filters positions by search query', async () => {
    const user = userEvent.setup();
    render(<PositionsPage />);
    await user.type(screen.getByPlaceholderText(/search positions/i), 'Engineer');
    await waitFor(() => expect(screen.queryByText('HR Lead')).not.toBeInTheDocument());
    expect(screen.getByText('Software Engineer')).toBeInTheDocument();
  });

  it('filters positions by department', async () => {
    const user = userEvent.setup();
    render(<PositionsPage />);
    const deptSelect = screen.getByDisplayValue('All departments');
    await user.selectOptions(deptSelect, 'd1');
    await waitFor(() => expect(screen.queryByText('Software Engineer')).not.toBeInTheDocument());
    expect(screen.getByText('HR Lead')).toBeInTheDocument();
  });

  it('opens the create dialog and validates required fields', async () => {
    const user = userEvent.setup();
    render(<PositionsPage />);
    await user.click(screen.getByRole('button', { name: /add position/i }));
    expect(await screen.findByText('New position')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create position/i }));
    expect(await screen.findByText(/position name is required/i)).toBeInTheDocument();
    expect(createPositionMock).not.toHaveBeenCalled();
  });

  it('creates a new position via the dialog', async () => {
    const user = userEvent.setup();
    render(<PositionsPage />);
    await user.click(screen.getByRole('button', { name: /add position/i }));
    await screen.findByText('New position');
    await user.type(screen.getByLabelText(/title/i), 'QA Engineer');
    await user.type(screen.getByLabelText(/grade \/ level/i), 'L3');
    await user.selectOptions(screen.getByDisplayValue('Human Resources'), 'd2');
    await user.click(screen.getByRole('button', { name: /create position/i }));

    await waitFor(() =>
      expect(createPositionMock).toHaveBeenCalledWith({
        name: 'QA Engineer',
        grade: 'L3',
        description: undefined,
        departmentId: 'd2',
      }),
    );
  });

  it('blocks deletion when employees are assigned', async () => {
    const user = userEvent.setup();
    render(<PositionsPage />);
    const row = screen.getByText('Software Engineer').closest('tr') as HTMLElement;
    const deleteButton = within(row).getAllByRole('button')[1];
    await user.click(deleteButton);
    expect(await screen.findByText(/cannot delete/i)).toBeInTheDocument();
    expect(screen.getByText('Software Engineer')).toBeInTheDocument();
  });

  it('deletes a position with no assigned employees', async () => {
    const user = userEvent.setup();
    render(<PositionsPage />);
    const row = screen.getByText('HR Lead').closest('tr') as HTMLElement;
    const deleteButton = within(row).getAllByRole('button')[1];
    await user.click(deleteButton);
    expect(await screen.findByText(/this action cannot be undone/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deletePositionMock).toHaveBeenCalledWith('p1'));
  });

  it('edits an existing position', async () => {
    const user = userEvent.setup();
    render(<PositionsPage />);
    const row = screen.getByText('HR Lead').closest('tr') as HTMLElement;
    const editButton = within(row).getAllByRole('button')[0];
    await user.click(editButton);
    expect(await screen.findByText('Edit position')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/title/i), ' (Updated)');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(updatePositionMock).toHaveBeenCalled());
  });
});
