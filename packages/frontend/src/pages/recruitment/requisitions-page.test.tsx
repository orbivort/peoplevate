import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const listRequisitionsMock = vi.fn();
const createRequisitionMock = vi.fn();
const submitRequisitionMock = vi.fn();
const approveRequisitionMock = vi.fn();
const publishRequisitionMock = vi.fn();
const closeRequisitionMock = vi.fn();
const deleteRequisitionMock = vi.fn();
const getRequisitionStatsMock = vi.fn();
const departmentsState = vi.hoisted(() => ({ departments: [] as unknown[] }));
const positionsState = vi.hoisted(() => ({
  positions: [
    { id: 'p1', departmentId: 'd1', title: 'Senior FE' },
    { id: 'p2', departmentId: 'd2', title: 'HR Generalist' },
  ],
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
  useDepartments: () => ({ data: departmentsState.departments, mode: 'live', error: null }),
  usePositions: () => ({ data: positionsState.positions, mode: 'live', error: null }),
}));

vi.mock('@/lib/api/workflow-repositories', () => ({
  recruitmentRepo: {
    listRequisitions: (...args: unknown[]) => listRequisitionsMock(...args),
    createRequisition: (...args: unknown[]) => createRequisitionMock(...args),
    submitRequisition: (...args: unknown[]) => submitRequisitionMock(...args),
    approveRequisition: (...args: unknown[]) => approveRequisitionMock(...args),
    publishRequisition: (...args: unknown[]) => publishRequisitionMock(...args),
    closeRequisition: (...args: unknown[]) => closeRequisitionMock(...args),
    deleteRequisition: (...args: unknown[]) => deleteRequisitionMock(...args),
    getRequisitionStats: (...args: unknown[]) => getRequisitionStatsMock(...args),
  },
}));

import { RequisitionsPage } from './requisitions-page';

const requisitions = [
  {
    id: 'r1',
    title: 'Senior Frontend Engineer',
    departmentId: 'd1',
    departmentName: 'Engineering',
    positionId: 'p1',
    positionName: 'Senior FE',
    headcount: 2,
    employmentType: 'FULL_TIME',
    status: 'Published',
    closingDate: '2026-09-01',
    applicantCount: 5,
  },
  {
    id: 'r2',
    title: 'HR Generalist',
    departmentId: 'd2',
    departmentName: 'People',
    positionId: 'p2',
    positionName: 'HR Generalist',
    headcount: 1,
    employmentType: 'FULL_TIME',
    status: 'Draft',
    closingDate: '2026-08-01',
    applicantCount: 0,
  },
];

const makeAuth = (perms: string[]) => ({
  employee: { id: 'e1', firstName: 'Alice', lastName: 'Admin', departmentId: 'd1' },
  hasPermission: vi.fn((p: string) => perms.includes(p)),
});

beforeEach(() => {
  listRequisitionsMock.mockResolvedValue(requisitions);
  createRequisitionMock.mockResolvedValue({});
  submitRequisitionMock.mockResolvedValue({});
  approveRequisitionMock.mockResolvedValue({});
  publishRequisitionMock.mockResolvedValue({});
  closeRequisitionMock.mockResolvedValue({});
  deleteRequisitionMock.mockResolvedValue({});
  getRequisitionStatsMock.mockResolvedValue({ open: 3, pending: 1, applicants: 5, hired: 2 });
  departmentsState.departments = [
    { id: 'd1', name: 'Engineering' },
    { id: 'd2', name: 'People' },
  ];
  useAuthMock.mockReturnValue(makeAuth(['manageRecruitment', 'manageRecruitmentDept']));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RequisitionsPage', () => {
  it('renders the heading and KPI cards', async () => {
    render(<RequisitionsPage />);
    expect(await screen.findByRole('heading', { name: /recruitment/i })).toBeInTheDocument();
    expect(screen.getByText('Open roles')).toBeInTheDocument();
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    expect(screen.getByText('Total applicants')).toBeInTheDocument();
    expect(screen.getByText('Roles filled')).toBeInTheDocument();
  });

  it('lists requisitions in the table', async () => {
    render(<RequisitionsPage />);
    expect(await screen.findByText('Senior Frontend Engineer')).toBeInTheDocument();
    expect(screen.getAllByText('HR Generalist')[0]).toBeInTheDocument();
  });

  it('opens the create dialog and validates required fields', async () => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await user.click(await screen.findByRole('button', { name: /new requisition/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /submit for approval/i }));
    expect(await screen.findByText(/requisition title is required/i)).toBeInTheDocument();
    expect(createRequisitionMock).not.toHaveBeenCalled();
  });

  it('creates a requisition via the dialog', async () => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await user.click(await screen.findByRole('button', { name: /new requisition/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Backend Engineer' } });
    fireEvent.change(screen.getByDisplayValue('Select department'), { target: { value: 'd1' } });
    // Position options depend on the selected department; wait for them to appear.
    const positionSelect = await screen.findByDisplayValue('Select position');
    fireEvent.change(positionSelect, { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Headcount *'), { target: { value: '3' } });
    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() =>
      expect(createRequisitionMock).toHaveBeenCalledWith({
        title: 'Backend Engineer',
        departmentId: 'd1',
        positionId: 'p1',
        headcount: 3,
        employmentType: 'FULL_TIME',
        closingDate: undefined,
      }),
    );
  });

  it('advances a draft requisition via the status action', async () => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await screen.findAllByText('HR Generalist');
    const row = screen.getAllByText('HR Generalist')[0].closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /advance/i }));
    expect(await waitFor(() => expect(submitRequisitionMock).toHaveBeenCalledWith('r2')));
  });

  it('hides recruitment management controls for non-recruiters', () => {
    useAuthMock.mockReturnValue(makeAuth([]));
    render(<RequisitionsPage />);
    expect(screen.queryByRole('button', { name: /new requisition/i })).not.toBeInTheDocument();
  });
});
