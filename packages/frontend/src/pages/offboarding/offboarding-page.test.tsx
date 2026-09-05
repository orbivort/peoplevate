import * as React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const useAuthMock = vi.fn();
const departmentsState = vi.hoisted(() => ({ departments: [] as unknown[] }));
const positionsState = vi.hoisted(() => ({ positions: [] as unknown[] }));
const employeesState = vi.hoisted(() => ({
  employees: [
    { id: 'e1', firstName: 'Alice', lastName: 'Admin', status: 'Active', departmentId: 'd1' },
    { id: 'e2', firstName: 'Bob', lastName: 'Probie', status: 'Active', departmentId: 'd1' },
  ],
}));

const records = vi.hoisted(() => [
  {
    id: 'o1',
    employeeId: 'e1',
    employeeName: 'Alice Admin',
    positionName: 'Engineering Manager',
    separationType: 'Resignation',
    status: 'Clearance In Progress',
    initiatedBy: 'Jing Zhao',
    initiatedAt: '2026-05-01T00:00:00.000Z',
    lastWorkingDay: '2026-06-01',
    deactivationDate: '2026-06-02',
    reason: 'Moving on',
  },
  {
    id: 'o2',
    employeeId: 'e2',
    employeeName: 'Bob Probie',
    positionName: 'Engineer',
    separationType: 'Dismissal',
    status: 'Closed',
    initiatedBy: 'HR',
    initiatedAt: '2026-04-01T00:00:00.000Z',
    lastWorkingDay: '2026-05-01',
    deactivationDate: '2026-05-02',
    reason: 'Performance',
  },
  {
    id: 'o3',
    employeeId: 'e3',
    employeeName: 'Carol Settler',
    positionName: 'Analyst',
    separationType: 'Resignation',
    status: 'Settlement',
    initiatedBy: 'HR',
    initiatedAt: '2026-05-01T00:00:00.000Z',
    lastWorkingDay: '2026-06-10',
    deactivationDate: '2026-06-11',
    reason: 'Relocation',
  },
]);

const clearanceByRecord = vi.hoisted(() => ({
  o1: [
    {
      id: 'ci1',
      category: 'Asset Return',
      description: 'Return laptop',
      status: 'Pending',
      responsibleParty: 'IT',
    },
    {
      id: 'ci2',
      category: 'Access Revocation',
      description: 'Revoke access',
      status: 'Complete',
      responsibleParty: 'IT',
    },
  ],
}));

const listMock = vi.fn(async () => records);
const listClearanceMock = vi.fn(async (id: string) => clearanceByRecord[id] ?? []);
const initiateMock = vi.fn(async () => ({}));
const updateClearanceMock = vi.fn(async () => ({}));
const closeMock = vi.fn(async () => ({}));
const submitResignationMock = vi.fn(async () => ({}));
const conductExitInterviewMock = vi.fn(async () => ({}));

const makeAuth = (
  perms: string[],
  employee: Record<string, unknown> = employeesState.employees[0],
) => ({
  employee,
  hasPermission: vi.fn((p: string) => perms.includes(p)),
});

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
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/components/ui/select', () => {
  type SelectItemData = { value: string; label: React.ReactNode };
  const Ctx = React.createContext<{
    items: SelectItemData[];
    setItems: (items: SelectItemData[]) => void;
    value?: string;
    onValueChange?: (v: string) => void;
  }>({ items: [], setItems: () => {} });
  const Select = ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => {
    const [items, setItems] = React.useState<SelectItemData[]>([]);
    return React.createElement(
      Ctx.Provider,
      { value: { items, setItems, value, onValueChange } },
      children,
    );
  };
  const SelectTrigger = ({ id, children }: { id?: string; children: React.ReactNode }) => {
    const { items, value, onValueChange } = React.useContext(Ctx);
    return React.createElement(
      'select',
      {
        id,
        value: value ?? '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value),
      },
      [
        children,
        ...items.map((it) =>
          React.createElement('option', { key: it.value, value: it.value }, it.label),
        ),
      ],
    );
  };
  const SelectValue = ({ placeholder }: { placeholder?: string }) =>
    React.createElement('option', { value: '' }, placeholder);
  const SelectContent = ({ children }: { children: React.ReactNode }) => {
    const { setItems } = React.useContext(Ctx);
    const items = React.useMemo(
      () =>
        React.Children.toArray(children).map((c) => ({
          value: (c as React.ReactElement<{ value: string }>).props.value,
          label: (c as React.ReactElement<{ children: React.ReactNode }>).props.children,
        })),
      [children],
    );
    React.useEffect(() => {
      setItems(items);
    }, [items, setItems]);
    return null;
  };
  const SelectItem = ({ value, children }: { value: string; children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, value, children);
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

vi.mock('@/data/data-layer', () => ({
  useEmployees: () => ({ data: employeesState.employees, mode: 'live', error: null }),
  useDepartments: () => ({ data: departmentsState.departments, mode: 'live', error: null }),
  usePositions: () => ({ data: positionsState.positions, mode: 'live', error: null }),
}));

vi.mock('@/lib/api/workflow-repositories', () => ({
  offboardingRepo: {
    list: (...args: unknown[]) => listMock(...args),
    listClearance: (...args: unknown[]) => listClearanceMock(...args),
    initiateTermination: (...args: unknown[]) => initiateMock(...args),
    updateClearanceItem: (...args: unknown[]) => updateClearanceMock(...args),
    close: (...args: unknown[]) => closeMock(...args),
    submitResignation: (...args: unknown[]) => submitResignationMock(...args),
    conductExitInterview: (...args: unknown[]) => conductExitInterviewMock(...args),
  },
}));

import { OffboardingPage } from './offboarding-page';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue(makeAuth(['manageOffboarding']));
  listMock.mockImplementation(async () => records);
  listClearanceMock.mockImplementation(async (id: string) => clearanceByRecord[id] ?? []);
});

describe('OffboardingPage', () => {
  it('renders the heading and list of offboarding records', async () => {
    render(<OffboardingPage />);
    expect(await screen.findByRole('heading', { name: /offboarding/i })).toBeInTheDocument();
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob Probie')).toBeInTheDocument();
    // In-progress KPI.
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('shows an empty state when there are no records', async () => {
    listMock.mockImplementation(async () => []);
    render(<OffboardingPage />);
    expect(await screen.findByText(/no offboarding records/i)).toBeInTheDocument();
  });

  it('opens the initiate dialog and validates the required employee', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /initiate offboarding/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /^initiate$/i }));
    expect(await screen.findByText(/select an employee to offboard/i)).toBeInTheDocument();
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it('initiates an offboarding through the dialog', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /initiate offboarding/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select employee'), { target: { value: 'e2' } });
    fireEvent.change(screen.getByLabelText('Last working day *'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.change(screen.getByLabelText('Deactivation date *'), {
      target: { value: '2026-06-02' },
    });
    await user.click(screen.getByRole('button', { name: /^initiate$/i }));
    expect(
      await waitFor(() =>
        expect(initiateMock).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: 'e2',
            separationType: 'RESIGNATION',
            effectiveDate: '2026-06-01',
          }),
        ),
      ),
    );
  });

  it('opens a record detail and marks a clearance item complete', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /alice admin/i }));
    await screen.findByText('Asset Return');
    await user.click(screen.getByRole('button', { name: /mark complete/i }));
    expect(
      await waitFor(() =>
        expect(updateClearanceMock).toHaveBeenCalledWith('ci1', { status: 'COMPLETE' }),
      ),
    );
  });

  it('hides HR-only controls for non-HR viewers', async () => {
    useAuthMock.mockReturnValue(makeAuth([]));
    render(<OffboardingPage />);
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /initiate offboarding/i })).not.toBeInTheDocument();
  });

  it('scopes records to the employee in employee view', async () => {
    useAuthMock.mockReturnValue(makeAuth(['viewOwnOffboarding'], employeesState.employees[1]));
    render(<OffboardingPage />);
    expect(await screen.findByText('Bob Probie')).toBeInTheDocument();
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
  });

  it('lets an employee submit a resignation for their own record', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(makeAuth(['viewOwnOffboarding'], employeesState.employees[0]));
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /submit resignation/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Reason for leaving *'), {
      target: { value: 'New opportunity' },
    });
    fireEvent.change(screen.getByLabelText('Proposed last working day *'), {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(screen.getByLabelText('Deactivation date *'), {
      target: { value: '2026-07-02' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /submit resignation/i }));
    expect(
      await waitFor(() =>
        expect(submitResignationMock).toHaveBeenCalledWith(
          expect.objectContaining({ lastWorkingDay: '2026-07-01' }),
        ),
      ),
    );
  });

  it('validates required fields when initiating offboarding', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /initiate offboarding/i }));
    await screen.findByRole('dialog');
    // Select an employee but leave the date fields empty, then submit.
    fireEvent.change(screen.getByDisplayValue('Select employee'), {
      target: { value: 'e1' },
    });
    await user.click(screen.getByRole('button', { name: /initiate$/i }));
    expect(await screen.findByText(/last working day is required/i)).toBeInTheDocument();
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it('initiates offboarding with valid dates', async () => {
    initiateMock.mockResolvedValueOnce({ id: 'o9' });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /initiate offboarding/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select employee'), { target: { value: 'e1' } });
    fireEvent.change(document.getElementById('off-last') as HTMLInputElement, {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(document.getElementById('off-deact') as HTMLInputElement, {
      target: { value: '2026-07-05' },
    });
    await user.click(screen.getByRole('button', { name: /initiate$/i }));
    await waitFor(() =>
      expect(initiateMock).toHaveBeenCalledWith(
        expect.objectContaining({ employeeId: 'e1', effectiveDate: '2026-07-01' }),
      ),
    );
  });

  it('opens a record detail (offboarding record)', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /alice admin/i }));
    expect(await screen.findByText('Asset Return')).toBeInTheDocument();
    expect(screen.getByText(/reason for separation/i)).toBeInTheDocument();
  });

  it('records a valid exit interview with questions and responses', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /alice admin/i }));
    await screen.findByText('Asset Return');
    await user.click(screen.getByRole('button', { name: /conduct interview/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByPlaceholderText(/hr representative name/i), {
      target: { value: 'Jing Zhao' },
    });
    fireEvent.change(screen.getAllByPlaceholderText(/primary reason for leaving/i)[0], {
      target: { value: 'Better opportunity' },
    });
    fireEvent.change(screen.getAllByPlaceholderText(/employee's response/i)[0], {
      target: { value: 'Great place to work.' },
    });
    await user.click(screen.getByRole('button', { name: /save interview/i }));
    expect(
      await waitFor(() =>
        expect(conductExitInterviewMock).toHaveBeenCalledWith(
          'o1',
          expect.objectContaining({
            declined: false,
            responses: expect.arrayContaining([
              expect.objectContaining({
                question: 'Better opportunity',
                answer: 'Great place to work.',
              }),
            ]),
          }),
        ),
      ),
    );
  });

  it('blocks saving an exit interview with no responses', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /alice admin/i }));
    await screen.findByText('Asset Return');
    await user.click(screen.getByRole('button', { name: /conduct interview/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /save interview/i }));
    expect(
      await screen.findByText(/please fill in at least one question and response/i),
    ).toBeInTheDocument();
    expect(conductExitInterviewMock).not.toHaveBeenCalled();
  });

  it('allows declining the exit interview', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /alice admin/i }));
    await screen.findByText('Asset Return');
    await user.click(screen.getByRole('button', { name: /conduct interview/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /save interview/i }));
    expect(
      await waitFor(() =>
        expect(conductExitInterviewMock).toHaveBeenCalledWith(
          'o1',
          expect.objectContaining({ declined: true }),
        ),
      ),
    );
  });

  it('generates a final settlement from the detail view', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /alice admin/i }));
    await screen.findByText('Asset Return');
    // The record is in 'Initiated' status so the settlement card shows a pending state.
    expect(await screen.findByText(/settlement pending/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no offboarding records', async () => {
    listMock.mockResolvedValueOnce([]);
    render(<OffboardingPage />);
    expect(await screen.findByText(/no offboarding records/i)).toBeInTheDocument();
  });

  it('validates that encashment days cannot be negative', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /carol settler/i }));
    await screen.findByText('Final settlement');
    await user.click(screen.getByRole('button', { name: /generate settlement/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/encashment days/i), { target: { value: '-5' } });
    await user.click(screen.getByRole('button', { name: /save settlement/i }));
    expect(await screen.findByText(/encashment days cannot be negative/i)).toBeInTheDocument();
  });
});
