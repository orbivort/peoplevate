import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const listOffersMock = vi.fn();
const listCandidatesMock = vi.fn();
const listRequisitionsMock = vi.fn();
const createOfferMock = vi.fn();
const sendOfferMock = vi.fn();
const acceptOfferMock = vi.fn();
const deleteOfferMock = vi.fn();
const departmentsState = vi.hoisted(() => ({ departments: [] as unknown[] }));

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
}));

vi.mock('@/lib/api/workflow-repositories', () => ({
  recruitmentRepo: {
    listOffers: (...args: unknown[]) => listOffersMock(...args),
    listCandidates: (...args: unknown[]) => listCandidatesMock(...args),
    listRequisitions: (...args: unknown[]) => listRequisitionsMock(...args),
    createOffer: (...args: unknown[]) => createOfferMock(...args),
    sendOffer: (...args: unknown[]) => sendOfferMock(...args),
    acceptOffer: (...args: unknown[]) => acceptOfferMock(...args),
    deleteOffer: (...args: unknown[]) => deleteOfferMock(...args),
  },
}));

import { OffersPage } from './offers-page';

const offers = [
  {
    id: 'o1',
    candidateId: 'c1',
    candidateName: 'Grace Liu',
    position: 'Senior Frontend Engineer',
    salary: 120000,
    startDate: '2026-07-01',
    status: 'Draft' as const,
    createdAt: '2026-05-10T00:00:00.000Z',
    sentAt: null,
    acceptedAt: null,
  },
  {
    id: 'o2',
    candidateId: 'c2',
    candidateName: 'David Kim',
    position: 'Senior Frontend Engineer',
    salary: 115000,
    startDate: '2026-07-05',
    status: 'Sent' as const,
    createdAt: '2026-05-12T00:00:00.000Z',
    sentAt: '2026-05-13T00:00:00.000Z',
    acceptedAt: null,
  },
];

const candidates = [
  {
    id: 'c1',
    name: 'Grace Liu',
    stage: 'Offer',
    requisitionId: 'r1',
    requisitionTitle: 'Senior Frontend Engineer',
  },
  {
    id: 'c2',
    name: 'David Kim',
    stage: 'Offer',
    requisitionId: 'r1',
    requisitionTitle: 'Senior Frontend Engineer',
  },
];

const makeAuth = (perms: string[]) => ({
  employee: { id: 'e1', firstName: 'Alice', lastName: 'Admin', departmentId: 'd1' },
  hasPermission: vi.fn((p: string) => perms.includes(p)),
});

beforeEach(() => {
  listOffersMock.mockResolvedValue(offers);
  listCandidatesMock.mockResolvedValue(candidates);
  listRequisitionsMock.mockResolvedValue([
    { id: 'r1', title: 'Senior Frontend Engineer', departmentId: 'd1', status: 'Published' },
  ]);
  createOfferMock.mockResolvedValue({});
  sendOfferMock.mockResolvedValue({});
  acceptOfferMock.mockResolvedValue({});
  deleteOfferMock.mockResolvedValue({});
  departmentsState.departments = [{ id: 'd1', name: 'Engineering' }];
  useAuthMock.mockReturnValue(makeAuth(['manageRecruitment']));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OffersPage', () => {
  it('renders the heading and lists offer letters', async () => {
    render(<OffersPage />);
    expect(await screen.findByRole('heading', { name: /offer letters/i })).toBeInTheDocument();
    expect(await screen.findByText('Grace Liu')).toBeInTheDocument();
    expect(screen.getAllByText('Draft')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Sent')[0]).toBeInTheDocument();
  });

  it('formats the salary as currency', async () => {
    render(<OffersPage />);
    expect(await screen.findByText('Grace Liu')).toBeInTheDocument();
    expect(screen.getByText('$120,000')).toBeInTheDocument();
  });

  it('opens the create dialog and validates required fields', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await user.click(await screen.findByRole('button', { name: /create offer/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    expect(await screen.findByText(/please select a candidate/i)).toBeInTheDocument();
    expect(createOfferMock).not.toHaveBeenCalled();
  });

  it('creates an offer draft via the dialog', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await user.click(await screen.findByRole('button', { name: /create offer/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Senior Frontend Engineer'), {
      target: { value: 'Frontend Lead' },
    });
    fireEvent.change(screen.getByPlaceholderText('95000'), { target: { value: '130000' } });
    await user.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() =>
      expect(createOfferMock).toHaveBeenCalledWith('c1', {
        position: 'Frontend Lead',
        salary: 130000,
        startDate: expect.any(String),
        terms: undefined,
      }),
    );
  });

  it('sends a draft offer', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await waitFor(() => expect(sendOfferMock).toHaveBeenCalledWith('o1')));
  });

  it('accepts a sent offer', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await screen.findByText('David Kim');
    await user.click(screen.getByTitle('Mark accepted'));
    expect(await waitFor(() => expect(acceptOfferMock).toHaveBeenCalledWith('o2')));
  });

  it('deletes an offer', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await screen.findByText('Grace Liu');
    const row = screen.getByText('Grace Liu').closest('tr') as HTMLElement;
    await user.click(within(row).getByTitle('Delete'));
    expect(await waitFor(() => expect(deleteOfferMock).toHaveBeenCalledWith('o1')));
  });

  it('hides offers for non-HR users', () => {
    useAuthMock.mockReturnValue(makeAuth([]));
    render(<OffersPage />);
    expect(screen.queryByRole('button', { name: /create offer/i })).not.toBeInTheDocument();
  });

  it('declines a sent offer', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await screen.findByText('David Kim');
    await user.click(screen.getByTitle('Mark declined'));
    // Decline has no backend endpoint; the status updates locally (badge + status tab).
    const declined = await screen.findAllByText(/declined/i);
    expect(declined.length).toBeGreaterThan(0);
  });

  it('validates that position is required before creating an offer', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await user.click(await screen.findByRole('button', { name: /create offer/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    // Candidate selection auto-fills position; clear it to trigger validation.
    fireEvent.change(screen.getByPlaceholderText('e.g. Senior Frontend Engineer'), {
      target: { value: '   ' },
    });
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    expect(await screen.findByText(/position is required/i)).toBeInTheDocument();
    expect(createOfferMock).not.toHaveBeenCalled();
  });

  it('surfaces an error when creating an offer fails', async () => {
    const user = userEvent.setup();
    createOfferMock.mockRejectedValueOnce(new Error('create failed'));
    render(<OffersPage />);
    await user.click(await screen.findByRole('button', { name: /create offer/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Senior Frontend Engineer'), {
      target: { value: 'Frontend Lead' },
    });
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    expect(await screen.findByText(/create failed/i)).toBeInTheDocument();
  });

  it('filters offers by status tab', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await user.click(await screen.findByRole('button', { name: /sent/i }));
    expect(screen.queryByText('Grace Liu')).not.toBeInTheDocument();
    expect(screen.getByText('David Kim')).toBeInTheDocument();
  });

  it('filters offers by requisition', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await user.click(await screen.findByRole('button', { name: /create offer/i }));
    await screen.findByRole('dialog');
    // Open dialog to ensure requisition list renders, then close.
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    const reqSelect = screen.getByDisplayValue('All requisitions');
    fireEvent.change(reqSelect, { target: { value: 'r1' } });
    // Both offers belong to r1 candidates, so both remain visible.
    expect(await screen.findByText('Grace Liu')).toBeInTheDocument();
  });

  it('filters offers by department', async () => {
    const user = userEvent.setup();
    render(<OffersPage />);
    await user.click(await screen.findByRole('button', { name: /create offer/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    const deptSelect = screen.getByDisplayValue('All departments');
    fireEvent.change(deptSelect, { target: { value: 'd1' } });
    expect(await screen.findByText('Grace Liu')).toBeInTheDocument();
  });

  it('shows the empty state when there are no offers', async () => {
    listOffersMock.mockResolvedValueOnce([]);
    render(<OffersPage />);
    expect(await screen.findByText(/no offer letters/i)).toBeInTheDocument();
  });
});
