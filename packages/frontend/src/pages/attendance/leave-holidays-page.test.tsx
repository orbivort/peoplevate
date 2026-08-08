import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const listLeaveTypesMock = vi.fn();
const listPolicyGroupsMock = vi.fn();
const createPolicyGroupMock = vi.fn();
const updatePolicyGroupMock = vi.fn();
const deletePolicyGroupMock = vi.fn();
const listHolidaysMock = vi.fn();
const upsertHolidayMock = vi.fn();
const deleteHolidayMock = vi.fn();

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/lib/api/workflow-repositories', () => ({
  attendanceRepo: {
    listLeaveTypes: (...args: unknown[]) => listLeaveTypesMock(...args),
    listPolicyGroups: (...args: unknown[]) => listPolicyGroupsMock(...args),
    createPolicyGroup: (...args: unknown[]) => createPolicyGroupMock(...args),
    updatePolicyGroup: (...args: unknown[]) => updatePolicyGroupMock(...args),
    deletePolicyGroup: (...args: unknown[]) => deletePolicyGroupMock(...args),
    listHolidays: (...args: unknown[]) => listHolidaysMock(...args),
    upsertHoliday: (...args: unknown[]) => upsertHolidayMock(...args),
    deleteHoliday: (...args: unknown[]) => deleteHolidayMock(...args),
  },
}));

import { LeaveHolidaysPage } from './leave-holidays-page';

// Radix Select measures option layout with ResizeObserver, which jsdom does not
// implement. Provide a no-op polyfill so the select portal can open in tests.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error - assigning a test double onto the global
globalThis.ResizeObserver = ResizeObserverMock;

const leaveTypes = [
  { id: 'lt1', name: 'Annual' },
  { id: 'lt2', name: 'Personal' },
];

const policyGroups = [
  {
    id: 'pg1',
    name: 'Full-Time Standard',
    description: 'Default',
    employment_type: 'FULL_TIME',
    grades: [],
    department_id: null,
    proration_enabled: true,
    year: 2026,
    entitlements: [{ leave_type_id: 'lt1', annual_days: 20 }],
  },
];

const holidays = [
  {
    id: 'h1',
    name: "New Year's Day",
    date: '2026-01-01T00:00:00.000Z',
    type: 'STATUTORY' as const,
    recurring: true,
    year: 2026,
  },
];

const makeAuth = (canManage: boolean) => ({
  hasPermission: vi.fn((p: string) => (p === 'manageOrg' ? canManage : false)),
});

beforeEach(() => {
  listLeaveTypesMock.mockResolvedValue(leaveTypes);
  listPolicyGroupsMock.mockResolvedValue(policyGroups);
  createPolicyGroupMock.mockResolvedValue({});
  updatePolicyGroupMock.mockResolvedValue({});
  deletePolicyGroupMock.mockResolvedValue({});
  listHolidaysMock.mockResolvedValue(holidays);
  upsertHolidayMock.mockResolvedValue({});
  deleteHolidayMock.mockResolvedValue({});
  useAuthMock.mockReturnValue(makeAuth(true));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LeaveHolidaysPage', () => {
  it('renders the heading and shows the management controls for HR/Admin', () => {
    render(<LeaveHolidaysPage />);
    expect(screen.getByRole('heading', { name: /leave & holidays/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /leave policies/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /holiday calendar/i })).toBeInTheDocument();
  });

  it('renders the leave policy groups table with entitlements', async () => {
    render(<LeaveHolidaysPage />);
    expect(await screen.findByText('Full-Time Standard')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('opens the policy group dialog and validates the required name', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(await screen.findByRole('button', { name: /create policy group/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create & save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(createPolicyGroupMock).not.toHaveBeenCalled();
  });

  it('creates a policy group with a name and entitlement', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(await screen.findByRole('button', { name: /create policy group/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Contractors' } });
    fireEvent.change(screen.getByLabelText('Annual'), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: /create & save/i }));

    await waitFor(() => expect(createPolicyGroupMock).toHaveBeenCalled());
    const call = createPolicyGroupMock.mock.calls[0][0];
    expect(call.name).toBe('Contractors');
    expect(call.entitlements).toContainEqual({ leave_type_id: 'lt1', annual_days: 10 });
  });

  it('deletes a policy group after confirmation', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await screen.findByText('Full-Time Standard');
    await user.click(screen.getByRole('button', { name: /delete full-time standard/i }));
    expect(await screen.findByText(/this will permanently remove/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(await waitFor(() => expect(deletePolicyGroupMock).toHaveBeenCalledWith('pg1')));
  });

  it('renders the holiday calendar with holidays', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    expect(await screen.findByText(/new year's day/i)).toBeInTheDocument();
    expect(screen.getByText('Statutory')).toBeInTheDocument();
  });

  it('opens the holiday dialog and validates the required fields', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    await user.click(await screen.findByRole('button', { name: /add holiday/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save holiday/i }));
    expect((await screen.findAllByText(/holiday name is required/i)).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(upsertHolidayMock).not.toHaveBeenCalled();
  });

  it('creates a holiday via the dialog', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    await user.click(await screen.findByRole('button', { name: /add holiday/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Company Offsite' } });
    fireEvent.change(screen.getByLabelText('Date *'), { target: { value: '2026-07-15' } });
    await user.click(screen.getByRole('button', { name: /save holiday/i }));

    await waitFor(() => expect(upsertHolidayMock).toHaveBeenCalled());
    const call = upsertHolidayMock.mock.calls[0][0];
    expect(call.name).toBe('Company Offsite');
    expect(call.date).toBe('2026-07-15');
  });

  it('shows a "View only" badge and hides management controls for non-managers', () => {
    useAuthMock.mockReturnValue(makeAuth(false));
    render(<LeaveHolidaysPage />);
    expect(screen.getByText(/view only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create policy group/i })).not.toBeInTheDocument();
  });

  it('navigates the policy group year and reloads groups for the new year', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await screen.findByText('Full-Time Standard');
    expect(screen.getByText('2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /previous year/i }));
    expect(await screen.findByText('2025')).toBeInTheDocument();
    expect(listPolicyGroupsMock).toHaveBeenLastCalledWith(2025);
    await user.click(screen.getByRole('button', { name: /next year/i }));
    expect(await screen.findByText('2026')).toBeInTheDocument();
  });

  it('opens the edit dialog pre-filled for an existing policy group', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await screen.findByText('Full-Time Standard');
    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText('Name *')).toHaveValue('Full-Time Standard');
    expect(dialog).toHaveTextContent(/save changes/i);
  });

  it('cancels the policy group delete confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await screen.findByText('Full-Time Standard');
    await user.click(screen.getByRole('button', { name: /delete full-time standard/i }));
    expect(await screen.findByText(/permanently remove/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(deletePolicyGroupMock).not.toHaveBeenCalled();
  });

  it('shows an error when deleting a policy group fails', async () => {
    const user = userEvent.setup();
    deletePolicyGroupMock.mockRejectedValueOnce(new Error('Network error'));
    render(<LeaveHolidaysPage />);
    await screen.findByText('Full-Time Standard');
    await user.click(screen.getByRole('button', { name: /delete full-time standard/i }));
    await user.click(await screen.findByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
    expect(deletePolicyGroupMock).toHaveBeenCalledWith('pg1');
  });

  it('adds and removes position grades in the policy group dialog', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(await screen.findByRole('button', { name: /create policy group/i }));
    await screen.findByRole('dialog');
    const gradeInput = screen.getByPlaceholderText(/l4/i);
    await user.type(gradeInput, 'L4{Enter}');
    await user.type(gradeInput, 'L5');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByText('L4')).toBeInTheDocument();
    expect(screen.getByText('L5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove grade l4/i }));
    expect(screen.queryByText('L4')).not.toBeInTheDocument();
    expect(screen.getByText('L5')).toBeInTheDocument();
  });

  it('renders the employment type select and toggles proration in the policy group dialog', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(await screen.findByRole('button', { name: /create policy group/i }));
    await screen.findByRole('dialog');
    // The employment type control is a Radix Select (role="combobox").
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    const proration = screen.getByRole('checkbox', { name: /prorate for mid-year joiners/i });
    const initial = proration.checked;
    await user.click(proration);
    expect(proration.checked).toBe(!initial);
  });

  it('shows an error when creating a policy group fails', async () => {
    const user = userEvent.setup();
    createPolicyGroupMock.mockRejectedValueOnce(new Error('Save failed'));
    render(<LeaveHolidaysPage />);
    await user.click(await screen.findByRole('button', { name: /create policy group/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Bad Group' } });
    await user.click(screen.getByRole('button', { name: /create & save/i }));
    expect(await screen.findByText(/save failed/i)).toBeInTheDocument();
  });

  it('updates a policy group via the edit dialog (Save changes)', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await screen.findByText('Full-Time Standard');
    await user.click(screen.getByRole('button', { name: /edit/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Renamed Group' } });
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(updatePolicyGroupMock).toHaveBeenCalled());
    const call = updatePolicyGroupMock.mock.calls[0];
    expect(call[0]).toBe('pg1');
    expect(call[1].name).toBe('Renamed Group');
  });

  it('navigates holiday calendar months', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    const header = () =>
      screen.getByText(
        (_, el) => typeof el?.className === 'string' && el.className.includes('min-w-[130px]'),
      );
    const before = header().textContent;
    await user.click(screen.getByRole('button', { name: /next month/i }));
    await waitFor(() => expect(header().textContent).not.toBe(before));
    await user.click(screen.getByRole('button', { name: /previous month/i }));
    await waitFor(() => expect(header().textContent).toBe(before));
  });

  it('deletes a holiday and shows a confirmation toast', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    await screen.findByText(/new year's day/i);
    await user.click(screen.getByRole('button', { name: /delete new year's day/i }));
    await waitFor(() => expect(deleteHolidayMock).toHaveBeenCalledWith('h1'));
    expect(await screen.findByText(/removed/i)).toBeInTheDocument();
  });

  it('shows an error when deleting a holiday fails', async () => {
    const user = userEvent.setup();
    deleteHolidayMock.mockRejectedValueOnce(new Error('Boom'));
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    await screen.findByText(/new year's day/i);
    await user.click(screen.getByRole('button', { name: /delete new year's day/i }));
    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
  });

  it('updates an existing holiday via the dialog when clicking a date', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    await screen.findByText(/new year's day/i);
    // Navigate the calendar to January so New Year's Day shows in the grid.
    const header = () =>
      screen.getByText(
        (_, el) => typeof el?.className === 'string' && el.className.includes('min-w-[130px]'),
      );
    for (let i = 0; i < 12; i++) {
      if (/january/i.test(header().textContent ?? '')) break;
      await user.click(screen.getByRole('button', { name: /previous month/i }));
    }
    // Day "1" in January is New Year's Day; clicking it opens the edit dialog.
    // Match the calendar cell whose label includes the holiday name (avoids the
    // day-number-only cells such as "10"/"11").
    const dayOne = screen.getByRole('button', {
      name: (_, el) => (el?.textContent ?? '').includes("New Year's Day"),
    });
    await user.click(dayOne);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText('Name *')).toHaveValue("New Year's Day");
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'New Year (Observed)' } });
    await user.click(screen.getByRole('button', { name: /save holiday/i }));
    await waitFor(() => expect(upsertHolidayMock).toHaveBeenCalled());
    const call = upsertHolidayMock.mock.calls[0][0];
    expect(call.name).toBe('New Year (Observed)');
    expect(await screen.findByText(/saved holiday/i)).toBeInTheDocument();
  });

  it('sets a holiday name/date and toggles recurring in the holiday dialog', async () => {
    const user = userEvent.setup();
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    await user.click(await screen.findByRole('button', { name: /add holiday/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Team Building' } });
    fireEvent.change(screen.getByLabelText('Date *'), { target: { value: '2026-09-10' } });
    // The holiday type control is a Radix Select (role="combobox").
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    const recurring = screen.getByRole('checkbox', { name: /recur every year/i });
    expect(recurring).not.toBeChecked();
    await user.click(recurring);
    expect(recurring).toBeChecked();
    await user.click(screen.getByRole('button', { name: /save holiday/i }));
    await waitFor(() => expect(upsertHolidayMock).toHaveBeenCalled());
    const call = upsertHolidayMock.mock.calls[0][0];
    expect(call.name).toBe('Team Building');
    expect(call.recurring).toBe(true);
  });

  it('shows an error when saving a holiday fails', async () => {
    const user = userEvent.setup();
    upsertHolidayMock.mockRejectedValueOnce(new Error('Holiday save failed'));
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    await user.click(await screen.findByRole('button', { name: /add holiday/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Broken' } });
    fireEvent.change(screen.getByLabelText('Date *'), { target: { value: '2026-05-05' } });
    await user.click(screen.getByRole('button', { name: /save holiday/i }));
    expect((await screen.findAllByText(/holiday save failed/i)).length).toBeGreaterThan(0);
  });

  it('shows a loading state while holidays are being fetched', async () => {
    const user = userEvent.setup();
    listHolidaysMock.mockReturnValue(new Promise(() => {}));
    render(<LeaveHolidaysPage />);
    await user.click(screen.getByRole('tab', { name: /holiday calendar/i }));
    expect(await screen.findByText(/loading calendar/i)).toBeInTheDocument();
  });
});
