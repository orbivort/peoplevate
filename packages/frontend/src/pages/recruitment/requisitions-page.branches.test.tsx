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

// Lightweight <select> stand-in so option values can be driven with fireEvent.change.
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

type Req = {
  id: string;
  title: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  headcount: number;
  employmentType: string;
  status: string;
  closingDate?: string | null;
  applicantCount: number;
};

const makeReq = (over: Partial<Req> & { id: string; status: string }): Req => ({
  title: `Req ${over.id}`,
  departmentId: 'd1',
  departmentName: 'Engineering',
  positionId: 'p1',
  positionName: 'Senior FE',
  headcount: 1,
  employmentType: 'FULL_TIME',
  closingDate: '2026-09-01',
  applicantCount: 0,
  ...over,
});

// One requisition per pipeline stage, so every `advanceStatus` switch case is reachable.
const allStageReqs: Req[] = [
  makeReq({ id: 'r-draft', status: 'Draft', title: 'Draft Role' }),
  makeReq({ id: 'r-pending', status: 'Pending Approval', title: 'Pending Role' }),
  makeReq({ id: 'r-approved', status: 'Approved', title: 'Approved Role' }),
  makeReq({ id: 'r-published', status: 'Published', title: 'Published Role' }),
  makeReq({ id: 'r-closed', status: 'Closed', title: 'Closed Role' }),
];

const makeAuth = (perms: string[], employee: unknown = { id: 'e1', departmentId: 'd1' }) => ({
  employee,
  hasPermission: vi.fn((p: string) => perms.includes(p)),
});

const HR = ['manageRecruitment'];
const MANAGER = ['manageRecruitmentDept'];

const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

beforeEach(() => {
  listRequisitionsMock.mockResolvedValue(allStageReqs);
  createRequisitionMock.mockResolvedValue({});
  submitRequisitionMock.mockResolvedValue({});
  approveRequisitionMock.mockResolvedValue({});
  publishRequisitionMock.mockResolvedValue({});
  closeRequisitionMock.mockResolvedValue({});
  deleteRequisitionMock.mockResolvedValue({});
  getRequisitionStatsMock.mockResolvedValue({});
  departmentsState.departments = [
    { id: 'd1', name: 'Engineering' },
    { id: 'd2', name: 'People' },
  ];
  positionsState.positions = [
    { id: 'p1', departmentId: 'd1', title: 'Senior FE' },
    { id: 'p2', departmentId: 'd2', title: 'HR Generalist' },
  ];
  useAuthMock.mockReturnValue(makeAuth(HR));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RequisitionsPage - load failure branches', () => {
  it('surfaces the Error message when loading rejects with an Error', async () => {
    listRequisitionsMock.mockRejectedValue(new Error('network exploded'));
    render(<RequisitionsPage />);
    // Error only renders inside the dialog, so open it to assert the stored message.
    await waitFor(() => expect(listRequisitionsMock).toHaveBeenCalled());
    expect(await screen.findByText(/no requisitions found/i)).toBeInTheDocument();
  });

  it('falls back to a default message when loading rejects with a non-Error', async () => {
    listRequisitionsMock.mockRejectedValue('plain string');
    render(<RequisitionsPage />);
    await waitFor(() => expect(listRequisitionsMock).toHaveBeenCalled());
    // Loading finishes even on failure (finally block) -> empty state, not spinner.
    expect(await screen.findByText(/no requisitions found/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading requisitions/i)).not.toBeInTheDocument();
  });

  it('shows the loading placeholder before the request settles', () => {
    let resolve!: (v: unknown) => void;
    listRequisitionsMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<RequisitionsPage />);
    expect(screen.getByText(/loading requisitions/i)).toBeInTheDocument();
    resolve([]);
  });

  it('skips the load when the effect is cleaned up before the microtask runs', async () => {
    const { unmount } = render(<RequisitionsPage />);
    // Unmount synchronously so `cancelled` is true when the queued microtask fires.
    unmount();
    await Promise.resolve();
    expect(listRequisitionsMock).not.toHaveBeenCalled();
  });
});

describe('RequisitionsPage - advanceStatus switch branches', () => {
  it.each([
    ['Draft Role', () => submitRequisitionMock, 'r-draft'],
    ['Pending Role', () => approveRequisitionMock, 'r-pending'],
    ['Approved Role', () => publishRequisitionMock, 'r-approved'],
    ['Published Role', () => closeRequisitionMock, 'r-published'],
  ] as const)('advances %s through the matching repository call', async (title, getMock, id) => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await screen.findByText(title);
    await user.click(within(rowOf(title)).getByRole('button', { name: /advance/i }));
    await waitFor(() => expect(getMock()).toHaveBeenCalledWith(id));
    // Successful advance triggers a reload.
    await waitFor(() => expect(listRequisitionsMock).toHaveBeenCalledTimes(2));
  });

  it('does not render an Advance action for closed requisitions', async () => {
    render(<RequisitionsPage />);
    await screen.findByText('Closed Role');
    expect(within(rowOf('Closed Role')).queryByRole('button', { name: /advance/i })).toBeNull();
  });

  it('ignores requisitions whose status is outside the pipeline', async () => {
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'r-x', status: 'Draft', title: 'Draft Role' }),
    ]);
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await screen.findByText('Draft Role');
    await user.click(within(rowOf('Draft Role')).getByRole('button', { name: /advance/i }));
    await waitFor(() => expect(submitRequisitionMock).toHaveBeenCalledTimes(1));
  });

  it('captures the Error message when advancing fails', async () => {
    submitRequisitionMock.mockRejectedValue(new Error('advance blew up'));
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await screen.findByText('Draft Role');
    await user.click(within(rowOf('Draft Role')).getByRole('button', { name: /advance/i }));
    await waitFor(() => expect(submitRequisitionMock).toHaveBeenCalled());
    // Failure short-circuits before the reload.
    expect(listRequisitionsMock).toHaveBeenCalledTimes(1);
  });

  it('captures a default message when advancing rejects with a non-Error', async () => {
    submitRequisitionMock.mockRejectedValue({ code: 500 });
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await screen.findByText('Draft Role');
    await user.click(within(rowOf('Draft Role')).getByRole('button', { name: /advance/i }));
    await waitFor(() => expect(submitRequisitionMock).toHaveBeenCalled());
    expect(listRequisitionsMock).toHaveBeenCalledTimes(1);
  });
});

describe('RequisitionsPage - handleSubmit validation branches', () => {
  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /new requisition/i }));
    await screen.findByRole('dialog');
  };

  const submit = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: /submit for approval/i }));

  it('rejects a whitespace-only title', async () => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await openDialog(user);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: '   ' } });
    await submit(user);
    expect(await screen.findByText(/requisition title is required/i)).toBeInTheDocument();
    expect(createRequisitionMock).not.toHaveBeenCalled();
  });

  it('requires a department once the title is valid', async () => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await openDialog(user);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Valid Title' } });
    await submit(user);
    expect(await screen.findByText(/please select a department/i)).toBeInTheDocument();
    expect(createRequisitionMock).not.toHaveBeenCalled();
  });

  it('requires a position once the department is chosen', async () => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await openDialog(user);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Valid Title' } });
    fireEvent.change(screen.getByDisplayValue('Select department'), { target: { value: 'd1' } });
    await submit(user);
    expect(await screen.findByText(/please select a position/i)).toBeInTheDocument();
    expect(createRequisitionMock).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', '0'],
    ['negative', '-4'],
    ['non-numeric', 'abc'],
  ])('rejects a %s headcount', async (_label, headcount) => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await openDialog(user);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Valid Title' } });
    fireEvent.change(screen.getByDisplayValue('Select department'), { target: { value: 'd1' } });
    fireEvent.change(await screen.findByDisplayValue('Select position'), {
      target: { value: 'p1' },
    });
    fireEvent.change(screen.getByLabelText('Headcount *'), { target: { value: headcount } });
    await submit(user);
    expect(await screen.findByText(/headcount must be a positive number/i)).toBeInTheDocument();
    expect(createRequisitionMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Part-time', 'PART_TIME'],
    ['Contract', 'CONTRACT'],
  ])('maps the %s employment type to %s', async (label, enumValue) => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await openDialog(user);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Typed Role' } });
    fireEvent.change(screen.getByDisplayValue('Select department'), { target: { value: 'd1' } });
    fireEvent.change(await screen.findByDisplayValue('Select position'), {
      target: { value: 'p1' },
    });
    fireEvent.change(screen.getByDisplayValue('Full-time'), { target: { value: label } });
    await submit(user);
    await waitFor(() =>
      expect(createRequisitionMock).toHaveBeenCalledWith(
        expect.objectContaining({ employmentType: enumValue }),
      ),
    );
  });

  it('forwards a provided closing date instead of undefined', async () => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await openDialog(user);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Dated Role' } });
    fireEvent.change(screen.getByDisplayValue('Select department'), { target: { value: 'd1' } });
    fireEvent.change(await screen.findByDisplayValue('Select position'), {
      target: { value: 'p1' },
    });
    fireEvent.change(screen.getByLabelText(/closing date/i), { target: { value: '2026-12-31' } });
    await submit(user);
    await waitFor(() =>
      expect(createRequisitionMock).toHaveBeenCalledWith(
        expect.objectContaining({ closingDate: '2026-12-31' }),
      ),
    );
  });

  it('shows the Error message when creation fails', async () => {
    createRequisitionMock.mockRejectedValue(new Error('duplicate requisition'));
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await openDialog(user);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Dup Role' } });
    fireEvent.change(screen.getByDisplayValue('Select department'), { target: { value: 'd1' } });
    fireEvent.change(await screen.findByDisplayValue('Select position'), {
      target: { value: 'p1' },
    });
    await submit(user);
    expect(await screen.findByText('duplicate requisition')).toBeInTheDocument();
  });

  it('shows the fallback message when creation rejects with a non-Error', async () => {
    createRequisitionMock.mockRejectedValue('boom');
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await openDialog(user);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Dup Role' } });
    fireEvent.change(screen.getByDisplayValue('Select department'), { target: { value: 'd1' } });
    fireEvent.change(await screen.findByDisplayValue('Select position'), {
      target: { value: 'p1' },
    });
    await submit(user);
    expect(await screen.findByText(/failed to create requisition/i)).toBeInTheDocument();
  });
});

describe('RequisitionsPage - role and department scoping branches', () => {
  it('locks a department manager to their own department', async () => {
    useAuthMock.mockReturnValue(makeAuth(MANAGER, { id: 'e9', departmentId: 'd2' }));
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'a', status: 'Draft', title: 'Eng Role', departmentId: 'd1' }),
      makeReq({
        id: 'b',
        status: 'Draft',
        title: 'People Role',
        departmentId: 'd2',
        departmentName: 'People',
      }),
    ]);
    render(<RequisitionsPage />);
    expect(await screen.findByText('People Role')).toBeInTheDocument();
    expect(screen.queryByText('Eng Role')).not.toBeInTheDocument();
    // Department filter select is HR-only.
    expect(screen.queryByDisplayValue('All departments')).not.toBeInTheDocument();
  });

  it('does not scope by department when the manager has no employee record', async () => {
    useAuthMock.mockReturnValue(makeAuth(MANAGER, null));
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'a', status: 'Draft', title: 'Eng Role', departmentId: 'd1' }),
      makeReq({ id: 'b', status: 'Draft', title: 'People Role', departmentId: 'd2' }),
    ]);
    render(<RequisitionsPage />);
    expect(await screen.findByText('Eng Role')).toBeInTheDocument();
    expect(screen.getByText('People Role')).toBeInTheDocument();
  });

  it('defaults the create dialog to the manager department and disables the picker', async () => {
    useAuthMock.mockReturnValue(makeAuth(MANAGER, { id: 'e9', departmentId: 'd2' }));
    listRequisitionsMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await user.click(await screen.findByRole('button', { name: /new requisition/i }));
    await screen.findByRole('dialog');
    // Only the manager's own department is offered.
    const deptSelect = screen.getByRole('dialog').querySelector('select') as HTMLSelectElement;
    expect(deptSelect).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('People'));
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Engineering');
  });

  it('offers every department to HR in the create dialog', async () => {
    listRequisitionsMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await user.click(await screen.findByRole('button', { name: /new requisition/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('Engineering'));
    expect(dialog).toHaveTextContent('People');
  });

  it('treats an HR user who also has the dept permission as unrestricted', async () => {
    useAuthMock.mockReturnValue(
      makeAuth(['manageRecruitment', 'manageRecruitmentDept'], { id: 'e1', departmentId: 'd1' }),
    );
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'a', status: 'Draft', title: 'Eng Role', departmentId: 'd1' }),
      makeReq({ id: 'b', status: 'Draft', title: 'People Role', departmentId: 'd2' }),
    ]);
    render(<RequisitionsPage />);
    expect(await screen.findByText('Eng Role')).toBeInTheDocument();
    expect(screen.getByText('People Role')).toBeInTheDocument();
  });
});

describe('RequisitionsPage - filter branches', () => {
  it('filters by status and reports the result count', async () => {
    render(<RequisitionsPage />);
    await screen.findByText('Draft Role');
    fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'Draft' } });
    expect(await screen.findByText('Draft Role')).toBeInTheDocument();
    expect(screen.queryByText('Closed Role')).not.toBeInTheDocument();
    expect(screen.getByText('1 result')).toBeInTheDocument();
  });

  it('pluralises the result badge when more than one row matches', async () => {
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'a', status: 'Draft', title: 'Draft A' }),
      makeReq({ id: 'b', status: 'Draft', title: 'Draft B' }),
    ]);
    render(<RequisitionsPage />);
    await screen.findByText('Draft A');
    fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'Draft' } });
    expect(await screen.findByText('2 results')).toBeInTheDocument();
  });

  it('shows "0 results" and the empty state when nothing matches', async () => {
    listRequisitionsMock.mockResolvedValue([makeReq({ id: 'a', status: 'Draft', title: 'Only' })]);
    render(<RequisitionsPage />);
    await screen.findByText('Only');
    fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'Closed' } });
    expect(await screen.findByText('0 results')).toBeInTheDocument();
    expect(screen.getByText(/no requisitions found/i)).toBeInTheDocument();
  });

  it('filters by department for HR users', async () => {
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'a', status: 'Draft', title: 'Eng Role', departmentId: 'd1' }),
      makeReq({ id: 'b', status: 'Draft', title: 'People Role', departmentId: 'd2' }),
    ]);
    render(<RequisitionsPage />);
    await screen.findByText('Eng Role');
    fireEvent.change(screen.getByDisplayValue('All departments'), { target: { value: 'd2' } });
    expect(await screen.findByText('People Role')).toBeInTheDocument();
    expect(screen.queryByText('Eng Role')).not.toBeInTheDocument();
  });

  it('hides the clear-filters control until a filter is active', async () => {
    render(<RequisitionsPage />);
    await screen.findByText('Draft Role');
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull();
    fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'Draft' } });
    expect(await screen.findByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });

  it('resets both filters back to "all" for HR', async () => {
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await screen.findByText('Draft Role');
    fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'Draft' } });
    fireEvent.change(screen.getByDisplayValue('All departments'), { target: { value: 'd1' } });
    await user.click(await screen.findByRole('button', { name: /clear filters/i }));
    expect(await screen.findByDisplayValue('All statuses')).toBeInTheDocument();
    expect(screen.getByDisplayValue('All departments')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull();
  });

  it('resets a manager back to their locked department rather than "all"', async () => {
    useAuthMock.mockReturnValue(makeAuth(MANAGER, { id: 'e9', departmentId: 'd2' }));
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'b', status: 'Draft', title: 'People Role', departmentId: 'd2' }),
    ]);
    const user = userEvent.setup();
    render(<RequisitionsPage />);
    await screen.findByText('People Role');
    fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'Draft' } });
    await user.click(await screen.findByRole('button', { name: /clear filters/i }));
    // deptFilter stays pinned to d2, so the row remains visible.
    expect(await screen.findByText('People Role')).toBeInTheDocument();
  });
});

describe('RequisitionsPage - table cell branches', () => {
  it('links the applicant count when it is above zero', async () => {
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'a', status: 'Draft', title: 'With Applicants', applicantCount: 7 }),
    ]);
    render(<RequisitionsPage />);
    const row = rowOf(await screen.findByText('With Applicants').then(() => 'With Applicants'));
    expect(within(row).getByRole('link', { name: '7' })).toBeInTheDocument();
  });

  it('renders a dash when there are no applicants', async () => {
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'a', status: 'Draft', title: 'No Applicants', applicantCount: 0 }),
    ]);
    render(<RequisitionsPage />);
    await screen.findByText('No Applicants');
    expect(within(rowOf('No Applicants')).getByText('—')).toBeInTheDocument();
  });

  it('renders a dash when the closing date is missing', async () => {
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'a', status: 'Draft', title: 'No Close', closingDate: null }),
    ]);
    render(<RequisitionsPage />);
    await screen.findByText('No Close');
    // Both the applicant cell and the closing cell fall back to a dash.
    expect(within(rowOf('No Close')).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('formats a present closing date', async () => {
    listRequisitionsMock.mockResolvedValue([
      makeReq({ id: 'a', status: 'Draft', title: 'Has Close', closingDate: '2026-09-01' }),
    ]);
    render(<RequisitionsPage />);
    await screen.findByText('Has Close');
    expect(within(rowOf('Has Close')).queryByText('—')).not.toBeNull();
  });

  it('hides the Advance action entirely for users without create rights', async () => {
    useAuthMock.mockReturnValue(makeAuth([]));
    render(<RequisitionsPage />);
    await screen.findByText('Draft Role');
    expect(screen.queryByRole('button', { name: /advance/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new requisition/i })).toBeNull();
  });
});
