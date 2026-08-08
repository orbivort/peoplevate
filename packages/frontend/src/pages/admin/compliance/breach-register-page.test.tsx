import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

// Mock framer-motion so animation components render as plain elements.
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

const useBreaches = vi.fn();
const createBreach = vi.fn();
const recordBreachNotification = vi.fn();

vi.mock('@/data/data-layer', () => ({
  useBreaches: (...args: unknown[]) => useBreaches(...args),
  createBreach: (...args: unknown[]) => createBreach(...args),
  recordBreachNotification: (...args: unknown[]) => recordBreachNotification(...args),
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

import { BreachRegisterPage } from './breach-register-page';

const baseBreach = {
  id: 'br-1',
  title: 'Email leak',
  description: 'Customer emails exposed',
  severity: 'HIGH' as const,
  containmentStatus: 'OPEN' as const,
  detectionAt: '2026-01-01T00:00:00.000Z',
  saNotifiedAt: null,
  saNotificationDeadline: '2099-01-04T00:00:00.000Z',
  affectedSubjectsCount: 100,
  dataCategoriesAffected: ['EMAIL'],
  isHighRisk: false,
};

function renderPage() {
  return render(<BreachRegisterPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermission.mockReturnValue(true);
  useBreaches.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
});

describe('BreachRegisterPage', () => {
  it('renders the page header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Breach register' })).toBeInTheDocument();
  });

  it('renders empty state when no breaches', () => {
    renderPage();
    expect(screen.getByText('No breaches logged')).toBeInTheDocument();
  });

  it('renders breach rows with severity and status', () => {
    useBreaches.mockReturnValue({ data: [baseBreach], mode: 'mock', reload: vi.fn() });
    renderPage();
    expect(screen.getByText('Email leak')).toBeInTheDocument();
    expect(screen.getAllByText('HIGH').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OPEN').length).toBeGreaterThan(0);
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('shows pending-notification banner when a high-risk breach is unnotified', () => {
    useBreaches.mockReturnValue({ data: [baseBreach], mode: 'mock', reload: vi.fn() });
    renderPage();
    expect(screen.getByText(/require supervisory-authority notification/i)).toBeInTheDocument();
  });

  it('hides "Log breach" button when permission missing', () => {
    hasPermission.mockReturnValue(false);
    renderPage();
    expect(screen.queryByRole('button', { name: /log breach/i })).not.toBeInTheDocument();
  });

  it('validates required fields in create dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /log breach/i }));
    const logButtons = screen.getAllByRole('button', { name: /log breach/i });
    await user.click(logButtons[logButtons.length - 1]);
    // createBreach requires title + description; without them it is a no-op.
    expect(createBreach).not.toHaveBeenCalled();
  });

  it('creates a breach with valid input', async () => {
    const reload = vi.fn();
    useBreaches.mockReturnValue({ data: [], mode: 'mock', reload });
    createBreach.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /log breach/i }));
    await user.type(await screen.findByPlaceholderText(/short summary/i), 'Server breach');
    await user.type(screen.getByPlaceholderText(/what happened/i), 'Disk failure');
    const logButtons = screen.getAllByRole('button', { name: /log breach/i });
    await user.click(logButtons[logButtons.length - 1]);

    await waitFor(() => expect(createBreach).toHaveBeenCalledTimes(1));
    expect(createBreach).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Server breach', description: 'Disk failure' }),
    );
    expect(reload).toHaveBeenCalled();
  });

  it('shows error feedback when createBreach rejects', async () => {
    useBreaches.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
    createBreach.mockRejectedValue(new Error('Create failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /log breach/i }));
    await user.type(await screen.findByPlaceholderText(/short summary/i), 'x');
    await user.type(screen.getByPlaceholderText(/what happened/i), 'y');
    const logButtons = screen.getAllByRole('button', { name: /log breach/i });
    await user.click(logButtons[logButtons.length - 1]);
    expect(await screen.findByText('Create failed')).toBeInTheDocument();
  });

  it('records supervisory-authority notification for a notified-required breach', async () => {
    useBreaches.mockReturnValue({ data: [baseBreach], mode: 'mock', reload: vi.fn() });
    recordBreachNotification.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /notify/i }));
    await user.click(await screen.findByText('Select method'));
    const methodOption = screen.getAllByRole('button', { name: 'Email' })[0];
    await user.click(methodOption);
    await user.click(await screen.findByRole('button', { name: /record notification/i }));
    expect(recordBreachNotification).toHaveBeenCalledWith(
      'br-1',
      expect.objectContaining({ notificationType: 'SUPERVISORY_AUTHORITY', method: 'Email' }),
    );
  });

  it('does not show Notify button when breach is already notified', () => {
    useBreaches.mockReturnValue({
      data: [{ ...baseBreach, saNotifiedAt: '2026-01-02T00:00:00.000Z' }],
      mode: 'mock',
      reload: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole('button', { name: /notify/i })).not.toBeInTheDocument();
  });

  it('does not show Notify button for LOW severity breaches', () => {
    useBreaches.mockReturnValue({
      data: [{ ...baseBreach, severity: 'LOW' as const }],
      mode: 'mock',
      reload: vi.fn(),
    });
    renderPage();
    expect(screen.getByText('Not required')).toBeInTheDocument();
  });

  it('filters breaches by status', async () => {
    useBreaches.mockReturnValue({ data: [baseBreach], mode: 'mock', reload: vi.fn() });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('All statuses'));
    const openOption = screen.getAllByRole('button', { name: 'OPEN' })[0];
    await user.click(openOption);
    expect(useBreaches).toHaveBeenLastCalledWith('OPEN');
  });

  it('isolates the correct breach row in the table', () => {
    useBreaches.mockReturnValue({
      data: [
        baseBreach,
        { ...baseBreach, id: 'br-2', title: 'Other breach', containmentStatus: 'CONTAINED' },
      ],
      mode: 'mock',
      reload: vi.fn(),
    });
    renderPage();
    const row = screen.getByText('Email leak').closest('tr') as HTMLElement;
    expect(within(row).getByText('OPEN')).toBeInTheDocument();
  });
});
