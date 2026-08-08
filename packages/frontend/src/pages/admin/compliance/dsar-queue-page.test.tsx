import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

const hasPermission = vi.fn(() => true);
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ hasPermission }),
}));

const useDsars = vi.fn();
const updateDsarStatus = vi.fn();

vi.mock('@/data/data-layer', () => ({
  useDsars: (...args: unknown[]) => useDsars(...args),
  updateDsarStatus: (...args: unknown[]) => updateDsarStatus(...args),
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

import { DsarQueuePage } from './dsar-queue-page';

const baseDsar = {
  id: 'd-1',
  dataSubjectEmail: 'alice@example.com',
  description: 'Please export my data',
  requestType: 'ACCESS' as const,
  status: 'PENDING_VERIFICATION' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  slaDeadline: '2026-01-30T00:00:00.000Z',
  assignedTo: null,
  completedAt: null,
};

function renderPage() {
  return render(<DsarQueuePage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermission.mockReturnValue(true);
  useDsars.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
});

describe('DsarQueuePage', () => {
  it('renders the page header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Data subject requests' })).toBeInTheDocument();
  });

  it('renders empty state', () => {
    renderPage();
    expect(screen.getByText('No data subject requests')).toBeInTheDocument();
  });

  it('renders dsar rows', () => {
    useDsars.mockReturnValue({ data: [baseDsar], mode: 'mock', reload: vi.fn() });
    renderPage();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('Access')).toBeInTheDocument();
    expect(screen.getAllByText('PENDING VERIFICATION').length).toBeGreaterThan(0);
    expect(screen.getByText('Please export my data')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    useDsars.mockReturnValue({ data: [baseDsar], mode: 'mock', reload: vi.fn() });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('All statuses'));
    const option = screen.getAllByRole('button', { name: 'PENDING VERIFICATION' })[0];
    await user.click(option);
    expect(useDsars).toHaveBeenLastCalledWith('PENDING_VERIFICATION');
  });

  it('opens update dialog and changes status', async () => {
    useDsars.mockReturnValue({ data: [baseDsar], mode: 'mock', reload: vi.fn() });
    updateDsarStatus.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /update/i }));
    await user.click(await screen.findByText('Select status'));
    const option = screen.getAllByRole('button', { name: 'In progress' })[0];
    await user.click(option);
    await user.click(screen.getByRole('button', { name: /update status/i }));
    expect(updateDsarStatus).toHaveBeenCalledWith('d-1', { status: 'IN_PROGRESS' });
  });

  it('shows error feedback when update fails', async () => {
    useDsars.mockReturnValue({ data: [baseDsar], mode: 'mock', reload: vi.fn() });
    updateDsarStatus.mockRejectedValue(new Error('Update failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /update/i }));
    await user.click(await screen.findByText('Select status'));
    const option = screen.getAllByRole('button', { name: 'In progress' })[0];
    await user.click(option);
    await user.click(screen.getByRole('button', { name: /update status/i }));
    expect(await screen.findByText('Update failed')).toBeInTheDocument();
  });

  it('hides update button when permission missing', () => {
    hasPermission.mockReturnValue(false);
    useDsars.mockReturnValue({ data: [baseDsar], mode: 'mock', reload: vi.fn() });
    renderPage();
    expect(screen.queryByRole('button', { name: /update/i })).not.toBeInTheDocument();
  });
});
