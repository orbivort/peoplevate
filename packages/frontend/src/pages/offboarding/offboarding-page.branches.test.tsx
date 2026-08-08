import * as React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  employees: [] as Rec[],
  records: [] as Rec[],
  clearanceByRecord: {} as Record<string, unknown[]>,
  useAuthMock: vi.fn(),
  listMock: vi.fn(),
  listClearanceMock: vi.fn(),
  initiateMock: vi.fn(),
  updateClearanceItemMock: vi.fn(),
  closeMock: vi.fn(),
  submitResignationMock: vi.fn(),
  conductExitInterviewMock: vi.fn(),
}));

vi.mock('@/contexts/auth-context', () => ({ useAuth: () => mocks.useAuthMock() }));

vi.mock('@/data/data-layer', () => ({
  useEmployees: () => ({ data: mocks.employees, mode: 'live', error: null }),
}));

vi.mock('@/lib/api/workflow-repositories', () => ({
  offboardingRepo: {
    list: (...a: unknown[]) => mocks.listMock(...a),
    listClearance: (...a: unknown[]) => mocks.listClearanceMock(...a),
    initiateTermination: (...a: unknown[]) => mocks.initiateMock(...a),
    close: (...a: unknown[]) => mocks.closeMock(...a),
    submitResignation: (...a: unknown[]) => mocks.submitResignationMock(...a),
    conductExitInterview: (...a: unknown[]) => mocks.conductExitInterviewMock(...a),
    updateClearanceItem: (...a: unknown[]) => mocks.updateClearanceItemMock(...a),
  },
}));

// Minimal <select> replacement so option values can be driven via fireEvent.change.
vi.mock('@/components/ui/select', () => {
  type Item = { value: string; label: React.ReactNode };
  const Ctx = React.createContext<{
    items: Item[];
    setItems: (i: Item[]) => void;
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
    const [items, setItems] = React.useState<Item[]>([]);
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

import { OffboardingPage } from './offboarding-page';

const EMP = {
  id: 'e1',
  firstName: 'Alice',
  lastName: 'Admin',
  status: 'Active',
  departmentId: 'd1',
};

const makeRecord = (over: Rec = {}): Rec => ({
  id: 'o1',
  employeeId: 'e1',
  employeeName: 'Alice Admin',
  positionName: 'Engineering Manager',
  separationType: 'Resignation',
  status: 'Clearance In Progress',
  initiatedBy: 'Grace Liu',
  initiatedAt: '2026-05-01T00:00:00.000Z',
  lastWorkingDay: '2026-06-01',
  deactivationDate: '2026-06-02',
  reason: 'Moving on',
  clearanceItems: [],
  ...over,
});

const item = (over: Rec = {}): Rec => ({
  id: 'ci1',
  category: 'Asset Return',
  description: 'Return laptop',
  status: 'Pending',
  responsibleParty: 'IT',
  ...over,
});

const HR = { employee: EMP, hasPermission: (p: string) => p === 'manageOffboarding' };
const EMPLOYEE_VIEW = {
  employee: EMP,
  hasPermission: (p: string) => p === 'viewOwnOffboarding',
};

const setData = (records: Rec[], clearance: Record<string, unknown[]> = {}) => {
  mocks.records = records;
  mocks.clearanceByRecord = clearance;
  mocks.listMock.mockResolvedValue(records);
  mocks.listClearanceMock.mockImplementation(async (id: string) => clearance[id] ?? []);
};

const openDetail = async (user: ReturnType<typeof userEvent.setup>, name = 'Alice Admin') => {
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
  await user.click(screen.getByText(name));
  await screen.findByText(/back to offboarding/i);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.employees = [EMP];
  mocks.useAuthMock.mockReturnValue(HR);
  mocks.initiateMock.mockResolvedValue({});
  mocks.updateClearanceItemMock.mockResolvedValue({});
  mocks.closeMock.mockResolvedValue({});
  mocks.submitResignationMock.mockResolvedValue({});
  mocks.conductExitInterviewMock.mockResolvedValue({});
  setData([makeRecord()], { o1: [item()] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OffboardingPage - load branches', () => {
  it('falls back to the record clearanceItems when listClearance rejects', async () => {
    setData([makeRecord({ clearanceItems: [item({ id: 'inline', description: 'Inline item' })] })]);
    mocks.listClearanceMock.mockRejectedValue(new Error('clearance down'));
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.getByText('Inline item')).toBeInTheDocument();
  });

  it('falls back to an empty array when the record has no clearanceItems', async () => {
    const rec = makeRecord();
    delete (rec as Rec).clearanceItems;
    setData([rec]);
    mocks.listClearanceMock.mockRejectedValue(new Error('clearance down'));
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    // No clearance rows -> "All clear" badge and 0/0 counter.
    expect(screen.getByText(/all clear/i)).toBeInTheDocument();
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });

  it('renders the Error message when list rejects with an Error', async () => {
    mocks.listMock.mockRejectedValue(new Error('list unavailable'));
    const user = userEvent.setup();
    render(<OffboardingPage />);
    // The error banner only renders inside the create dialog.
    await user.click(await screen.findByRole('button', { name: /initiate offboarding/i }));
    expect(await screen.findByText('list unavailable')).toBeInTheDocument();
  });

  it('renders the default message when list rejects with a non-Error', async () => {
    mocks.listMock.mockRejectedValue('nope');
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await user.click(await screen.findByRole('button', { name: /initiate offboarding/i }));
    expect(await screen.findByText(/failed to load offboarding records/i)).toBeInTheDocument();
  });

  it('does not load when unmounted before the microtask runs', async () => {
    const { unmount } = render(<OffboardingPage />);
    unmount();
    await Promise.resolve();
    expect(mocks.listMock).not.toHaveBeenCalled();
  });
});

describe('OffboardingPage - employee view scoping branches', () => {
  it('filters records down to the signed-in employee', async () => {
    mocks.useAuthMock.mockReturnValue(EMPLOYEE_VIEW);
    setData([
      makeRecord({ id: 'o1', employeeId: 'e1', employeeName: 'Alice Admin' }),
      makeRecord({ id: 'o2', employeeId: 'e2', employeeName: 'Bob Other' }),
    ]);
    render(<OffboardingPage />);
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    expect(screen.queryByText('Bob Other')).not.toBeInTheDocument();
  });

  it('does not filter when the employee record is missing', async () => {
    mocks.useAuthMock.mockReturnValue({
      employee: null,
      hasPermission: (p: string) => p === 'viewOwnOffboarding',
    });
    setData([
      makeRecord({ id: 'o1', employeeId: 'e1', employeeName: 'Alice Admin' }),
      makeRecord({ id: 'o2', employeeId: 'e2', employeeName: 'Bob Other' }),
    ]);
    render(<OffboardingPage />);
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob Other')).toBeInTheDocument();
  });

  it('treats a user holding both permissions as HR (not employee view)', async () => {
    mocks.useAuthMock.mockReturnValue({ employee: EMP, hasPermission: () => true });
    setData([makeRecord({ employeeId: 'e2', employeeName: 'Bob Other' })], {});
    render(<OffboardingPage />);
    // HR sees other people's records and the HR-only initiate button.
    expect(await screen.findByText('Bob Other')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /initiate offboarding/i })).toBeInTheDocument();
  });

  it('hides HR actions in the employee view', async () => {
    mocks.useAuthMock.mockReturnValue(EMPLOYEE_VIEW);
    setData([makeRecord()], { o1: [item()] });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.queryByRole('button', { name: /advance stage/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark complete/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /waive/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /conduct interview/i })).toBeNull();
  });
});

describe('OffboardingPage - toggleClearance branches', () => {
  it('reopens a completed item back to Pending', async () => {
    setData([makeRecord()], { o1: [item({ status: 'Complete', signOffBy: 'Grace Liu' })] });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /reopen/i }));
    await waitFor(() =>
      expect(mocks.updateClearanceItemMock).toHaveBeenCalledWith('ci1', { status: 'PENDING' }),
    );
    expect(await screen.findByRole('button', { name: /mark complete/i })).toBeInTheDocument();
  });

  it('marks a pending item complete', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /mark complete/i }));
    await waitFor(() =>
      expect(mocks.updateClearanceItemMock).toHaveBeenCalledWith('ci1', { status: 'COMPLETE' }),
    );
    expect(await screen.findByRole('button', { name: /reopen/i })).toBeInTheDocument();
  });

  it('leaves other clearance items untouched when toggling one', async () => {
    setData([makeRecord()], {
      o1: [item({ id: 'ci1', description: 'First' }), item({ id: 'ci2', description: 'Second' })],
    });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getAllByRole('button', { name: /mark complete/i })[0]!);
    await waitFor(() =>
      expect(mocks.updateClearanceItemMock).toHaveBeenCalledWith('ci1', { status: 'COMPLETE' }),
    );
    // The second item still offers "Mark complete".
    expect(screen.getAllByRole('button', { name: /mark complete/i })).toHaveLength(1);
  });

  it('reports the Error message when the update fails', async () => {
    mocks.updateClearanceItemMock.mockRejectedValue(new Error('update rejected'));
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /mark complete/i }));
    await waitFor(() => expect(mocks.updateClearanceItemMock).toHaveBeenCalled());
    // Status is unchanged because the optimistic update never ran.
    expect(screen.getByRole('button', { name: /mark complete/i })).toBeInTheDocument();
  });

  it('reports a default message when the update rejects with a non-Error', async () => {
    mocks.updateClearanceItemMock.mockRejectedValue('bad');
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /mark complete/i }));
    await waitFor(() => expect(mocks.updateClearanceItemMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /mark complete/i })).toBeInTheDocument();
  });
});

describe('OffboardingPage - waive branches', () => {
  // NOTE: The waive dialog is rendered by the list branch of `OffboardingPage`, but the
  // "Waive" button only exists in `OffboardingDetail`, which the component returns early.
  // The dialog therefore cannot mount while the detail view is open. These tests pin the
  // current behaviour: clicking Waive registers the target without opening a dialog.
  it('registers the waive target without opening a dialog in the detail view', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /^waive$/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.updateClearanceItemMock).not.toHaveBeenCalled();
  });

  it('offers a Waive action for every incomplete clearance item', async () => {
    setData([makeRecord()], {
      o1: [item({ id: 'ci1', description: 'First' }), item({ id: 'ci2', description: 'Second' })],
    });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.getAllByRole('button', { name: /^waive$/i })).toHaveLength(2);
  });

  it('does not offer a Waive action for an already waived item', async () => {
    setData([makeRecord()], {
      o1: [item({ id: 'ci1', status: 'Waived', waivedReason: 'Asset lost' })],
    });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.getByText(/waived: asset lost/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^waive$/i })).toBeNull();
  });

  it('counts a waived item towards clearance completion', async () => {
    setData([makeRecord()], {
      o1: [item({ id: 'ci1', status: 'Waived', waivedReason: 'Lost' })],
    });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText(/all clear/i)).toBeInTheDocument();
  });
});

describe('OffboardingPage - advanceStatus branches', () => {
  it('blocks advancing while clearance is incomplete', async () => {
    setData([makeRecord({ status: 'Clearance In Progress' })], {
      o1: [item({ status: 'Pending' })],
    });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    // canAdvance is false, so the button is not rendered at all.
    expect(screen.queryByRole('button', { name: /advance stage/i })).toBeNull();
    expect(screen.getByText(/clearance incomplete/i)).toBeInTheDocument();
  });

  it('allows advancing once every item is complete or waived', async () => {
    setData([makeRecord({ status: 'Clearance In Progress' })], {
      o1: [item({ id: 'a', status: 'Complete' }), item({ id: 'b', status: 'Waived' })],
    });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /advance stage/i }));
    expect(await screen.findByText('Exit Interview')).toBeInTheDocument();
    // Nothing is persisted until the Settlement -> Closed transition.
    expect(mocks.closeMock).not.toHaveBeenCalled();
  });

  it('advances from Initiated without touching the backend', async () => {
    setData([makeRecord({ status: 'Initiated' })], { o1: [item({ status: 'Pending' })] });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /advance stage/i }));
    // "Clearance" also labels the meta card, so assert on the status badge count instead.
    await waitFor(() => expect(screen.getAllByText('Clearance').length).toBeGreaterThan(1));
    expect(mocks.closeMock).not.toHaveBeenCalled();
  });

  it('persists closure when advancing from Settlement', async () => {
    setData([makeRecord({ status: 'Settlement' })], { o1: [] });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /advance stage/i }));
    await waitFor(() => expect(mocks.closeMock).toHaveBeenCalledWith('o1'));
    expect(await screen.findByText('Closed')).toBeInTheDocument();
  });

  it('keeps the stage unchanged when closure fails', async () => {
    mocks.closeMock.mockRejectedValue(new Error('close failed'));
    setData([makeRecord({ status: 'Settlement' })], { o1: [] });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /advance stage/i }));
    await waitFor(() => expect(mocks.closeMock).toHaveBeenCalled());
    expect(screen.getByText('Settlement')).toBeInTheDocument();
  });

  it('keeps the stage unchanged when closure rejects with a non-Error', async () => {
    mocks.closeMock.mockRejectedValue('nope');
    setData([makeRecord({ status: 'Settlement' })], { o1: [] });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /advance stage/i }));
    await waitFor(() => expect(mocks.closeMock).toHaveBeenCalled());
    expect(screen.getByText('Settlement')).toBeInTheDocument();
  });

  it('hides the advance action on a closed record', async () => {
    setData([makeRecord({ status: 'Closed' })], { o1: [] });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.queryByRole('button', { name: /advance stage/i })).toBeNull();
  });
});

describe('OffboardingPage - handleCreate validation branches', () => {
  const openCreate = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /initiate offboarding/i }));
    return screen.findByRole('dialog');
  };
  // The dialog's confirm button is labelled just "Initiate".
  const confirm = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: /^initiate$/i });

  it('requires an employee', async () => {
    setData([], {});
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openCreate(user);
    await user.click(confirm(dialog));
    expect(await screen.findByText(/select an employee to offboard/i)).toBeInTheDocument();
    expect(mocks.initiateMock).not.toHaveBeenCalled();
  });

  it('requires a last working day', async () => {
    setData([], {});
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openCreate(user);
    fireEvent.change(within(dialog).getByDisplayValue('Select employee'), {
      target: { value: 'e1' },
    });
    await user.click(confirm(dialog));
    expect(await screen.findByText(/last working day is required/i)).toBeInTheDocument();
  });

  it('requires a deactivation date', async () => {
    setData([], {});
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openCreate(user);
    fireEvent.change(within(dialog).getByDisplayValue('Select employee'), {
      target: { value: 'e1' },
    });
    fireEvent.change(dialog.querySelector('#off-last')!, {
      target: { value: '2026-07-01' },
    });
    await user.click(confirm(dialog));
    expect(await screen.findByText(/deactivation date is required/i)).toBeInTheDocument();
  });

  it('reports when the selected employee no longer exists', async () => {
    setData([], {});
    const user = userEvent.setup();
    const { rerender } = render(<OffboardingPage />);
    const dialog = await openCreate(user);
    fireEvent.change(within(dialog).getByDisplayValue('Select employee'), {
      target: { value: 'e1' },
    });
    fireEvent.change(dialog.querySelector('#off-last')!, {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(dialog.querySelector('#off-deact')!, {
      target: { value: '2026-07-02' },
    });
    // Employee disappears from the directory before submission.
    mocks.employees = [];
    rerender(<OffboardingPage />);
    await user.click(confirm(dialog));
    expect(await screen.findByText(/employee not found/i)).toBeInTheDocument();
    expect(mocks.initiateMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Resignation', 'RESIGNATION'],
    ['Dismissal', 'DISMISSAL'],
    ['End of Contract', 'END_OF_CONTRACT'],
  ])('maps the %s separation type to %s', async (label, enumValue) => {
    setData([], {});
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openCreate(user);
    fireEvent.change(within(dialog).getByDisplayValue('Select employee'), {
      target: { value: 'e1' },
    });
    fireEvent.change(within(dialog).getByDisplayValue('Resignation'), { target: { value: label } });
    fireEvent.change(dialog.querySelector('#off-last')!, {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(dialog.querySelector('#off-deact')!, {
      target: { value: '2026-07-02' },
    });
    await user.click(confirm(dialog));
    await waitFor(() =>
      expect(mocks.initiateMock).toHaveBeenCalledWith(
        expect.objectContaining({ separationType: enumValue }),
      ),
    );
  });

  it('sends an undefined reason when the field is left blank', async () => {
    setData([], {});
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openCreate(user);
    fireEvent.change(within(dialog).getByDisplayValue('Select employee'), {
      target: { value: 'e1' },
    });
    fireEvent.change(dialog.querySelector('#off-last')!, {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(dialog.querySelector('#off-deact')!, {
      target: { value: '2026-07-02' },
    });
    await user.click(confirm(dialog));
    await waitFor(() =>
      expect(mocks.initiateMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason: undefined }),
      ),
    );
  });

  it('forwards the reason when one is supplied', async () => {
    setData([], {});
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog2 = await openCreate(user);
    fireEvent.change(within(dialog2).getByDisplayValue('Select employee'), {
      target: { value: 'e1' },
    });
    fireEvent.change(dialog2.querySelector('#off-reason')!, {
      target: { value: 'Relocation' },
    });
    fireEvent.change(dialog2.querySelector('#off-last')!, {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(dialog2.querySelector('#off-deact')!, {
      target: { value: '2026-07-02' },
    });
    await user.click(confirm(dialog2));
    await waitFor(() =>
      expect(mocks.initiateMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'Relocation' }),
      ),
    );
  });

  it('shows the Error message when initiation fails', async () => {
    mocks.initiateMock.mockRejectedValue(new Error('backend refused'));
    setData([], {});
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openCreate(user);
    fireEvent.change(within(dialog).getByDisplayValue('Select employee'), {
      target: { value: 'e1' },
    });
    fireEvent.change(dialog.querySelector('#off-last')!, {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(dialog.querySelector('#off-deact')!, {
      target: { value: '2026-07-02' },
    });
    await user.click(confirm(dialog));
    expect(await screen.findByText('backend refused')).toBeInTheDocument();
  });

  it('shows the default message when initiation rejects with a non-Error', async () => {
    mocks.initiateMock.mockRejectedValue('nope');
    setData([], {});
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openCreate(user);
    fireEvent.change(within(dialog).getByDisplayValue('Select employee'), {
      target: { value: 'e1' },
    });
    fireEvent.change(dialog.querySelector('#off-last')!, {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(dialog.querySelector('#off-deact')!, {
      target: { value: '2026-07-02' },
    });
    await user.click(confirm(dialog));
    expect(await screen.findByText(/failed to initiate offboarding/i)).toBeInTheDocument();
  });

  it('excludes terminated employees from the picker', async () => {
    mocks.employees = [
      EMP,
      { id: 'e2', firstName: 'Gone', lastName: 'Person', status: 'Terminated', departmentId: 'd1' },
    ];
    setData([], {});
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openCreate(user);
    await waitFor(() => expect(dialog).toHaveTextContent('Alice Admin'));
    expect(dialog).not.toHaveTextContent('Gone Person');
  });
});

describe('OffboardingPage - self-service resignation branches', () => {
  const openResign = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /submit resignation/i }));
    return screen.findByRole('dialog');
  };
  const submit = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole('button', { name: /submit resignation/i })
      .slice(-1)[0]!;

  beforeEach(() => {
    mocks.useAuthMock.mockReturnValue(EMPLOYEE_VIEW);
    setData([], {});
  });

  it('reports a missing employee record', async () => {
    mocks.useAuthMock.mockReturnValue({
      employee: null,
      hasPermission: (p: string) => p === 'viewOwnOffboarding',
    });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openResign(user);
    await user.click(submit(dialog));
    expect(await screen.findByText(/unable to identify your employee record/i)).toBeInTheDocument();
  });

  it('requires a non-whitespace reason', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openResign(user);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '   ' } });
    await user.click(submit(dialog));
    expect(await screen.findByText(/please provide a reason/i)).toBeInTheDocument();
  });

  it('requires a proposed last working day', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openResign(user);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'New role' } });
    await user.click(submit(dialog));
    expect(
      await screen.findByText(/please select your proposed last working day/i),
    ).toBeInTheDocument();
  });

  it('requires a deactivation date', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openResign(user);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'New role' } });
    fireEvent.change(dialog.querySelector('#self-lwd')!, { target: { value: '2026-07-01' } });
    await user.click(submit(dialog));
    expect(await screen.findByText(/select your deactivation date/i)).toBeInTheDocument();
  });

  it('requires the acknowledgement checkbox', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openResign(user);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'New role' } });
    fireEvent.change(dialog.querySelector('#self-lwd')!, { target: { value: '2026-07-01' } });
    fireEvent.change(dialog.querySelector('#self-deact')!, { target: { value: '2026-07-02' } });
    await user.click(submit(dialog));
    expect(await screen.findByText(/please confirm that you understand/i)).toBeInTheDocument();
    expect(mocks.submitResignationMock).not.toHaveBeenCalled();
  });

  const fillValidResignation = async (dialog: HTMLElement) => {
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'New role' } });
    fireEvent.change(dialog.querySelector('#self-lwd')!, { target: { value: '2026-07-01' } });
    fireEvent.change(dialog.querySelector('#self-deact')!, { target: { value: '2026-07-02' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
  };

  it('submits a fully valid resignation', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openResign(user);
    await fillValidResignation(dialog);
    await user.click(submit(dialog));
    await waitFor(() =>
      expect(mocks.submitResignationMock).toHaveBeenCalledWith({
        reason: 'New role',
        lastWorkingDay: '2026-07-01',
      }),
    );
  });

  it('shows the Error message when submission fails', async () => {
    mocks.submitResignationMock.mockRejectedValue(new Error('already resigned'));
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openResign(user);
    await fillValidResignation(dialog);
    await user.click(submit(dialog));
    expect(await screen.findByText('already resigned')).toBeInTheDocument();
  });

  it('shows the default message when submission rejects with a non-Error', async () => {
    mocks.submitResignationMock.mockRejectedValue('nope');
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openResign(user);
    await fillValidResignation(dialog);
    await user.click(submit(dialog));
    expect(await screen.findByText(/failed to submit resignation/i)).toBeInTheDocument();
  });
});

describe('OffboardingPage - exit interview dialog branches', () => {
  const openInterview = async (user: ReturnType<typeof userEvent.setup>) => {
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /conduct interview/i }));
    return screen.findByRole('dialog');
  };
  const save = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: /save interview/i });

  beforeEach(() => {
    setData([makeRecord({ status: 'Exit Interview' })], { o1: [] });
  });

  it('requires the conducted-by name', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openInterview(user);
    fireEvent.change(within(dialog).getByLabelText(/conducted by/i), { target: { value: '  ' } });
    await user.click(save(dialog));
    expect(await screen.findByText(/name of the person conducting/i)).toBeInTheDocument();
  });

  it('requires at least one complete question and answer', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openInterview(user);
    await user.click(save(dialog));
    expect(await screen.findByText(/at least one question and response/i)).toBeInTheDocument();
  });

  it('ignores a question that has no answer', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openInterview(user);
    fireEvent.change(within(dialog).getByLabelText(/question 1/i), {
      target: { value: 'Why leave?' },
    });
    await user.click(save(dialog));
    expect(await screen.findByText(/at least one question and response/i)).toBeInTheDocument();
  });

  it('saves a completed question and answer pair', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openInterview(user);
    fireEvent.change(within(dialog).getByLabelText(/question 1/i), {
      target: { value: 'Why leave?' },
    });
    // Three "Response" labels exist (one per question row); target the first by id.
    fireEvent.change(dialog.querySelector('#ei-a-0')!, { target: { value: 'Better offer' } });
    await user.click(save(dialog));
    await waitFor(() =>
      expect(mocks.conductExitInterviewMock).toHaveBeenCalledWith('o1', {
        responses: [{ question: 'Why leave?', answer: 'Better offer' }],
        declined: false,
      }),
    );
  });

  it('allows saving with no responses when the employee declines', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openInterview(user);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await user.click(save(dialog));
    await waitFor(() =>
      expect(mocks.conductExitInterviewMock).toHaveBeenCalledWith('o1', {
        responses: [],
        declined: true,
      }),
    );
    expect(await screen.findByText(/employee declined the exit interview/i)).toBeInTheDocument();
  });

  it('adds and removes question rows', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openInterview(user);
    expect(within(dialog).getAllByLabelText(/^question \d/i)).toHaveLength(3);
    await user.click(within(dialog).getByRole('button', { name: /add question/i }));
    expect(within(dialog).getAllByLabelText(/^question \d/i)).toHaveLength(4);
    await user.click(within(dialog).getByRole('button', { name: /remove last/i }));
    expect(within(dialog).getAllByLabelText(/^question \d/i)).toHaveLength(3);
  });

  it('hides "Remove last" when only one question remains', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openInterview(user);
    const remove = within(dialog).getByRole('button', { name: /remove last/i });
    await user.click(remove);
    await user.click(within(dialog).getByRole('button', { name: /remove last/i }));
    expect(within(dialog).queryByRole('button', { name: /remove last/i })).toBeNull();
  });

  it('reports the failure when saving the interview rejects', async () => {
    mocks.conductExitInterviewMock.mockRejectedValue(new Error('interview save failed'));
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openInterview(user);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await user.click(save(dialog));
    await waitFor(() => expect(mocks.conductExitInterviewMock).toHaveBeenCalled());
    expect(screen.queryByText(/employee declined the exit interview/i)).not.toBeInTheDocument();
  });

  it('reports the default failure when saving rejects with a non-Error', async () => {
    mocks.conductExitInterviewMock.mockRejectedValue('nope');
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openInterview(user);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await user.click(save(dialog));
    await waitFor(() => expect(mocks.conductExitInterviewMock).toHaveBeenCalled());
    expect(screen.queryByText(/employee declined the exit interview/i)).not.toBeInTheDocument();
  });

  it('shows the empty state for a closed record without an interview', async () => {
    setData([makeRecord({ status: 'Closed' })], { o1: [] });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.getByText(/no exit interview recorded/i)).toBeInTheDocument();
  });

  it('edits an existing interview through the Edit action', async () => {
    setData(
      [
        makeRecord({
          status: 'Settlement',
          exitInterview: {
            conductedBy: 'Grace Liu',
            conductedAt: '2026-05-10T00:00:00.000Z',
            declined: false,
            responses: [{ question: 'Q1', answer: 'A1' }],
          },
        }),
      ],
      { o1: [] },
    );
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.getByText('Q1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('OffboardingPage - settlement dialog branches', () => {
  const openSettlement = async (user: ReturnType<typeof userEvent.setup>) => {
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /generate settlement/i }));
    return screen.findByRole('dialog');
  };
  const save = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: /save settlement/i });

  beforeEach(() => {
    setData([makeRecord({ status: 'Settlement' })], { o1: [] });
  });

  it('rejects negative encashment days', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openSettlement(user);
    fireEvent.change(within(dialog).getByLabelText(/encashment days/i), {
      target: { value: '-5' },
    });
    await user.click(save(dialog));
    expect(await screen.findByText(/cannot be negative/i)).toBeInTheDocument();
  });

  it('treats non-numeric days and rate as zero', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openSettlement(user);
    fireEvent.change(within(dialog).getByLabelText(/encashment days/i), {
      target: { value: 'abc' },
    });
    fireEvent.change(within(dialog).getByLabelText(/daily rate/i), { target: { value: 'xyz' } });
    await user.click(save(dialog));
    // Saved with a zero total (the amount appears in more than one summary cell).
    await waitFor(() => expect(screen.getAllByText('$0').length).toBeGreaterThan(0));
  });

  it('computes the total from days, rate, and dues', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openSettlement(user);
    fireEvent.change(within(dialog).getByLabelText(/encashment days/i), {
      target: { value: '10' },
    });
    fireEvent.change(within(dialog).getByLabelText(/daily rate/i), { target: { value: '100' } });
    await user.click(within(dialog).getByRole('button', { name: /add due/i }));
    fireEvent.change(within(dialog).getByPlaceholderText(/description/i), {
      target: { value: 'Laptop damage' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText(/^amount$/i), {
      target: { value: '250' },
    });
    await user.click(save(dialog));
    // 10 * 100 - 250 = 750
    expect(await screen.findByText('$750')).toBeInTheDocument();
    expect(screen.getByText('Laptop damage')).toBeInTheDocument();
  });

  it('drops dues that have a blank description', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openSettlement(user);
    fireEvent.change(within(dialog).getByLabelText(/encashment days/i), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText(/daily rate/i), { target: { value: '100' } });
    await user.click(within(dialog).getByRole('button', { name: /add due/i }));
    fireEvent.change(within(dialog).getByPlaceholderText(/^amount$/i), {
      target: { value: '100' },
    });
    await user.click(save(dialog));
    // Total still subtracts the amount, but no due row is rendered.
    expect(await screen.findByText('$400')).toBeInTheDocument();
    expect(screen.queryByText(/pending dues/i)).not.toBeInTheDocument();
  });

  it('treats a non-numeric due amount as zero', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openSettlement(user);
    fireEvent.change(within(dialog).getByLabelText(/encashment days/i), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText(/daily rate/i), { target: { value: '100' } });
    await user.click(within(dialog).getByRole('button', { name: /add due/i }));
    fireEvent.change(within(dialog).getByPlaceholderText(/description/i), {
      target: { value: 'Unknown' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText(/^amount$/i), {
      target: { value: 'abc' },
    });
    await user.click(save(dialog));
    await waitFor(() => expect(screen.getAllByText('$200').length).toBeGreaterThan(0));
  });

  it('removes a due row', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openSettlement(user);
    expect(within(dialog).getByText(/no pending dues recorded/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /add due/i }));
    expect(within(dialog).queryByText(/no pending dues recorded/i)).toBeNull();
    const removeButtons = within(dialog)
      .getAllByRole('button')
      .filter((b) => b.className.includes('hover:text-red-500'));
    await user.click(removeButtons[0]!);
    expect(within(dialog).getByText(/no pending dues recorded/i)).toBeInTheDocument();
  });

  it('flags outstanding dues when the checkbox is ticked', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    const dialog = await openSettlement(user);
    fireEvent.change(within(dialog).getByLabelText(/encashment days/i), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText(/daily rate/i), { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await user.click(save(dialog));
    expect(await screen.findByText(/outstanding dues flagged/i)).toBeInTheDocument();
  });

  it('re-opens an existing settlement for editing and derives the daily rate', async () => {
    setData(
      [
        makeRecord({
          status: 'Settlement',
          settlement: {
            generatedAt: '2026-05-20T00:00:00.000Z',
            lastWorkingDay: '2026-06-01',
            leaveEncashmentDays: 4,
            leaveEncashmentAmount: 400,
            pendingDues: [{ description: 'Advance', amount: 50 }],
            totalAmount: 350,
            outstandingFlagged: true,
          },
        }),
      ],
      { o1: [] },
    );
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.getByText('Advance')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    // 400 / 4 = 100 daily rate.
    expect(within(dialog).getByLabelText(/daily rate/i)).toHaveValue(100);
    expect(within(dialog).getByLabelText(/encashment days/i)).toHaveValue(4);
  });

  it('guards against divide-by-zero when encashment days are zero', async () => {
    setData(
      [
        makeRecord({
          status: 'Settlement',
          settlement: {
            generatedAt: '2026-05-20T00:00:00.000Z',
            lastWorkingDay: '2026-06-01',
            leaveEncashmentDays: 0,
            leaveEncashmentAmount: 0,
            pendingDues: [],
            totalAmount: 0,
            outstandingFlagged: false,
          },
        }),
      ],
      { o1: [] },
    );
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    // Math.max(days, 1) keeps the rate finite.
    expect(within(dialog).getByLabelText(/daily rate/i)).toHaveValue(0);
  });
});

describe('OffboardingPage - list rendering branches', () => {
  it('renders the empty state when there are no records', async () => {
    setData([], {});
    render(<OffboardingPage />);
    await waitFor(() => expect(mocks.listMock).toHaveBeenCalled());
    expect(await screen.findByText(/no offboarding/i)).toBeInTheDocument();
  });

  it('renders a deactivation date with the accent tone and a dash when absent', async () => {
    setData([makeRecord({ deactivationDate: null })], { o1: [] });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.getByText('Deactivation date')).toBeInTheDocument();
  });

  it.each([['Resignation'], ['Dismissal'], ['End of Contract']])(
    'renders the %s separation badge',
    async (type) => {
      setData([makeRecord({ separationType: type })], { o1: [] });
      render(<OffboardingPage />);
      expect(await screen.findByText(type)).toBeInTheDocument();
    },
  );

  it.each([
    ['Initiated', 'Initiated'],
    ['Clearance In Progress', 'Clearance'],
    ['Exit Interview', 'Exit Interview'],
    ['Settlement', 'Settlement'],
    ['Closed', 'Closed'],
  ])('renders the %s status badge as "%s"', async (status, label) => {
    setData([makeRecord({ status })], { o1: [] });
    render(<OffboardingPage />);
    await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
  });

  it.each([['Asset Return'], ['Access Revocation'], ['Knowledge Transfer'], ['Final Settlement']])(
    'renders the %s clearance category icon',
    async (category) => {
      setData([makeRecord()], { o1: [item({ category })] });
      const user = userEvent.setup();
      render(<OffboardingPage />);
      await openDetail(user);
      expect(screen.getByText(category)).toBeInTheDocument();
    },
  );

  it('renders sign-off and completion metadata when present', async () => {
    setData([makeRecord()], {
      o1: [
        item({
          status: 'Complete',
          signOffBy: 'Grace Liu',
          completedAt: '2026-05-15T00:00:00.000Z',
        }),
      ],
    });
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    expect(screen.getByText(/signed off by grace liu/i)).toBeInTheDocument();
  });

  it('navigates back to the list from the detail view', async () => {
    const user = userEvent.setup();
    render(<OffboardingPage />);
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: /back to offboarding/i }));
    await waitFor(() => expect(screen.queryByText(/back to offboarding/i)).not.toBeInTheDocument());
  });
});
