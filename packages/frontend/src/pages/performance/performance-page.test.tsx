import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const useAuthMock = vi.fn();

const cycles = vi.hoisted(() => [
  {
    id: 'cy1',
    type: 'Mid-Year Review',
    status: 'Open',
    currentPhase: 'Self-Evaluation',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-06-30T00:00:00.000Z',
    selfEvalStart: '2026-01-01T00:00:00.000Z',
    selfEvalEnd: '2026-02-01T00:00:00.000Z',
    managerEvalStart: '2026-02-02T00:00:00.000Z',
    managerEvalEnd: '2026-03-01T00:00:00.000Z',
    hrReviewStart: '2026-03-02T00:00:00.000Z',
    hrReviewEnd: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'cy2',
    type: 'End-Year Review',
    status: 'Draft',
    currentPhase: 'Not Started',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-12-31T00:00:00.000Z',
    selfEvalStart: '2026-07-01T00:00:00.000Z',
    selfEvalEnd: '2026-08-01T00:00:00.000Z',
    managerEvalStart: '2026-08-02T00:00:00.000Z',
    managerEvalEnd: '2026-09-01T00:00:00.000Z',
    hrReviewStart: '2026-09-02T00:00:00.000Z',
    hrReviewEnd: '2026-10-01T00:00:00.000Z',
  },
]);

const reviews = vi.hoisted(() => [
  {
    id: 'rv1',
    employeeId: 'e1',
    employeeName: 'Alice Admin',
    cycleId: 'cy1',
    cycleName: 'Mid-Year Review',
    managerName: 'Carol Reyes',
    status: 'Self-Evaluation',
    competencies: [
      {
        competency: 'Communication',
        selfRating: undefined as number | undefined,
        managerRating: undefined as number | undefined,
      },
    ],
    achievements: '',
    goals: '',
  },
  {
    id: 'rv2',
    employeeId: 'e2',
    employeeName: 'Bob Probie',
    cycleId: 'cy1',
    cycleName: 'Mid-Year Review',
    managerName: 'Alice Admin',
    status: 'HR Review',
    competencies: [{ competency: 'Communication', selfRating: 4, managerRating: 4 }],
    hrFinalized: false,
  },
]);

const listCyclesMock = vi.fn(async () => cycles);
const listReviewsMock = vi.fn(async () => reviews);
const createCycleMock = vi.fn(async () => ({}));
const openCycleMock = vi.fn(async () => ({}));
const closeCycleMock = vi.fn(async () => ({}));
const submitSelfMock = vi.fn(async () => ({}));
const submitManagerMock = vi.fn(async () => ({}));
const finalizeMock = vi.fn(async () => ({}));
const addRebuttalMock = vi.fn(async () => ({}));
const listProbationEligibleMock = vi.fn(async () => []);

const makeAuth = (
  perms: string[],
  employee: Record<string, unknown> = { id: 'hr1', firstName: 'Helen', lastName: 'Reyes' },
) => ({
  employee,
  hasPermission: vi.fn((p: string) => perms.includes(p)),
});

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/lib/api/workflow-repositories', () => ({
  performanceRepo: {
    listCycles: (...args: unknown[]) => listCyclesMock(...args),
    listReviews: (...args: unknown[]) => listReviewsMock(...args),
    createCycle: (...args: unknown[]) => createCycleMock(...args),
    openCycle: (...args: unknown[]) => openCycleMock(...args),
    closeCycle: (...args: unknown[]) => closeCycleMock(...args),
    submitSelf: (...args: unknown[]) => submitSelfMock(...args),
    submitManager: (...args: unknown[]) => submitManagerMock(...args),
    finalize: (...args: unknown[]) => finalizeMock(...args),
    addRebuttal: (...args: unknown[]) => addRebuttalMock(...args),
    listProbationEligible: (...args: unknown[]) => listProbationEligibleMock(...args),
  },
}));

import { PerformancePage } from './performance-page';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue(makeAuth(['managePerformance']));
  listCyclesMock.mockImplementation(async () => cycles);
  listReviewsMock.mockImplementation(async () => reviews);
  createCycleMock.mockResolvedValue({});
  openCycleMock.mockResolvedValue({});
  closeCycleMock.mockResolvedValue({});
  submitSelfMock.mockResolvedValue({});
  submitManagerMock.mockResolvedValue({});
  finalizeMock.mockResolvedValue({});
  addRebuttalMock.mockResolvedValue({});
});

describe('PerformancePage', () => {
  it('renders the heading and evaluation cycles', async () => {
    render(<PerformancePage />);
    expect(await screen.findByRole('heading', { name: /performance/i })).toBeInTheDocument();
    expect(await screen.findByText('Mid-Year Review')).toBeInTheDocument();
    expect(screen.getByText('End-Year Review')).toBeInTheDocument();
  });

  it('creates an evaluation cycle via the dialog', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('button', { name: /create cycle/i }));
    await screen.findByRole('dialog');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const values = [
      '2026-01-01', // period start
      '2026-06-30', // period end
      '2026-01-01', // self-eval start
      '2026-02-01', // self-eval end
      '2026-02-02', // manager-eval start
      '2026-03-01', // manager-eval end
      '2026-03-02', // hr-review start
      '2026-04-01', // hr-review end
    ];
    dateInputs.forEach((inp, i) => {
      fireEvent.change(inp, { target: { value: values[i] } });
    });
    await user.click(screen.getByRole('button', { name: /create cycle$/i }));
    expect(
      await waitFor(() =>
        expect(createCycleMock).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'MID_YEAR',
            periodStart: '2026-01-01T00:00:00.000Z',
          }),
        ),
      ),
    );
  });

  it('opens a draft cycle', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('button', { name: /^open$/i }));
    expect(await waitFor(() => expect(openCycleMock).toHaveBeenCalledWith('cy2')));
  });

  it('lists reviews on the Reviews tab', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob Probie')).toBeInTheDocument();
  });

  it('HR finalizes a review in HR Review status', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Bob Probie'));
    await user.click(await screen.findByRole('button', { name: /finalize review/i }));
    await user.click(screen.getByText('Outstanding'));
    fireEvent.change(screen.getByPlaceholderText('Final review comments…'), {
      target: { value: 'Strong delivery this cycle.' },
    });
    await user.click(screen.getByRole('button', { name: /confirm finalization/i }));
    expect(
      await waitFor(() =>
        expect(finalizeMock).toHaveBeenCalledWith('rv2', 5, 'Strong delivery this cycle.'),
      ),
    );
  });

  it('scopes reviews to a manager’s direct reports', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(
      makeAuth(['conductReviews'], { id: 'm1', firstName: 'Carol', lastName: 'Reyes' }),
    );
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    expect(screen.queryByText('Bob Probie')).not.toBeInTheDocument();
  });

  it('limits an employee to their own review', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(makeAuth([], { id: 'e1', firstName: 'Alice', lastName: 'Admin' }));
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    expect(screen.queryByText('Bob Probie')).not.toBeInTheDocument();
  });

  it('shows a validation error when cycle dates are invalid', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('button', { name: /create cycle/i }));
    await screen.findByRole('dialog');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const values = [
      '2026-06-30', // period start (after period end -> invalid)
      '2026-01-01', // period end
      '2026-01-01',
      '2026-02-01',
      '2026-02-02',
      '2026-03-01',
      '2026-03-02',
      '2026-04-01',
    ];
    dateInputs.forEach((inp, i) => {
      fireEvent.change(inp, { target: { value: values[i] } });
    });
    await user.click(screen.getByRole('button', { name: /create cycle$/i }));
    // Validation should block submission and surface an error message.
    expect(await screen.findByText(/period start must be before period end/i)).toBeInTheDocument();
    expect(createCycleMock).not.toHaveBeenCalled();
  });

  it('shows an error when required date fields are empty', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('button', { name: /create cycle/i }));
    await screen.findByRole('dialog');
    // Do not fill any date inputs, then attempt to submit.
    await user.click(screen.getByRole('button', { name: /create cycle$/i }));
    expect(await screen.findByText(/all date fields are required/i)).toBeInTheDocument();
    expect(createCycleMock).not.toHaveBeenCalled();
  });

  it('shows an error when self-evaluation starts before the period', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('button', { name: /create cycle/i }));
    await screen.findByRole('dialog');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const values = [
      '2026-03-01', // period start
      '2026-06-30', // period end
      '2026-01-01', // self-eval start (before period start -> invalid)
      '2026-02-01',
      '2026-02-02',
      '2026-03-01',
      '2026-03-02',
      '2026-04-01',
    ];
    dateInputs.forEach((inp, i) => {
      fireEvent.change(inp, { target: { value: values[i] } });
    });
    await user.click(screen.getByRole('button', { name: /create cycle$/i }));
    expect(
      await screen.findByText(/self-evaluation phase must start within the evaluation period/i),
    ).toBeInTheDocument();
    expect(createCycleMock).not.toHaveBeenCalled();
  });

  it('creates a performance cycle with valid dates', async () => {
    createCycleMock.mockResolvedValueOnce({ id: 'cy1' });
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('button', { name: /create cycle/i }));
    await screen.findByRole('dialog');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const values = [
      '2026-01-01', // period start
      '2026-06-30', // period end
      '2026-01-15', // self-eval start
      '2026-02-15', // self-eval end
      '2026-02-16', // manager eval start
      '2026-03-15', // manager eval end
      '2026-03-16', // hr review start
      '2026-04-15', // hr review end
    ];
    dateInputs.forEach((inp, i) => {
      fireEvent.change(inp, { target: { value: values[i] } });
    });
    await user.click(screen.getByRole('button', { name: /create cycle$/i }));
    await waitFor(() => expect(createCycleMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/cycle created successfully/i)).toBeInTheDocument();
  });

  it('loads probation-eligible employees when the cycle type is Probation', async () => {
    listProbationEligibleMock.mockResolvedValueOnce([
      {
        id: 'p1',
        firstName: 'Pat',
        lastName: 'Probie',
        email: 'pat@example.com',
        probationEnd: '2026-02-01',
      },
    ]);
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('button', { name: /create cycle/i }));
    await screen.findByRole('dialog');
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'PROBATION' } });
    await waitFor(() => expect(listProbationEligibleMock).toHaveBeenCalled());
  });

  it('opens a review detail by clicking the review row', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Alice Admin'));
    expect(await screen.findByText('Competency ratings')).toBeInTheDocument();
    expect(screen.getByText('Mid-Year Review · Manager: Carol Reyes')).toBeInTheDocument();
  });

  it('submits a self-evaluation and shows a success toast', async () => {
    const user = userEvent.setup();
    const selfReview = {
      ...reviews[0],
      id: 'rv-self',
      employeeId: 'hr1',
      employeeName: 'Helen Reyes',
      managerName: 'Carol Reyes',
      status: 'Self-Evaluation',
      selfEvaluationSubmitted: false,
    };
    listReviewsMock.mockResolvedValueOnce([selfReview]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Helen Reyes'));
    await screen.findByText('Competency ratings');
    await user.type(
      screen.getByPlaceholderText(/key achievements this period/i),
      'Shipped payroll',
    );
    await user.type(screen.getByPlaceholderText(/goals for next period/i), 'Lead analytics');
    await user.click(screen.getByRole('button', { name: /submit self-evaluation/i }));
    expect(
      await waitFor(() =>
        expect(submitSelfMock).toHaveBeenCalledWith(
          'rv-self',
          expect.objectContaining({ achievements: 'Shipped payroll', goals: 'Lead analytics' }),
        ),
      ),
    ).toBeTruthy();
    expect(await screen.findByText(/self-evaluation submitted successfully/i)).toBeInTheDocument();
  });

  it('blocks self-evaluation submit when achievements or goals are empty', async () => {
    const user = userEvent.setup();
    const selfReview = {
      ...reviews[0],
      id: 'rv-self2',
      employeeId: 'hr1',
      employeeName: 'Helen Reyes',
      status: 'Self-Evaluation',
    };
    listReviewsMock.mockResolvedValueOnce([selfReview]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Helen Reyes'));
    await screen.findByText('Competency ratings');
    await user.click(screen.getByRole('button', { name: /submit self-evaluation/i }));
    expect(
      await screen.findByText(/achievements and goals are required before submitting/i),
    ).toBeInTheDocument();
    expect(submitSelfMock).not.toHaveBeenCalled();
  });

  it('surfaces an error toast when self-evaluation submission fails', async () => {
    const user = userEvent.setup();
    submitSelfMock.mockRejectedValueOnce(new Error('already locked'));
    const selfReview = {
      ...reviews[0],
      id: 'rv-self3',
      employeeId: 'hr1',
      employeeName: 'Helen Reyes',
      status: 'Self-Evaluation',
    };
    listReviewsMock.mockResolvedValueOnce([selfReview]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Helen Reyes'));
    await screen.findByText('Competency ratings');
    await user.type(screen.getByPlaceholderText(/key achievements this period/i), 'Done');
    await user.type(screen.getByPlaceholderText(/goals for next period/i), 'Next');
    await user.click(screen.getByRole('button', { name: /submit self-evaluation/i }));
    expect(await screen.findByText(/already locked/i)).toBeInTheDocument();
  });

  it('submits a manager evaluation with comments', async () => {
    const user = userEvent.setup();
    const managerCycle = {
      ...cycles[0],
      id: 'cy-mgr',
      type: 'Mid-Year Review',
      currentPhase: 'Manager Evaluation',
    };
    const managerReview = {
      ...reviews[0],
      id: 'rv-mgr',
      cycleId: 'cy-mgr',
      employeeId: 'e2',
      employeeName: 'Bob Probie',
      managerName: 'Helen Reyes',
      status: 'Manager Evaluation',
      selfEvaluationSubmitted: true,
      competencies: [
        {
          competency: 'Communication',
          selfRating: 4,
          managerRating: undefined as number | undefined,
        },
      ],
    };
    listReviewsMock.mockResolvedValueOnce([managerReview]);
    listCyclesMock.mockResolvedValueOnce([managerCycle]);
    useAuthMock.mockReturnValue(
      makeAuth(['conductReviews'], {
        id: 'hr1',
        firstName: 'Helen',
        lastName: 'Reyes',
        role: 'Manager',
      }),
    );
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Bob Probie'));
    await screen.findByText('Competency ratings');
    await user.type(screen.getByPlaceholderText(/overall assessment/i), 'Strong delivery');
    await user.click(screen.getByRole('button', { name: /submit manager evaluation/i }));
    expect(
      await waitFor(() =>
        expect(submitManagerMock).toHaveBeenCalledWith(
          'rv-mgr',
          expect.objectContaining({ comments: 'Strong delivery' }),
        ),
      ),
    ).toBeTruthy();
    expect(
      await screen.findByText(/manager evaluation submitted successfully/i),
    ).toBeInTheDocument();
  });

  it('blocks HR finalization until comments are provided', async () => {
    const user = userEvent.setup();
    const hrReview = {
      ...reviews[1],
      id: 'rv-hr',
      employeeId: 'e2',
      employeeName: 'Bob Probie',
      status: 'HR Review',
      hrFinalized: false,
      selfEvaluationSubmitted: true,
      managerEvaluationSubmitted: true,
      competencies: [{ competency: 'Communication', selfRating: 4, managerRating: 4 }],
    };
    listReviewsMock.mockResolvedValueOnce([hrReview]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Bob Probie'));
    await screen.findByText('Competency ratings');
    // Clicking "Finalize review" reveals the rating selector and confirm button.
    await user.click(screen.getByRole('button', { name: /finalize review/i }));
    await screen.findByRole('button', { name: /confirm finalization/i });
    // Confirming without HR comments surfaces a validation error.
    await user.click(screen.getByRole('button', { name: /confirm finalization/i }));
    expect(
      await screen.findByText(/hr comments are required before finalizing/i),
    ).toBeInTheDocument();
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it('finalizes a review with HR comments and an overall rating', async () => {
    const user = userEvent.setup();
    const hrReview = {
      ...reviews[1],
      id: 'rv-hr',
      employeeId: 'e2',
      employeeName: 'Bob Probie',
      status: 'HR Review',
      hrFinalized: false,
      selfEvaluationSubmitted: true,
      managerEvaluationSubmitted: true,
      competencies: [{ competency: 'Communication', selfRating: 4, managerRating: 4 }],
    };
    listReviewsMock.mockResolvedValueOnce([hrReview]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Bob Probie'));
    await screen.findByText('Competency ratings');
    await user.type(screen.getByPlaceholderText(/final review comments/i), 'Meets bar');
    await user.click(screen.getByRole('button', { name: /finalize review/i }));
    await screen.findByRole('button', { name: /confirm finalization/i });
    await user.click(screen.getByRole('button', { name: /confirm finalization/i }));
    expect(
      await waitFor(() =>
        expect(finalizeMock).toHaveBeenCalledWith('rv-hr', expect.any(Number), 'Meets bar'),
      ),
    ).toBeTruthy();
    expect(await screen.findByText(/review finalized successfully/i)).toBeInTheDocument();
  });

  it('renders the employee rebuttal section for a finalized review', async () => {
    const user = userEvent.setup();
    const rebuttalReview = {
      ...reviews[1],
      id: 'rv-hr2',
      employeeId: 'hr1',
      employeeName: 'Helen Reyes',
      status: 'HR Review',
      hrFinalized: true,
      selfEvaluationSubmitted: true,
      managerEvaluationSubmitted: true,
      competencies: [{ competency: 'Communication', selfRating: 4, managerRating: 4 }],
    };
    listReviewsMock.mockResolvedValueOnce([rebuttalReview]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Helen Reyes'));
    await screen.findByText('Competency ratings');
    // The rebuttal section is shown once the review is finalized.
    expect(await screen.findByPlaceholderText(/explain why you disagree/i)).toBeInTheDocument();
    // The submit button stays disabled until the employee enters a rebuttal.
    expect(screen.getByRole('button', { name: /submit rebuttal/i })).toBeDisabled();
  });

  it('returns from the review detail view to the reviews list', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Alice Admin'));
    await screen.findByText('Competency ratings');
    await user.click(screen.getByRole('button', { name: /back to reviews/i }));
    expect(await screen.findByText('Performance reviews')).toBeInTheDocument();
  });

  it('shows an empty state on the reviews tab when no reviews are assigned', async () => {
    const user = userEvent.setup();
    listReviewsMock.mockResolvedValueOnce([]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    expect(await screen.findByText(/no reviews assigned/i)).toBeInTheDocument();
  });

  it('closes an open cycle', async () => {
    const user = userEvent.setup();
    render(<PerformancePage />);
    expect(await screen.findByText('Mid-Year Review')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^close$/i }));
    expect(await waitFor(() => expect(closeCycleMock).toHaveBeenCalledWith('cy1')));
  });

  it('hides the Create Cycle button without managePerformance permission', async () => {
    useAuthMock.mockReturnValue(makeAuth([]));
    render(<PerformancePage />);
    await screen.findByRole('heading', { name: /performance/i });
    expect(screen.queryByRole('button', { name: /create cycle/i })).not.toBeInTheDocument();
  });

  it('blocks manager evaluation submit when comments are empty', async () => {
    const user = userEvent.setup();
    const managerReview = {
      ...reviews[0],
      id: 'rv-mgr2',
      cycleId: 'cy-mgr2',
      employeeId: 'e2',
      employeeName: 'Bob Probie',
      managerName: 'Helen Reyes',
      status: 'Manager Evaluation',
      selfEvaluationSubmitted: true,
      competencies: [
        {
          competency: 'Communication',
          selfRating: 4,
          managerRating: undefined as number | undefined,
        },
      ],
    };
    listReviewsMock.mockResolvedValueOnce([managerReview]);
    listCyclesMock.mockResolvedValueOnce([
      { ...cycles[0], id: 'cy-mgr2', type: 'Mid-Year Review', currentPhase: 'Manager Evaluation' },
    ]);
    useAuthMock.mockReturnValue(
      makeAuth(['conductReviews'], {
        id: 'hr1',
        firstName: 'Helen',
        lastName: 'Reyes',
        role: 'Manager',
      }),
    );
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Bob Probie'));
    await screen.findByText('Competency ratings');
    await user.click(screen.getByRole('button', { name: /submit manager evaluation/i }));
    expect(
      await screen.findByText(/manager comments are required before submitting/i),
    ).toBeInTheDocument();
    expect(submitManagerMock).not.toHaveBeenCalled();
  });

  it('surfaces an error toast when manager evaluation submission fails', async () => {
    const user = userEvent.setup();
    submitManagerMock.mockRejectedValueOnce(new Error('cycle closed'));
    const managerReview = {
      ...reviews[0],
      id: 'rv-mgr3',
      cycleId: 'cy-mgr3',
      employeeId: 'e2',
      employeeName: 'Bob Probie',
      managerName: 'Helen Reyes',
      status: 'Manager Evaluation',
      selfEvaluationSubmitted: true,
      competencies: [
        {
          competency: 'Communication',
          selfRating: 4,
          managerRating: undefined as number | undefined,
        },
      ],
    };
    listReviewsMock.mockResolvedValueOnce([managerReview]);
    listCyclesMock.mockResolvedValueOnce([
      { ...cycles[0], id: 'cy-mgr3', type: 'Mid-Year Review', currentPhase: 'Manager Evaluation' },
    ]);
    useAuthMock.mockReturnValue(
      makeAuth(['conductReviews'], {
        id: 'hr1',
        firstName: 'Helen',
        lastName: 'Reyes',
        role: 'Manager',
      }),
    );
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Bob Probie'));
    await screen.findByText('Competency ratings');
    await user.type(screen.getByPlaceholderText(/overall assessment/i), 'Good work');
    await user.click(screen.getByRole('button', { name: /submit manager evaluation/i }));
    expect(await screen.findByText(/cycle closed/i)).toBeInTheDocument();
  });

  it('shows the competency ratings table with an unrated competency for a self review', async () => {
    const user = userEvent.setup();
    const selfReview = {
      ...reviews[0],
      id: 'rv-self4',
      employeeId: 'hr1',
      employeeName: 'Helen Reyes',
      managerName: 'Carol Reyes',
      status: 'Self-Evaluation',
      selfEvaluationSubmitted: false,
      competencies: [
        {
          competency: 'Communication',
          selfRating: undefined as number | undefined,
          managerRating: undefined as number | undefined,
        },
      ],
    };
    listReviewsMock.mockResolvedValueOnce([selfReview]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Helen Reyes'));
    await screen.findByText('Competency ratings');
    // The competency name is rendered, and a "Rate" action is offered for the unrated row.
    expect(screen.getByText('Communication')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^rate$/i })).toBeInTheDocument();
    // Guidance explains ratings must be added before submitting.
    expect(screen.getByText(/add your self-ratings/i)).toBeInTheDocument();
  });

  it('submits an employee rebuttal for a finalized review', async () => {
    const user = userEvent.setup();
    const rebuttalReview = {
      ...reviews[1],
      id: 'rv-hr3',
      employeeId: 'hr1',
      employeeName: 'Helen Reyes',
      status: 'HR Review',
      hrFinalized: true,
      selfEvaluationSubmitted: true,
      managerEvaluationSubmitted: true,
      competencies: [{ competency: 'Communication', selfRating: 4, managerRating: 4 }],
    };
    listReviewsMock.mockResolvedValueOnce([rebuttalReview]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Helen Reyes'));
    await screen.findByText('Competency ratings');
    const rebuttalInput = screen.getByPlaceholderText(
      /explain why you disagree with the evaluation/i,
    );
    await user.type(rebuttalInput, 'My goals were not fairly assessed.');
    const submitBtn = screen.getByRole('button', { name: /submit rebuttal/i });
    expect(submitBtn).toBeEnabled();
    await user.click(submitBtn);
    expect(
      await waitFor(() =>
        expect(addRebuttalMock).toHaveBeenCalledWith(
          'rv-hr3',
          'My goals were not fairly assessed.',
        ),
      ),
    ).toBeTruthy();
    expect(await screen.findByText(/rebuttal submitted/i)).toBeInTheDocument();
  });

  it('surfaces an error when adding a rebuttal fails', async () => {
    const user = userEvent.setup();
    addRebuttalMock.mockRejectedValueOnce(new Error('window closed'));
    const rebuttalReview = {
      ...reviews[1],
      id: 'rv-hr4',
      employeeId: 'hr1',
      employeeName: 'Helen Reyes',
      status: 'HR Review',
      hrFinalized: true,
      selfEvaluationSubmitted: true,
      managerEvaluationSubmitted: true,
      competencies: [{ competency: 'Communication', selfRating: 4, managerRating: 4 }],
    };
    listReviewsMock.mockResolvedValueOnce([rebuttalReview]);
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Helen Reyes'));
    await screen.findByText('Competency ratings');
    await user.type(
      screen.getByPlaceholderText(/explain why you disagree with the evaluation/i),
      'Disagree',
    );
    await user.click(screen.getByRole('button', { name: /submit rebuttal/i }));
    expect(await screen.findByText(/window closed/i)).toBeInTheDocument();
  });

  it('hides HR action buttons for a regular employee viewing a finalized review', async () => {
    const user = userEvent.setup();
    const finalizedReview = {
      ...reviews[1],
      id: 'rv-hr5',
      employeeId: 'e1',
      employeeName: 'Alice Admin',
      status: 'HR Review',
      hrFinalized: true,
      selfEvaluationSubmitted: true,
      managerEvaluationSubmitted: true,
      competencies: [{ competency: 'Communication', selfRating: 4, managerRating: 4 }],
    };
    listReviewsMock.mockResolvedValueOnce([finalizedReview]);
    useAuthMock.mockReturnValue(makeAuth([], { id: 'e1', firstName: 'Alice', lastName: 'Admin' }));
    render(<PerformancePage />);
    await user.click(await screen.findByRole('tab', { name: /reviews/i }));
    await user.click(await screen.findByText('Alice Admin'));
    await screen.findByText('Competency ratings');
    // Employee should not see the HR finalize control.
    expect(screen.queryByRole('button', { name: /finalize review/i })).not.toBeInTheDocument();
  });

  it('shows an error state when evaluation data fails to load', async () => {
    listCyclesMock.mockRejectedValueOnce(new Error('network down'));
    listReviewsMock.mockRejectedValueOnce(new Error('reviews unavailable'));
    render(<PerformancePage />);
    expect(await screen.findByText(/failed to load data/i)).toBeInTheDocument();
  });

  it('shows a loading indicator while evaluation cycles are fetched', async () => {
    listCyclesMock.mockImplementation(() => new Promise(() => {}));
    render(<PerformancePage />);
    expect(screen.getByText(/loading evaluation cycles/i)).toBeInTheDocument();
  });
});
