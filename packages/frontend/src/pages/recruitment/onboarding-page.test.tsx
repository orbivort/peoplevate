import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const listOnboardingMock = vi.fn();
const updateOnboardingTaskMock = vi.fn();
const employeesState = vi.hoisted(() => ({ employees: [] as Record<string, unknown>[] }));

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

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/data/data-layer', () => ({
  useEmployees: () => ({ data: employeesState.employees, mode: 'live', error: null }),
  usePositions: () => ({ data: [], mode: 'live', error: null }),
}));

vi.mock('@/lib/api/workflow-repositories', () => ({
  recruitmentRepo: {
    listOnboarding: (...args: unknown[]) => listOnboardingMock(...args),
    updateOnboardingTask: (...args: unknown[]) => updateOnboardingTaskMock(...args),
  },
}));

import { OnboardingPage } from './onboarding-page';

// listOnboarding(empId) returns that employee's onboarding TASKS.
const tasksByEmployee: Record<string, Record<string, unknown>[]> = {
  e1: [
    {
      id: 't1',
      type: 'Document Submission',
      assignee: 'Alice Admin',
      dueDate: '2026-06-05',
      status: 'Complete' as const,
      completedAt: '2026-06-04T00:00:00.000Z',
    },
    {
      id: 't2',
      type: 'Equipment Assignment',
      assignee: 'Alice Admin',
      dueDate: '2026-06-10',
      status: 'Pending' as const,
      completedAt: null,
    },
  ],
  e2: [
    {
      id: 't3',
      type: 'Orientation Session',
      assignee: 'Bob Probie',
      dueDate: '2026-05-20',
      status: 'Complete' as const,
      completedAt: '2026-05-19T00:00:00.000Z',
    },
  ],
};

const makeAuth = (perms: string[]) => ({
  employee: { id: 'e1', firstName: 'Alice', lastName: 'Admin', departmentId: 'd1' },
  hasPermission: vi.fn((p: string) => perms.includes(p)),
});

beforeEach(() => {
  listOnboardingMock.mockImplementation(async (empId: string) => tasksByEmployee[empId] ?? []);
  updateOnboardingTaskMock.mockResolvedValue({});
  employeesState.employees = [
    { id: 'e1', firstName: 'Alice', lastName: 'Admin', departmentId: 'd1', hireDate: '2026-06-01' },
    { id: 'e2', firstName: 'Bob', lastName: 'Probie', departmentId: 'd1', hireDate: '2026-05-15' },
  ];
  useAuthMock.mockReturnValue(makeAuth(['manageRecruitment']));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OnboardingPage', () => {
  it('renders the heading and loads active onboarding plans', async () => {
    render(<OnboardingPage />);
    expect(await screen.findByRole('heading', { name: /onboarding/i })).toBeInTheDocument();
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
  });

  it('shows a completion progress indicator for the plan', async () => {
    render(<OnboardingPage />);
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    // e1 has 1 of 2 tasks complete.
    expect(screen.getByText(/1\/2 tasks complete/i)).toBeInTheDocument();
  });

  it('lists the onboarding tasks for an employee', async () => {
    render(<OnboardingPage />);
    expect(await screen.findByText('Document Submission')).toBeInTheDocument();
    expect(screen.getByText('Equipment Assignment')).toBeInTheDocument();
  });

  it('completes a pending task via its toggle button (HR)', async () => {
    const user = userEvent.setup();
    render(<OnboardingPage />);
    const taskName = await screen.findByText('Equipment Assignment');
    const taskRow = taskName.closest('div')!.parentElement as HTMLElement;
    const toggle = within(taskRow).getByRole('button');
    await user.click(toggle);
    expect(
      await waitFor(() =>
        expect(updateOnboardingTaskMock).toHaveBeenCalledWith('t2', { status: 'COMPLETE' }),
      ),
    );
  });

  it('does not toggle tasks for non-HR viewers (button disabled)', async () => {
    useAuthMock.mockReturnValue(makeAuth([]));
    render(<OnboardingPage />);
    await screen.findByText('Equipment Assignment');
    const taskRow = screen.getByText('Equipment Assignment').closest('div')!
      .parentElement as HTMLElement;
    const toggle = within(taskRow).getByRole('button');
    expect(toggle).toBeDisabled();
  });

  it('scopes records to the employee when not HR/Manager', async () => {
    useAuthMock.mockReturnValue({
      employee: { id: 'e2', firstName: 'Bob', lastName: 'Probie', departmentId: 'd1' },
      hasPermission: vi.fn((_p: string) => false),
    });
    render(<OnboardingPage />);
    // e2 sees only their own record (Bob Probie), not Alice's.
    // "Alice Admin" may still appear as a task assignee, so assert on the record link instead.
    expect(screen.queryByRole('link', { name: /alice admin/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /bob probie/i })).toBeInTheDocument();
  });
});
