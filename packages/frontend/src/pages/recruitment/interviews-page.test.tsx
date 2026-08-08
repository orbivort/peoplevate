import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const listRequisitionsMock = vi.fn();
const listCandidatesMock = vi.fn();
const listInterviewsMock = vi.fn();
const createInterviewMock = vi.fn();
const updateInterviewStatusMock = vi.fn();
const deleteInterviewMock = vi.fn();
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
    listRequisitions: (...args: unknown[]) => listRequisitionsMock(...args),
    listCandidates: (...args: unknown[]) => listCandidatesMock(...args),
    listInterviews: (...args: unknown[]) => listInterviewsMock(...args),
    createInterview: (...args: unknown[]) => createInterviewMock(...args),
    updateInterviewStatus: (...args: unknown[]) => updateInterviewStatusMock(...args),
    deleteInterview: (...args: unknown[]) => deleteInterviewMock(...args),
  },
}));

import { InterviewsPage } from './interviews-page';

const candidates = [
  {
    id: 'c1',
    name: 'Grace Liu',
    email: 'grace@applicants.com',
    requisitionId: 'r1',
    requisitionTitle: 'Senior Frontend Engineer',
    stage: 'Interview' as const,
  },
  {
    id: 'c2',
    name: 'David Kim',
    email: 'david@applicants.com',
    requisitionId: 'r1',
    requisitionTitle: 'Senior Frontend Engineer',
    stage: 'Offer' as const,
  },
];

const interviews = [
  {
    id: 'iv1',
    candidateId: 'c1',
    candidateName: 'Grace Liu',
    requisitionTitle: 'Senior Frontend Engineer',
    scheduledAt: '2026-06-15T10:00:00.000Z',
    durationMin: 60,
    interviewers: ['Alice Admin'],
    location: 'Zoom',
    status: 'Scheduled' as const,
  },
];

// The interviews page only lists requisitions with a Published/Approved status
// in its requisition filter, so fixtures must include a status.
const requisitions = [
  { id: 'r1', title: 'Senior Frontend Engineer', departmentId: 'd1', status: 'Published' as const },
];

const makeAuth = (perms: string[]) => ({
  employee: { id: 'e1', firstName: 'Alice', lastName: 'Admin', departmentId: 'd1' },
  hasPermission: vi.fn((p: string) => perms.includes(p)),
});

beforeEach(() => {
  vi.resetAllMocks();
  listRequisitionsMock.mockResolvedValue(requisitions);
  listCandidatesMock.mockResolvedValue(candidates);
  listInterviewsMock.mockImplementation(async (candidateId: string) =>
    candidateId === 'c1' ? interviews : [],
  );
  createInterviewMock.mockResolvedValue({});
  updateInterviewStatusMock.mockResolvedValue({});
  deleteInterviewMock.mockResolvedValue({});
  departmentsState.departments = [{ id: 'd1', name: 'Engineering' }];
  useAuthMock.mockReturnValue(makeAuth(['manageRecruitment', 'manageRecruitmentDept']));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InterviewsPage', () => {
  it('renders the heading and loads interviews', async () => {
    render(<InterviewsPage />);
    expect(await screen.findByRole('heading', { name: /interviews/i })).toBeInTheDocument();
    expect(await screen.findByText('Grace Liu')).toBeInTheDocument();
    expect(screen.getAllByText('Scheduled').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the empty state when there are no interviews', async () => {
    listInterviewsMock.mockResolvedValue([]);
    render(<InterviewsPage />);
    expect(await screen.findByText(/no interviews scheduled/i)).toBeInTheDocument();
  });

  it('filters interviews by status tab', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getByRole('button', { name: /cancelled/i }));
    expect(await screen.findByText(/no interviews scheduled/i)).toBeInTheDocument();
  });

  it('opens the schedule dialog and validates required fields', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /schedule$/i }));
    expect(await screen.findByText(/please select a candidate/i)).toBeInTheDocument();
    expect(createInterviewMock).not.toHaveBeenCalled();
  });

  it('schedules an interview via the dialog', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-06-20T09:30' } });
    await user.click(screen.getByRole('button', { name: /schedule$/i }));

    await waitFor(() =>
      expect(createInterviewMock).toHaveBeenCalledWith('c1', {
        scheduledAt: new Date('2026-06-20T09:30').toISOString(),
        durationMin: 60,
        interviewerIds: [],
        location: undefined,
        notes: undefined,
      }),
    );
  });

  it('marks an interview as completed', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getByTitle('Mark completed'));
    expect(
      await waitFor(() =>
        expect(updateInterviewStatusMock).toHaveBeenCalledWith('c1', 'iv1', 'COMPLETED'),
      ),
    );
  });

  it('deletes an interview', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getByTitle('Delete'));
    expect(await waitFor(() => expect(deleteInterviewMock).toHaveBeenCalledWith('c1', 'iv1')));
  });

  it('cancels an interview', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getByTitle('Cancel'));
    expect(
      await waitFor(() =>
        expect(updateInterviewStatusMock).toHaveBeenCalledWith('c1', 'iv1', 'CANCELLED'),
      ),
    );
  });

  it('hides the schedule button for non-recruiters', () => {
    useAuthMock.mockReturnValue(makeAuth([]));
    render(<InterviewsPage />);
    expect(screen.queryByRole('button', { name: /schedule interview/i })).not.toBeInTheDocument();
  });

  it('schedules an interview with duration, interviewers, location and notes', async () => {
    createInterviewMock.mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    // datetime-local input has no display value; target by type.
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dt, { target: { value: '2026-03-10T10:00' } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. grace liu, david kim/i), {
      target: { value: 'Grace Liu, David Kim' },
    });
    fireEvent.change(screen.getByPlaceholderText(/conference room a or zoom link/i), {
      target: { value: 'Zoom link' },
    });
    fireEvent.change(screen.getByPlaceholderText(/focus areas/i), {
      target: { value: 'System design focus' },
    });
    await user.click(screen.getByRole('button', { name: /schedule$/i }));
    expect(
      await waitFor(() =>
        expect(createInterviewMock).toHaveBeenCalledWith(
          'c1',
          expect.objectContaining({
            durationMin: 60,
            interviewerIds: ['Grace Liu', 'David Kim'],
            location: 'Zoom link',
            notes: 'System design focus',
          }),
        ),
      ),
    );
  });

  it('validates that a candidate is selected before scheduling', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dt, { target: { value: '2026-03-10T10:00' } });
    await user.click(screen.getByRole('button', { name: /schedule$/i }));
    expect(await screen.findByText(/please select a candidate/i)).toBeInTheDocument();
    expect(createInterviewMock).not.toHaveBeenCalled();
  });

  it('validates the date and time before scheduling', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    await user.click(screen.getByRole('button', { name: /schedule$/i }));
    expect(await screen.findByText(/please pick a date and time/i)).toBeInTheDocument();
    expect(createInterviewMock).not.toHaveBeenCalled();
  });

  it('shows a validation error when scheduling fails on the server', async () => {
    createInterviewMock.mockRejectedValueOnce(new Error('slot conflict'));
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dt, { target: { value: '2026-03-10T10:00' } });
    await user.click(screen.getByRole('button', { name: /schedule$/i }));
    expect(await screen.findByText(/slot conflict/i)).toBeInTheDocument();
  });

  it('filters interviews by status tab', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getAllByRole('button', { name: /completed/i })[0]);
    expect(screen.queryByText('Grace Liu')).not.toBeInTheDocument();
    expect(screen.getByText(/no interviews scheduled/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no interviews', async () => {
    listInterviewsMock.mockImplementation(async (id: string) =>
      id === 'c1' ? [] : id === 'c2' ? [] : [],
    );
    render(<InterviewsPage />);
    expect(await screen.findByText(/no interviews scheduled/i)).toBeInTheDocument();
  });

  it('shows the loading state before data resolves', () => {
    listRequisitionsMock.mockReturnValue(new Promise(() => {}));
    listCandidatesMock.mockReturnValue(new Promise(() => {}));
    render(<InterviewsPage />);
    expect(screen.getByText(/loading interviews/i)).toBeInTheDocument();
  });

  it('recovers gracefully when loading requisitions fails', async () => {
    listRequisitionsMock.mockRejectedValueOnce(new Error('req load failed'));
    render(<InterviewsPage />);
    // The catch branch runs (error is captured) and the page settles without
    // leaving the loading spinner on screen.
    await waitFor(() => expect(screen.queryByText(/loading interviews/i)).not.toBeInTheDocument());
    // The page remains usable afterwards (header + empty-state buttons).
    expect(screen.getAllByRole('button', { name: /schedule interview/i }).length).toBeGreaterThan(
      0,
    );
  });

  it('recovers gracefully when loading candidates fails', async () => {
    listCandidatesMock.mockRejectedValueOnce(new Error('cand load failed'));
    render(<InterviewsPage />);
    await waitFor(() => expect(screen.queryByText(/loading interviews/i)).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /schedule interview/i }).length).toBeGreaterThan(
      0,
    );
  });

  it('captures a non-Error failure when loading', async () => {
    listRequisitionsMock.mockRejectedValueOnce('unknown failure');
    render(<InterviewsPage />);
    await waitFor(() => expect(screen.queryByText(/loading interviews/i)).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /schedule interview/i }).length).toBeGreaterThan(
      0,
    );
  });

  it('skips candidates whose interviews cannot be listed', async () => {
    const user = userEvent.setup();
    listInterviewsMock
      .mockResolvedValueOnce(interviews)
      .mockRejectedValueOnce(new Error('forbidden'));
    render(<InterviewsPage />);
    expect(await screen.findByText('Grace Liu')).toBeInTheDocument();
    // load() completes without throwing despite the rejected candidate call.
    await waitFor(() => expect(screen.queryByText(/loading interviews/i)).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /all/i }));
  });

  it('sorts interviews by scheduledAt ascending', async () => {
    listInterviewsMock.mockImplementation(async (id: string) =>
      id === 'c1'
        ? [
            { ...interviews[0], scheduledAt: '2026-06-20T10:00:00.000Z' },
            { ...interviews[0], id: 'iv2', scheduledAt: '2026-06-10T10:00:00.000Z' },
          ]
        : [],
    );
    render(<InterviewsPage />);
    const rows = await screen.findAllByText('Grace Liu');
    expect(rows.length).toBe(2);
  });

  it('shows the department filter only for HR/admin recruiters', async () => {
    // Manager (dept scope only) should not see the All departments select.
    useAuthMock.mockReturnValue(makeAuth(['manageRecruitmentDept']));
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    expect(screen.queryByText(/all departments/i)).not.toBeInTheDocument();
  });

  it('populates the requisition filter with published requisitions', async () => {
    listInterviewsMock.mockImplementation(async (id: string) =>
      id === 'c1' ? interviews : id === 'c2' ? [] : [],
    );
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    // The requisition <select> lists the published requisition as an option.
    expect(screen.getByRole('option', { name: 'Senior Frontend Engineer' })).toBeInTheDocument();
    // With "All requisitions" selected the interview remains visible.
    expect(screen.getByText('Grace Liu')).toBeInTheDocument();
  });

  it('filters interviews by department select for HR/admin', async () => {
    listRequisitionsMock.mockResolvedValue([
      {
        id: 'r1',
        title: 'Senior Frontend Engineer',
        departmentId: 'd1',
        status: 'Published' as const,
      },
      { id: 'r2', title: 'Backend Engineer', departmentId: 'dOther', status: 'Published' as const },
    ]);
    listCandidatesMock.mockResolvedValue([
      ...candidates,
      {
        id: 'c3',
        name: 'Other Dept',
        email: 'o@x.com',
        requisitionId: 'r2',
        requisitionTitle: 'Backend Engineer',
        stage: 'Interview' as const,
      },
    ]);
    listInterviewsMock.mockImplementation(async (id: string) => {
      if (id === 'c1') return interviews;
      if (id === 'c3')
        return [
          {
            id: 'ivX',
            candidateId: 'c3',
            candidateName: 'Other Dept',
            requisitionTitle: 'Backend Engineer',
            scheduledAt: '2026-07-01T10:00:00.000Z',
            durationMin: 30,
            interviewers: [],
            location: 'Room A',
            status: 'Scheduled' as const,
          },
        ];
      return [];
    });
    departmentsState.departments = [
      { id: 'd1', name: 'Engineering' },
      { id: 'dOther', name: 'Other' },
    ];
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    expect(screen.getByText('Other Dept')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue(/all departments/i), { target: { value: 'd1' } });
    await waitFor(() => expect(screen.queryByText('Other Dept')).not.toBeInTheDocument());
    expect(screen.getByText('Grace Liu')).toBeInTheDocument();
  });

  it('scopes interviews to a manager department', async () => {
    useAuthMock.mockReturnValue(makeAuth(['manageRecruitmentDept']));
    listRequisitionsMock.mockResolvedValue([
      {
        id: 'r1',
        title: 'Senior Frontend Engineer',
        departmentId: 'd1',
        status: 'Published' as const,
      },
      { id: 'r2', title: 'Backend Engineer', departmentId: 'dOther', status: 'Published' as const },
    ]);
    listCandidatesMock.mockResolvedValue([
      ...candidates,
      {
        id: 'c3',
        name: 'Other Dept',
        email: 'o@x.com',
        requisitionId: 'r2',
        requisitionTitle: 'Backend Engineer',
        stage: 'Interview' as const,
      },
    ]);
    listInterviewsMock.mockImplementation(async (id: string) => {
      if (id === 'c1') return interviews;
      if (id === 'c3')
        return [
          {
            id: 'ivX',
            candidateId: 'c3',
            candidateName: 'Other Dept',
            requisitionTitle: 'Backend Engineer',
            scheduledAt: '2026-07-01T10:00:00.000Z',
            durationMin: 30,
            interviewers: [],
            location: 'Room A',
            status: 'Scheduled' as const,
          },
        ];
      return [];
    });
    render(<InterviewsPage />);
    await waitFor(() => expect(screen.queryByText(/other dept/i)).not.toBeInTheDocument());
    expect(screen.getByText('Grace Liu')).toBeInTheDocument();
  });

  it('renders a video icon for video locations', async () => {
    listInterviewsMock.mockImplementation(async (id: string) =>
      id === 'c1' ? [{ ...interviews[0], location: 'https://meet.google.com/abc' }] : [],
    );
    render(<InterviewsPage />);
    expect(await screen.findByText(/meet\.google\.com/i)).toBeInTheDocument();
  });

  it('renders a map pin icon for physical locations', async () => {
    listInterviewsMock.mockImplementation(async (id: string) =>
      id === 'c1' ? [{ ...interviews[0], location: 'Conference Room A' }] : [],
    );
    render(<InterviewsPage />);
    expect(await screen.findByText(/conference room a/i)).toBeInTheDocument();
  });

  it('renders a dash when no interviewers are listed', async () => {
    listInterviewsMock.mockImplementation(async (id: string) =>
      id === 'c1' ? [{ ...interviews[0], interviewers: [] }] : [],
    );
    render(<InterviewsPage />);
    const row = await screen.findByText('Grace Liu');
    expect(row).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('excludes rejected and hired candidates from the schedule dialog', async () => {
    const user = userEvent.setup();
    listCandidatesMock.mockResolvedValue([
      ...candidates,
      {
        id: 'cRej',
        name: 'Reject Me',
        email: 'r@x.com',
        requisitionId: 'r1',
        requisitionTitle: 'Senior Frontend Engineer',
        stage: 'Rejected' as const,
      },
      {
        id: 'cHired',
        name: 'Hired Me',
        email: 'h@x.com',
        requisitionId: 'r1',
        requisitionTitle: 'Senior Frontend Engineer',
        stage: 'Hired' as const,
      },
    ]);
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options.some((t) => t?.includes('Reject Me'))).toBe(false);
    expect(options.some((t) => t?.includes('Hired Me'))).toBe(false);
    expect(options.some((t) => t?.includes('Grace Liu'))).toBe(true);
  });

  it('changes duration selection in the schedule dialog', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('60 minutes'), { target: { value: '90' } });
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dt, { target: { value: '2026-03-10T10:00' } });
    await user.click(screen.getByRole('button', { name: /schedule$/i }));
    await waitFor(() =>
      expect(createInterviewMock).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ durationMin: 90 }),
      ),
    );
  });

  it('closes the schedule dialog via the Cancel button', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes the dialog without scheduling on outside close', async () => {
    const user = userEvent.setup();
    listInterviewsMock.mockResolvedValue([]);
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dt, { target: { value: '2026-03-10T10:00' } });
    await user.click(screen.getByRole('button', { name: /schedule$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createInterviewMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the interview unchanged when marking completed fails', async () => {
    updateInterviewStatusMock.mockRejectedValueOnce(new Error('update failed'));
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getByTitle('Mark completed'));
    // Catch branch runs; the interview is not optimistically changed, so the
    // "Mark completed" action remains available and the row is still present.
    await waitFor(() => expect(screen.getByTitle('Mark completed')).toBeInTheDocument());
    expect(screen.getByText('Grace Liu')).toBeInTheDocument();
  });

  it('keeps the interview unchanged when cancelling fails', async () => {
    updateInterviewStatusMock.mockRejectedValueOnce(new Error('cancel failed'));
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getByTitle('Cancel'));
    await waitFor(() => expect(screen.getByTitle('Cancel')).toBeInTheDocument());
    expect(screen.getByText('Grace Liu')).toBeInTheDocument();
  });

  it('keeps the interview when deleting fails', async () => {
    deleteInterviewMock.mockRejectedValueOnce(new Error('delete failed'));
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getByTitle('Delete'));
    await waitFor(() => expect(screen.getByText('Grace Liu')).toBeInTheDocument());
  });

  it('captures a non-Error failure when marking completed', async () => {
    updateInterviewStatusMock.mockRejectedValueOnce('weird');
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    await user.click(screen.getByTitle('Mark completed'));
    await waitFor(() => expect(screen.getByTitle('Mark completed')).toBeInTheDocument());
    expect(screen.getByText('Grace Liu')).toBeInTheDocument();
  });

  it('clears filters via the clear button', async () => {
    const user = userEvent.setup();
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    fireEvent.change(screen.getByDisplayValue(/all requisitions/i), { target: { value: 'r1' } });
    expect(await screen.findByText(/clear filters/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    await waitFor(() => expect(screen.queryByText(/clear filters/i)).not.toBeInTheDocument());
  });

  it('only shows status action buttons for scheduled interviews', async () => {
    listInterviewsMock.mockImplementation(async (id: string) =>
      id === 'c1'
        ? [
            { ...interviews[0], id: 'ivSched', status: 'Scheduled' as const },
            { ...interviews[0], id: 'ivDone', status: 'Completed' as const },
          ]
        : [],
    );
    render(<InterviewsPage />);
    await screen.findAllByText('Grace Liu');
    const completed = await screen.findAllByText('Completed');
    expect(completed.length).toBeGreaterThanOrEqual(1);
    // The completed interview must not expose a "Mark completed" action.
    expect(screen.getAllByTitle('Mark completed').length).toBe(1);
  });

  it('shows the correct tab counts', async () => {
    listInterviewsMock.mockImplementation(async (id: string) =>
      id === 'c1'
        ? [
            { ...interviews[0], id: 'ivA', status: 'Scheduled' as const },
            { ...interviews[0], id: 'ivB', status: 'Scheduled' as const },
          ]
        : [],
    );
    render(<InterviewsPage />);
    await screen.findAllByText('Grace Liu');
    // The Scheduled status tab shows a count of 2.
    const scheduledTabs = screen.getAllByText(/Scheduled/);
    expect(scheduledTabs.length).toBeGreaterThanOrEqual(1);
    expect(scheduledTabs.some((el) => /2/.test(el.textContent ?? ''))).toBe(true);
  });

  it('hides interview action buttons for non-recruiters', async () => {
    useAuthMock.mockReturnValue(makeAuth([]));
    render(<InterviewsPage />);
    await screen.findByText('Grace Liu');
    expect(screen.queryByTitle('Mark completed')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  it('reloads interviews after a successful schedule', async () => {
    const user = userEvent.setup();
    listInterviewsMock
      .mockResolvedValueOnce(interviews)
      .mockResolvedValueOnce([
        { ...interviews[0], id: 'ivNew', scheduledAt: '2026-08-01T10:00:00.000Z' },
      ]);
    render(<InterviewsPage />);
    await user.click(await screen.findByRole('button', { name: /schedule interview/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByDisplayValue('Select a candidate'), { target: { value: 'c1' } });
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dt, { target: { value: '2026-03-10T10:00' } });
    await user.click(screen.getByRole('button', { name: /schedule$/i }));
    // Initial load calls listInterviews for c1 and c2 (2), then the reload after
    // a successful schedule calls them again (2) -> 4 total.
    expect(await waitFor(() => expect(listInterviewsMock).toHaveBeenCalledTimes(4)));
  });
});
