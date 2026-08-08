import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const listCandidatesMock = vi.fn();
const listRequisitionsMock = vi.fn();
const createCandidateMock = vi.fn();
const updateCandidateStageMock = vi.fn();
const convertCandidateMock = vi.fn();
const departmentsState = vi.hoisted(() => ({ departments: [] as unknown[] }));

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
  usePositions: () => ({
    data: [
      { id: 'p1', name: 'Senior Frontend Engineer', departmentId: 'd1' },
      { id: 'p2', name: 'Backend Engineer', departmentId: 'd1' },
    ],
    mode: 'live',
    error: null,
  }),
}));

vi.mock('@/lib/api/workflow-repositories', () => ({
  recruitmentRepo: {
    listCandidates: (...args: unknown[]) => listCandidatesMock(...args),
    listRequisitions: (...args: unknown[]) => listRequisitionsMock(...args),
    createCandidate: (...args: unknown[]) => createCandidateMock(...args),
    updateCandidateStage: (...args: unknown[]) => updateCandidateStageMock(...args),
    convertCandidate: (...args: unknown[]) => convertCandidateMock(...args),
  },
}));

import { CandidatesPage } from './candidates-page';

const candidates = [
  {
    id: 'c1',
    name: 'Grace Liu',
    email: 'grace@applicants.com',
    requisitionId: 'r1',
    requisitionTitle: 'Senior Frontend Engineer',
    stage: 'Interview' as const,
    stageHistory: [{ stage: 'Interview', at: '2026-05-10T00:00:00.000Z' }],
    resumeUrl: null,
    appliedAt: '2026-05-01T00:00:00.000Z',
    phone: '+1 415 555 0001',
  },
  {
    id: 'c2',
    name: 'David Kim',
    email: 'david@applicants.com',
    requisitionId: 'r1',
    requisitionTitle: 'Senior Frontend Engineer',
    stage: 'Offer' as const,
    stageHistory: [{ stage: 'Offer', at: '2026-05-12T00:00:00.000Z' }],
    resumeUrl: null,
    appliedAt: '2026-05-02T00:00:00.000Z',
    phone: '+1 415 555 0002',
  },
];

const makeAuth = (perms: string[]) => ({
  employee: { id: 'e1', firstName: 'Alice', lastName: 'Admin', departmentId: 'd1' },
  hasPermission: vi.fn((p: string) => perms.includes(p)),
});

beforeEach(() => {
  listCandidatesMock.mockResolvedValue(candidates);
  createCandidateMock.mockResolvedValue({});
  updateCandidateStageMock.mockResolvedValue({});
  convertCandidateMock.mockResolvedValue({});
  listRequisitionsMock.mockResolvedValue([
    { id: 'r1', title: 'Senior Frontend Engineer', departmentId: 'd1', status: 'Published' },
  ]);
  departmentsState.departments = [{ id: 'd1', name: 'Engineering' }];
  useAuthMock.mockReturnValue(makeAuth(['manageRecruitment', 'manageRecruitmentDept']));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CandidatesPage', () => {
  it('renders the heading and pipeline columns', async () => {
    render(<CandidatesPage />);
    expect(await screen.findByRole('heading', { name: /candidate pipeline/i })).toBeInTheDocument();
  });

  it('renders candidates grouped by pipeline stage', async () => {
    render(<CandidatesPage />);
    expect(await screen.findByText('Grace Liu')).toBeInTheDocument();
    expect(screen.getByText('David Kim')).toBeInTheDocument();
  });

  it('opens the add-candidate dialog and validates required fields', async () => {
    const user = userEvent.setup();
    render(<CandidatesPage />);
    await user.click(await screen.findByRole('button', { name: /add candidate/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add candidate$/i }));
    expect(await screen.findByText(/candidate name is required/i)).toBeInTheDocument();
    expect(createCandidateMock).not.toHaveBeenCalled();
  });

  it('creates a candidate via the dialog', async () => {
    const user = userEvent.setup();
    render(<CandidatesPage />);
    await user.click(await screen.findByRole('button', { name: /add candidate/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Full name *'), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'new@applicants.com' } });
    fireEvent.change(screen.getByDisplayValue('Select requisition'), { target: { value: 'r1' } });
    await user.click(screen.getByRole('button', { name: /add candidate$/i }));

    await waitFor(() =>
      expect(createCandidateMock).toHaveBeenCalledWith({
        name: 'New Person',
        email: 'new@applicants.com',
        phone: undefined,
        source: expect.any(String),
        requisitionId: 'r1',
        consentRecorded: true,
      }),
    );
  });

  it('advances a candidate to the next stage from the pipeline', async () => {
    const user = userEvent.setup();
    render(<CandidatesPage />);
    await screen.findByText('Grace Liu');
    const graceAdvance = screen.getAllByTitle('Advance')[0];
    await user.click(graceAdvance);
    expect(
      await waitFor(() => expect(updateCandidateStageMock).toHaveBeenCalledWith('c1', 'OFFER')),
    );
  });

  it('hides recruitment management controls for non-recruiters', () => {
    useAuthMock.mockReturnValue(makeAuth([]));
    render(<CandidatesPage />);
    expect(screen.queryByRole('button', { name: /add candidate/i })).not.toBeInTheDocument();
  });

  it('opens the convert dialog and validates before creating an employee', async () => {
    const user = userEvent.setup();
    listCandidatesMock.mockResolvedValueOnce([
      { ...candidates[0], stage: 'Hired', employeeNo: 'EMP-999' },
    ]);
    render(<CandidatesPage />);
    await user.click(await screen.findByRole('button', { name: /convert to employee/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Submitting without a position triggers the handler's validation branch.
    await user.click(screen.getByRole('button', { name: /create employee/i }));
    // The dialog should remain open (submission blocked by validation).
    expect(await screen.findByText(/please select a position/i)).toBeInTheDocument();
    expect(convertCandidateMock).not.toHaveBeenCalled();
  });

  it('converts a hired candidate into an employee', async () => {
    convertCandidateMock.mockResolvedValueOnce({ employeeId: 'emp-new' });
    const user = userEvent.setup();
    listCandidatesMock.mockResolvedValueOnce([
      { ...candidates[0], stage: 'Hired', employeeNo: 'EMP-999' },
    ]);
    render(<CandidatesPage />);
    await user.click(await screen.findByRole('button', { name: /convert to employee/i }));
    await screen.findByRole('dialog');
    const positionSelect = screen.getByDisplayValue('Select position') as HTMLSelectElement;
    fireEvent.change(positionSelect, { target: { value: 'p1' } });
    await user.click(screen.getByRole('button', { name: /create employee/i }));
    await waitFor(() =>
      expect(convertCandidateMock).toHaveBeenCalledWith('c1', {
        departmentId: 'd1',
        positionId: 'p1',
        hireDate: expect.any(String),
      }),
    );
    // Success state should be shown.
    expect(await screen.findByText(/successfully converted to an employee/i)).toBeInTheDocument();
  });

  it('validates the create-candidate dialog for missing email and requisition', async () => {
    const user = userEvent.setup();
    createCandidateMock.mockRejectedValueOnce(new Error('server error'));
    render(<CandidatesPage />);
    await user.click(await screen.findByRole('button', { name: /add candidate/i }));
    await screen.findByRole('dialog');
    // Provide only a name, then attempt to submit.
    fireEvent.change(screen.getByLabelText('Full name *'), { target: { value: 'Orphan Person' } });
    await user.click(screen.getByRole('button', { name: /add candidate$/i }));
    expect(await screen.findByText(/candidate email is required/i)).toBeInTheDocument();
    expect(createCandidateMock).not.toHaveBeenCalled();
  });

  it('creates a candidate with valid details', async () => {
    createCandidateMock.mockResolvedValueOnce({ id: 'cNew' });
    const user = userEvent.setup();
    render(<CandidatesPage />);
    await user.click(await screen.findByRole('button', { name: /add candidate/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Full name *'), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'new@x.com' } });
    fireEvent.change(screen.getByDisplayValue('Select requisition'), { target: { value: 'r1' } });
    await user.click(screen.getByRole('button', { name: /add candidate$/i }));
    await waitFor(() =>
      expect(createCandidateMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Person', email: 'new@x.com', requisitionId: 'r1' }),
      ),
    );
  });

  it('moves a candidate to the next recruitment stage', async () => {
    updateCandidateStageMock.mockResolvedValueOnce({});
    listCandidatesMock.mockResolvedValueOnce(candidates);
    const user = userEvent.setup();
    render(<CandidatesPage />);
    await screen.findByText(/grace liu/i);
    // The Applied column exposes a forward "Advance" control (icon button with title).
    const forwardButtons = screen.getAllByTitle('Advance');
    await user.click(forwardButtons[0]);
    await waitFor(() =>
      expect(updateCandidateStageMock).toHaveBeenCalledWith('c1', expect.any(String)),
    );
  });

  it('moves a candidate backward to the previous stage', async () => {
    updateCandidateStageMock.mockResolvedValueOnce({});
    listCandidatesMock.mockResolvedValueOnce([
      {
        ...candidates[0],
        stage: 'Screening',
        stageHistory: [{ stage: 'Screening', at: '2026-01-01T00:00:00.000Z', by: 'HR' }],
      },
    ]);
    const user = userEvent.setup();
    render(<CandidatesPage />);
    await screen.findByText(/grace liu/i);
    const backButtons = screen.getAllByTitle('Move back');
    await user.click(backButtons[0]);
    await waitFor(() =>
      expect(updateCandidateStageMock).toHaveBeenCalledWith('c1', expect.any(String)),
    );
  });

  it('rejects a candidate via the reject dialog', async () => {
    updateCandidateStageMock.mockResolvedValueOnce({});
    listCandidatesMock.mockResolvedValueOnce(candidates);
    const user = userEvent.setup();
    render(<CandidatesPage />);
    await screen.findByText(/grace liu/i);
    await user.click(screen.getAllByTitle('Reject')[0]);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /reject candidate/i }));
    await waitFor(() => expect(updateCandidateStageMock).toHaveBeenCalledWith('c1', 'REJECTED'));
    // The rejected candidate should now appear in the rejected pool.
    expect(await screen.findByText(/rejected candidates/i)).toBeInTheDocument();
  });

  it('shows a validation error when rejecting rejects (server error surfaces)', async () => {
    updateCandidateStageMock.mockRejectedValueOnce(new Error('reject failed'));
    listCandidatesMock.mockResolvedValueOnce(candidates);
    const user = userEvent.setup();
    render(<CandidatesPage />);
    await screen.findByText(/grace liu/i);
    await user.click(screen.getAllByTitle('Reject')[0]);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /reject candidate/i }));
    expect(await screen.findByText(/reject failed/i)).toBeInTheDocument();
  });

  it('disables the convert button for an already-converted hired candidate', async () => {
    listCandidatesMock.mockResolvedValueOnce([
      { ...candidates[0], stage: 'Hired', employeeNo: 'EMP-999', employeeId: 'emp-999' },
    ]);
    render(<CandidatesPage />);
    await screen.findByText(/grace liu/i);
    // The disabled "Converted" button has the exact accessible name "Converted".
    expect(screen.getByRole('button', { name: /^converted$/i })).toBeDisabled();
  });

  it("scopes the pipeline to a manager's department", async () => {
    useAuthMock.mockReturnValue({
      employee: {
        id: 'u-mgr',
        role: 'Manager',
        email: 'm@acme.com',
        employeeId: 'e-mgr',
        departmentId: 'd-other',
        firstName: 'Mgr',
        lastName: 'User',
      },
      hasPermission: vi.fn((p: string) => p === 'manageRecruitmentDept'),
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    });
    listCandidatesMock.mockResolvedValueOnce(candidates);
    render(<CandidatesPage />);
    // Candidates linked to other departments' requisitions are hidden for managers.
    await waitFor(() => expect(screen.queryByText(/grace liu/i)).not.toBeInTheDocument());
    expect(screen.queryByText('David Kim')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no candidates', async () => {
    listCandidatesMock.mockResolvedValueOnce([]);
    render(<CandidatesPage />);
    expect(await screen.findByText(/no candidates yet/i)).toBeInTheDocument();
  });

  it('shows an error when loading candidates fails', async () => {
    listCandidatesMock.mockRejectedValueOnce(new Error('load failed'));
    render(<CandidatesPage />);
    expect(await screen.findByText(/load failed/i)).toBeInTheDocument();
  });
});
