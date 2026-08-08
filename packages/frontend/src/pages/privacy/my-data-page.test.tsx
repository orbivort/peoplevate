import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, tag) => {
        const Comp = ({
          children,
          ...props
        }: {
          children?: React.ReactNode;
          [key: string]: unknown;
        }) => {
          const Tag = tag as keyof JSX.IntrinsicElements;
          return <Tag {...props}>{children}</Tag>;
        };
        Comp.displayName = `motion.${(tag as string).toString()}`;
        return Comp;
      },
    },
  ),
}));

const mockUser = {
  id: 'u-1',
  employeeId: 'e-1',
  email: 'alice@example.com',
  name: 'Alice Smith',
  role: 'Admin' as const,
};

const useAuth = vi.fn(() => ({ user: mockUser, employee: null }));
vi.mock('@/contexts/auth-context', () => ({
  useAuth: (...args: unknown[]) => useAuth(...args),
}));

const useConsentRecords = vi.fn();
const requestDataAccess = vi.fn();
const requestDataExport = vi.fn();
const requestDataErasure = vi.fn();
const withdrawConsent = vi.fn();
const createDsar = vi.fn();

vi.mock('@/data/data-layer', () => ({
  useConsentRecords: (...args: unknown[]) => useConsentRecords(...args),
  requestDataAccess: (...args: unknown[]) => requestDataAccess(...args),
  requestDataExport: (...args: unknown[]) => requestDataExport(...args),
  requestDataErasure: (...args: unknown[]) => requestDataErasure(...args),
  withdrawConsent: (...args: unknown[]) => withdrawConsent(...args),
  createDsar: (...args: unknown[]) => createDsar(...args),
}));

type MockComponentProps = { children?: React.ReactNode; [key: string]: unknown };

vi.mock('@/components/ui/select', () => {
  const Ctx = React.createContext<unknown>(null);
  const Select = ({ value, onValueChange, children }: MockComponentProps) =>
    React.createElement(Ctx.Provider, { value: { value, onValueChange } }, children);
  const SelectTrigger = ({ children }: MockComponentProps) =>
    React.createElement('button', { type: 'button' }, children);
  const SelectValue = ({ placeholder }: MockComponentProps) => {
    const ctx = React.useContext(Ctx);
    return React.createElement(
      React.Fragment,
      null,
      ctx && (ctx as { value?: unknown }).value ? (ctx as { value?: unknown }).value : placeholder,
    );
  };
  const SelectContent = ({ children }: MockComponentProps) =>
    React.createElement(React.Fragment, null, children);
  const SelectItem = ({ value, children }: MockComponentProps) => {
    const ctx = React.useContext(Ctx);
    return React.createElement(
      'button',
      {
        type: 'button',
        onClick: () =>
          ctx && (ctx as { onValueChange?: (v: unknown) => void }).onValueChange?.(value),
      },
      children,
    );
  };
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

vi.mock('@/components/ui/dialog', () => {
  const Dialog = ({ open = true, children }: MockComponentProps) =>
    open ? <div>{children}</div> : null;
  const DialogContent = ({ children }: MockComponentProps) => <div>{children}</div>;
  const DialogHeader = ({ children }: MockComponentProps) => <div>{children}</div>;
  const DialogTitle = ({ children }: MockComponentProps) => <div>{children}</div>;
  const DialogFooter = ({ children }: MockComponentProps) => <div>{children}</div>;
  return { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter };
});

import { MyDataPage } from './my-data-page';

function renderPage() {
  return render(<MyDataPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: mockUser, employee: null });
  useConsentRecords.mockReturnValue({
    data: [],
    loading: false,
    error: null,
    mode: 'mock',
    reload: vi.fn(),
  });
});

describe('MyDataPage', () => {
  it('returns null when no user is authenticated', () => {
    useAuth.mockReturnValue({ user: null, employee: null });
    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the page header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'My data & privacy' })).toBeInTheDocument();
  });

  it('renders the privacy rights cards', () => {
    renderPage();
    expect(screen.getByText(/access & portability/i)).toBeInTheDocument();
    expect(screen.getByText(/right to erasure/i)).toBeInTheDocument();
    expect(screen.getByText(/submit a data request/i)).toBeInTheDocument();
    expect(screen.getAllByText(/your consent/i).length).toBeGreaterThan(0);
  });

  it('requests an access report', async () => {
    requestDataAccess.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /request access report/i }));
    await waitFor(() => expect(requestDataAccess).toHaveBeenCalledWith('u-1'));
    expect(screen.getByText(/access report for alice@example.com/i)).toBeInTheDocument();
  });

  it('opens export dialog and exports data', async () => {
    requestDataExport.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /export my data/i }));
    await user.click(await screen.findByRole('button', { name: /^export$/i }));
    await waitFor(() => expect(requestDataExport).toHaveBeenCalledWith('u-1', 'json'));
  });

  it('shows error feedback when export fails', async () => {
    requestDataExport.mockRejectedValue(new Error('Export failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /export my data/i }));
    await user.click(await screen.findByRole('button', { name: /^export$/i }));
    expect(await screen.findByText(/export failed/i)).toBeInTheDocument();
  });

  it('opens erasure dialog and requests erasure', async () => {
    requestDataErasure.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /request erasure/i }));
    await user.click(await screen.findByRole('button', { name: /confirm erasure/i }));
    await waitFor(() => expect(requestDataErasure).toHaveBeenCalledWith('u-1'));
  });

  it('opens the DSAR dialog and submits a request', async () => {
    createDsar.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /start a request/i }));
    await user.click(await screen.findByRole('button', { name: /submit request/i }));
    await waitFor(() => expect(createDsar).toHaveBeenCalledTimes(1));
    expect(createDsar).toHaveBeenCalledWith(
      expect.objectContaining({ requestType: 'ACCESS', dataSubjectEmail: 'alice@example.com' }),
    );
    expect(screen.getByText(/request has been submitted/i)).toBeInTheDocument();
  });

  it('lists consent records and offers withdrawal', async () => {
    useConsentRecords.mockReturnValue({
      data: [
        {
          id: 'c-1',
          dataSubjectEmail: 'alice@example.com',
          processingPurpose: 'employee-data-processing',
          status: 'GIVEN' as const,
          mechanism: 'EXPLICIT_OPT_IN',
          recordedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      mode: 'mock',
      reload: vi.fn(),
    });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/employee data processing/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /withdraw/i }));
    await user.click(await screen.findByRole('button', { name: /confirm withdrawal/i }));
    expect(withdrawConsent).toHaveBeenCalledWith('c-1');
  });

  it('shows withdrawn badge for non-given consent', () => {
    useConsentRecords.mockReturnValue({
      data: [
        {
          id: 'c-2',
          dataSubjectEmail: 'alice@example.com',
          processingPurpose: 'payroll',
          status: 'WITHDRAWN' as const,
          mechanism: 'EXPLICIT_OPT_IN',
          recordedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      mode: 'mock',
      reload: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/withdrawn/i)).toBeInTheDocument();
  });

  it('shows empty consent state', () => {
    renderPage();
    expect(screen.getByText(/no consent records found/i)).toBeInTheDocument();
  });

  it('falls back to employee email when the user has no email', async () => {
    useAuth.mockReturnValue({
      user: { ...mockUser, email: undefined },
      employee: { email: 'employee@example.com' },
    });
    requestDataAccess.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /request access report/i }));
    expect(await screen.findByText(/access report for employee@example.com/i)).toBeInTheDocument();
  });

  it('exports data in CSV format when selected', async () => {
    requestDataExport.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /export my data/i }));
    await user.click(await screen.findByText(/^csv$/i));
    await user.click(screen.getByRole('button', { name: /^export$/i }));
    await waitFor(() => expect(requestDataExport).toHaveBeenCalledWith('u-1', 'csv'));
    expect(screen.getByText(/portability export \(csv\) has been downloaded/i)).toBeInTheDocument();
  });

  it('shows error feedback when access request fails', async () => {
    requestDataAccess.mockRejectedValue(new Error('Access request failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /request access report/i }));
    expect(await screen.findByText(/access request failed/i)).toBeInTheDocument();
  });

  it('shows error feedback when erasure request fails', async () => {
    requestDataErasure.mockRejectedValue(new Error('Erasure request failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /request erasure/i }));
    await user.click(await screen.findByRole('button', { name: /confirm erasure/i }));
    expect(await screen.findByText(/erasure request failed/i)).toBeInTheDocument();
  });

  it('shows error feedback when DSAR submission fails', async () => {
    createDsar.mockRejectedValue(new Error('DSAR failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /start a request/i }));
    await user.click(await screen.findByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/dsar failed/i)).toBeInTheDocument();
  });

  it('shows error feedback when consent withdrawal fails', async () => {
    useConsentRecords.mockReturnValue({
      data: [
        {
          id: 'c-3',
          dataSubjectEmail: 'alice@example.com',
          processingPurpose: 'payroll',
          status: 'GIVEN' as const,
          mechanism: 'EXPLICIT_OPT_IN',
          recordedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      mode: 'mock',
      reload: vi.fn(),
    });
    withdrawConsent.mockRejectedValue(new Error('Withdraw failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm withdrawal/i }));
    expect(await screen.findByText(/withdraw failed/i)).toBeInTheDocument();
  });

  it('passes the description when submitting a DSAR', async () => {
    createDsar.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /start a request/i }));
    const textarea = await screen.findByPlaceholderText(/describe what you need/i);
    await user.type(textarea, 'Please include my training records');
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    await waitFor(() => expect(createDsar).toHaveBeenCalledTimes(1));
    expect(createDsar).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'ACCESS',
        dataSubjectEmail: 'alice@example.com',
        description: 'Please include my training records',
      }),
    );
  });

  it('opens the erasure dialog with the privileged warning for an Admin user', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /request erasure/i }));
    expect(
      await screen.findByText(
        /as an admin\/hr user, confirming will erase the target data directly/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm erasure/i })).toBeInTheDocument();
  });

  it('opens the erasure dialog with the non-privileged notice for an Employee user', async () => {
    useAuth.mockReturnValue({
      user: { ...mockUser, role: 'Employee' as const },
      employee: null,
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /request erasure/i }));
    expect(await screen.findByText(/continue to submit an erasure request/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('redirects a non-privileged user from erasure to a DSAR erasure request', async () => {
    useAuth.mockReturnValue({
      user: { ...mockUser, role: 'Employee' as const },
      employee: null,
    });
    createDsar.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /request erasure/i }));
    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);
    // The erasure dialog should close and the DSAR dialog should open.
    expect(screen.queryByText(/continue to submit an erasure request/i)).not.toBeInTheDocument();
    expect(screen.getByText(/submit a data subject request/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    await waitFor(() => expect(createDsar).toHaveBeenCalledTimes(1));
    expect(createDsar).toHaveBeenCalledWith(
      expect.objectContaining({ requestType: 'ERASURE', dataSubjectEmail: 'alice@example.com' }),
    );
  });

  it('lists multiple consent records with withdrawn badges and unknown-purpose fallback', () => {
    useConsentRecords.mockReturnValue({
      data: [
        {
          id: 'c-4',
          dataSubjectEmail: 'alice@example.com',
          processingPurpose: 'employee-data-processing',
          status: 'GIVEN' as const,
          mechanism: 'EXPLICIT_OPT_IN',
          recordedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'c-5',
          dataSubjectEmail: 'alice@example.com',
          processingPurpose: 'candidate-recruitment',
          status: 'GIVEN' as const,
          mechanism: 'IMPLICIT',
          recordedAt: '2026-02-02T00:00:00.000Z',
        },
        {
          id: 'c-6',
          dataSubjectEmail: 'alice@example.com',
          processingPurpose: 'unknown-purpose',
          status: 'WITHDRAWN' as const,
          mechanism: 'EXPLICIT_OPT_IN',
          recordedAt: '2026-03-03T00:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      mode: 'mock',
      reload: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/employee data processing/i)).toBeInTheDocument();
    expect(screen.getByText(/candidate recruitment/i)).toBeInTheDocument();
    // Unknown purpose falls back to its raw value.
    expect(screen.getByText(/unknown-purpose/i)).toBeInTheDocument();
    // Two GIVEN records offer withdrawal; one WITHDRAWN shows the badge.
    expect(screen.getAllByRole('button', { name: /^withdraw$/i }).length).toBe(2);
    expect(screen.getAllByText(/withdrawn/i).length).toBeGreaterThan(0);
  });

  it('closes the export dialog via the cancel button', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /export my data/i }));
    expect(await screen.findByRole('button', { name: /^export$/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('button', { name: /^export$/i })).not.toBeInTheDocument();
  });

  it('closes the DSAR dialog via the cancel button', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /start a request/i }));
    expect(await screen.findByRole('button', { name: /submit request/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('button', { name: /submit request/i })).not.toBeInTheDocument();
  });

  it('closes the withdraw dialog via the cancel button without calling withdrawConsent', async () => {
    useConsentRecords.mockReturnValue({
      data: [
        {
          id: 'c-7',
          dataSubjectEmail: 'alice@example.com',
          processingPurpose: 'payroll',
          status: 'GIVEN' as const,
          mechanism: 'EXPLICIT_OPT_IN',
          recordedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      mode: 'mock',
      reload: vi.fn(),
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
    expect(await screen.findByRole('button', { name: /confirm withdrawal/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('button', { name: /confirm withdrawal/i })).not.toBeInTheDocument();
    expect(withdrawConsent).not.toHaveBeenCalled();
  });

  it('reloads consent records after a successful withdrawal', async () => {
    const reloadConsents = vi.fn();
    useConsentRecords.mockReturnValue({
      data: [
        {
          id: 'c-8',
          dataSubjectEmail: 'alice@example.com',
          processingPurpose: 'performance-management',
          status: 'GIVEN' as const,
          mechanism: 'EXPLICIT_OPT_IN',
          recordedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      mode: 'mock',
      reload: reloadConsents,
    });
    withdrawConsent.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm withdrawal/i }));
    await waitFor(() => expect(withdrawConsent).toHaveBeenCalledWith('c-8'));
    expect(reloadConsents).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/consent withdrawn/i)).toBeInTheDocument();
  });
});
