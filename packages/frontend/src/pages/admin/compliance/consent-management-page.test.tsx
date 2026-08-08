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

const hasPermission = vi.fn(() => true);
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ hasPermission }),
}));

const useConsentRecords = vi.fn();
const recordConsent = vi.fn();
const withdrawConsent = vi.fn();

vi.mock('@/data/data-layer', () => ({
  useConsentRecords: (...args: unknown[]) => useConsentRecords(...args),
  recordConsent: (...args: unknown[]) => recordConsent(...args),
  withdrawConsent: (...args: unknown[]) => withdrawConsent(...args),
}));

type MockComponentProps = { children?: React.ReactNode; [key: string]: unknown };

vi.mock('@/components/ui/dialog', () => {
  const Dialog = ({ open = true, children }: MockComponentProps) =>
    open ? <div>{children}</div> : null;
  const DialogContent = ({ children }: MockComponentProps) => <div>{children}</div>;
  const DialogHeader = ({ children }: MockComponentProps) => <div>{children}</div>;
  const DialogTitle = ({ children }: MockComponentProps) => <div>{children}</div>;
  const DialogFooter = ({ children }: MockComponentProps) => <div>{children}</div>;
  return { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter };
});

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

import { ConsentManagementPage } from './consent-management-page';

const baseConsent = {
  id: 'c-1',
  dataSubjectEmail: 'alice@example.com',
  processingPurpose: 'employee-data-processing',
  mechanism: 'CHECKBOX' as const,
  status: 'GIVEN' as const,
  noticeVersion: 'v1',
  recordedAt: '2026-01-01T00:00:00.000Z',
  consentText: 'I consent',
};

function renderPage() {
  return render(<ConsentManagementPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermission.mockReturnValue(true);
  useConsentRecords.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
});

describe('ConsentManagementPage', () => {
  it('renders the page header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Consent management' })).toBeInTheDocument();
  });

  it('renders empty state when no records', () => {
    renderPage();
    expect(screen.getByText('No consent records')).toBeInTheDocument();
  });

  it('renders consent rows with purpose and status', () => {
    useConsentRecords.mockReturnValue({ data: [baseConsent], mode: 'mock', reload: vi.fn() });
    renderPage();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Employee data processing').length).toBeGreaterThan(0);
    expect(screen.getByText('GIVEN')).toBeInTheDocument();
  });

  it('searches by email', async () => {
    useConsentRecords.mockReturnValue({ data: [baseConsent], mode: 'mock', reload: vi.fn() });
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByPlaceholderText(/search by email or purpose/i), 'bob');
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
  });

  it('filters out linked withdrawal records', () => {
    useConsentRecords.mockReturnValue({
      data: [{ ...baseConsent, id: 'c-2', withdrawsConsentId: 'c-1' }],
      mode: 'mock',
      reload: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
  });

  it('hides "Record consent" button when permission missing', () => {
    hasPermission.mockReturnValue(false);
    renderPage();
    expect(screen.queryByRole('button', { name: /record consent/i })).not.toBeInTheDocument();
  });

  it('validates required fields in record dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /record consent/i }));
    const submitButtons = screen.getAllByRole('button', { name: /^record consent$/i });
    await user.click(submitButtons[submitButtons.length - 1]);
    expect(
      await screen.findByText(/data subject email and consent text are required/i),
    ).toBeInTheDocument();
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('records consent with valid input', async () => {
    const reload = vi.fn();
    useConsentRecords.mockReturnValue({ data: [], mode: 'mock', reload });
    recordConsent.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /record consent/i }));
    await user.type(await screen.findByPlaceholderText(/jane@example.com/i), 'bob@example.com');
    await user.type(screen.getByPlaceholderText(/exact wording/i), 'I consent to processing');
    const submitButtons = screen.getAllByRole('button', { name: /^record consent$/i });
    await user.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => expect(recordConsent).toHaveBeenCalledTimes(1));
    expect(recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSubjectEmail: 'bob@example.com',
        processingPurpose: 'employee-data-processing',
        consentText: 'I consent to processing',
      }),
    );
    expect(reload).toHaveBeenCalled();
  });

  it('shows error feedback when recordConsent rejects', async () => {
    useConsentRecords.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
    recordConsent.mockRejectedValue(new Error('Save failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /record consent/i }));
    await user.type(await screen.findByPlaceholderText(/jane@example.com/i), 'bob@example.com');
    await user.type(screen.getByPlaceholderText(/exact wording/i), 'I consent');
    const submitButtons = screen.getAllByRole('button', { name: /^record consent$/i });
    await user.click(submitButtons[submitButtons.length - 1]);
    expect(await screen.findByText('Save failed')).toBeInTheDocument();
  });

  it('withdraws a GIVEN consent', async () => {
    useConsentRecords.mockReturnValue({ data: [baseConsent], mode: 'mock', reload: vi.fn() });
    withdrawConsent.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /withdraw/i }));
    await user.click(screen.getByRole('button', { name: /confirm withdrawal/i }));
    expect(withdrawConsent).toHaveBeenCalledWith('c-1', undefined);
  });

  it('does not show withdraw for non-GIVEN consent', () => {
    useConsentRecords.mockReturnValue({
      data: [{ ...baseConsent, status: 'WITHDRAWN' as const }],
      mode: 'mock',
      reload: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
  });
});
