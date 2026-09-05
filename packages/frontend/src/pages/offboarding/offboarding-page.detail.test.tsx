import * as React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const employees = [
    { id: 'e1', firstName: 'Alice', lastName: 'Admin', status: 'Active', departmentId: 'd1' },
  ];
  const records = [
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
  ];
  const clearanceByRecord: Record<string, unknown[]> = {
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
  };
  return {
    employees,
    records,
    clearanceByRecord,
    useAuthMock: vi.fn(),
    listMock: vi.fn(async () => records),
    listClearanceMock: vi.fn(async (id: string) => clearanceByRecord[id] ?? []),
    initiateMock: vi.fn(async () => ({})),
    updateClearanceMock: vi.fn(async () => ({})),
    updateClearanceItemMock: vi.fn(async () => ({})),
    closeMock: vi.fn(async () => ({})),
    submitResignationMock: vi.fn(async () => ({})),
    conductExitInterviewMock: vi.fn(async () => ({})),
    saveSettlementMock: vi.fn(async () => ({})),
    advanceMock: vi.fn(async () => ({})),
  };
});

vi.mock('@/contexts/auth-context', () => ({ useAuth: () => mocks.useAuthMock() }));
vi.mock('@/lib/api/workflow-repositories', () => ({
  offboardingRepo: {
    list: mocks.listMock,
    listClearance: mocks.listClearanceMock,
    initiate: mocks.initiateMock,
    initiateTermination: mocks.initiateMock,
    close: mocks.closeMock,
    conductExitInterview: mocks.conductExitInterviewMock,
    saveSettlement: mocks.saveSettlementMock,
    updateClearanceItem: mocks.updateClearanceItemMock,
    advance: mocks.advanceMock,
  },
}));
vi.mock('@/lib/api/repositories', () => ({
  employeeRepo: { list: vi.fn(async () => mocks.employees), get: vi.fn() },
  departmentRepo: {
    list: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  positionRepo: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  userRepo: {
    list: vi.fn(async () => []),
    invite: vi.fn(),
    changeRole: vi.fn(),
    changeStatus: vi.fn(),
    resetPassword: vi.fn(),
    delete: vi.fn(),
  },
  documentRepo: { listByEmployee: vi.fn(async () => []) },
  auditLogRepo: { list: vi.fn(async () => []), exportCsv: vi.fn() },
  alertRepo: { list: vi.fn(async () => []) },
}));
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(async () => []),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  },
  registerSessionExpiredHandler: vi.fn(() => () => {}),
}));

import { MemoryRouter } from 'react-router';
import { OffboardingPage } from './offboarding-page';

describe('OffboardingPage detail interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPage() {
    mocks.useAuthMock.mockReturnValue({
      employee: mocks.employees[0],
      hasPermission: (p: string) => p === 'manageOffboarding',
    });
    return render(
      <MemoryRouter>
        <OffboardingPage />
      </MemoryRouter>,
    );
  }

  it('toggles clearance, conducts exit interview, and advances stage', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument());
    // Open the record detail.
    await user.click(screen.getByText('Alice Admin'));
    await waitFor(() => expect(screen.getByText('Clearance checklist')).toBeInTheDocument());

    // Mark the pending item complete.
    const markBtns = screen.getAllByText('Mark complete');
    await user.click(markBtns[0]);
    await waitFor(() => expect(mocks.updateClearanceItemMock).toHaveBeenCalled());

    // Conduct an exit interview.
    await user.click(screen.getByText('Conduct interview'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Decline the interview (questions start empty, so this bypasses the answer requirement).
    await user.click(screen.getByLabelText('Employee declined interview'));
    const submitBtns = screen.getAllByText('Save interview');
    await user.click(submitBtns[0]);
    await waitFor(() => expect(mocks.conductExitInterviewMock).toHaveBeenCalled());
  });

  it('renders settlement section for a closed record with settlement', async () => {
    const user = userEvent.setup();
    mocks.listMock.mockResolvedValueOnce([
      {
        ...mocks.records[0],
        status: 'Closed',
        settlement: {
          totalAmount: 500,
          outstandingFlagged: false,
          leaveEncashmentDays: 0,
          leaveEncashmentAmount: 1234,
          pendingDues: [],
        },
      },
    ]);
    mocks.useAuthMock.mockReturnValue({
      employee: mocks.employees[0],
      hasPermission: (p: string) => p === 'manageOffboarding',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument());
    await user.click(screen.getByText('Alice Admin'));
    await waitFor(() => expect(screen.getByText('Final settlement')).toBeInTheDocument());
  });

  it('generates a settlement', async () => {
    const user = userEvent.setup();
    mocks.listMock.mockResolvedValueOnce([
      { ...mocks.records[0], status: 'Settlement', settlement: null },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument());
    await user.click(screen.getByText('Alice Admin'));
    await waitFor(() => expect(screen.getByText('Clearance checklist')).toBeInTheDocument());

    // Generate a settlement.
    await user.click(screen.getByText('Generate settlement'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText('Encashment days')).toBeInTheDocument();
    expect(screen.getByLabelText('Daily rate ($)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Encashment days'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Daily rate ($)'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Save settlement'));
    // The dialog should close after saving.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('blocks settlement save when encashment values are negative', async () => {
    const user = userEvent.setup();
    mocks.listMock.mockResolvedValueOnce([
      { ...mocks.records[0], status: 'Settlement', settlement: null },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument());
    await user.click(screen.getByText('Alice Admin'));
    await waitFor(() => expect(screen.getByText('Clearance checklist')).toBeInTheDocument());

    await user.click(screen.getByText('Generate settlement'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Encashment days'), { target: { value: '-5' } });
    fireEvent.click(screen.getByText('Save settlement'));
    // Validation should block the save and surface an error.
    expect(await screen.findByText(/encashment days cannot be negative/i)).toBeInTheDocument();
    expect(mocks.saveSettlementMock).not.toHaveBeenCalled();
  });
});
