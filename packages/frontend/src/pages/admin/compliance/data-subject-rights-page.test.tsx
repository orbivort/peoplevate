import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const useAnomalyAlerts = vi.fn();
const useUsers = vi.fn();
const dismissAnomaly = vi.fn();
const requestDataAccess = vi.fn();
const requestDataErasure = vi.fn();
const requestDataExport = vi.fn();

vi.mock('@/data/data-layer', () => ({
  useAnomalyAlerts: (...args: unknown[]) => useAnomalyAlerts(...args),
  useUsers: (...args: unknown[]) => useUsers(...args),
  dismissAnomaly: (...args: unknown[]) => dismissAnomaly(...args),
  requestDataAccess: (...args: unknown[]) => requestDataAccess(...args),
  requestDataErasure: (...args: unknown[]) => requestDataErasure(...args),
  requestDataExport: (...args: unknown[]) => requestDataExport(...args),
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

import { DataSubjectRightsPage } from './data-subject-rights-page';

const baseAlert = {
  id: 'a-1',
  alertType: 'ANOMALOUS_DOWNLOAD' as const,
  entityType: 'EMPLOYEE' as const,
  entityId: 'e-1',
  details: { employeeName: 'Alice Smith' },
  status: 'OPEN' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const baseUser = {
  id: 'u-1',
  employeeId: 'e-1',
  name: 'Alice Smith',
  email: 'alice@example.com',
  role: 'EMPLOYEE' as const,
  department: 'Engineering',
};

function renderPage() {
  return render(<DataSubjectRightsPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermission.mockReturnValue(true);
  useAnomalyAlerts.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
  useUsers.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
});

describe('DataSubjectRightsPage', () => {
  it('renders the page header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Data subject rights' })).toBeInTheDocument();
  });

  it('renders empty state when no alerts and no users', () => {
    renderPage();
    expect(screen.getByText('No anomaly alerts')).toBeInTheDocument();
  });

  it('renders anomaly alerts', () => {
    useAnomalyAlerts.mockReturnValue({ data: [baseAlert], mode: 'mock', reload: vi.fn() });
    renderPage();
    expect(screen.getByText('ANOMALOUS DOWNLOAD')).toBeInTheDocument();
    expect(screen.getByText(/EMPLOYEE e-1/i)).toBeInTheDocument();
  });

  it('dismisses an anomaly alert', async () => {
    useAnomalyAlerts.mockReturnValue({ data: [baseAlert], mode: 'mock', reload: vi.fn() });
    dismissAnomaly.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(dismissAnomaly).toHaveBeenCalledWith('a-1', 'Reviewed and dismissed by compliance.');
  });

  it('hides dismiss button for resolved alerts', () => {
    useAnomalyAlerts.mockReturnValue({
      data: [{ ...baseAlert, status: 'RESOLVED' as const }],
      mode: 'mock',
      reload: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('looks up a subject by email', async () => {
    useUsers.mockReturnValue({ data: [baseUser], mode: 'mock', reload: vi.fn() });
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByPlaceholderText(/search by user id or email/i),
      'alice@example.com',
    );
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
  });

  it('does not match a non-matching subject', async () => {
    useUsers.mockReturnValue({ data: [baseUser], mode: 'mock', reload: vi.fn() });
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByPlaceholderText(/search by user id or email/i),
      'nobody@example.com',
    );
    expect(await screen.findByText(/No user matches/i)).toBeInTheDocument();
  });

  it('requests data access for a looked-up subject', async () => {
    useUsers.mockReturnValue({ data: [baseUser], mode: 'mock', reload: vi.fn() });
    requestDataAccess.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByPlaceholderText(/search by user id or email/i),
      'alice@example.com',
    );
    await screen.findByText('alice@example.com');
    await user.click(screen.getByRole('button', { name: /access \/ export/i }));
    await user.click(await screen.findByRole('button', { name: /compile access report/i }));
    expect(requestDataAccess).toHaveBeenCalledWith('u-1');
  });

  it('exports a looked-up subject', async () => {
    useUsers.mockReturnValue({ data: [baseUser], mode: 'mock', reload: vi.fn() });
    requestDataExport.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByPlaceholderText(/search by user id or email/i),
      'alice@example.com',
    );
    await screen.findByText('alice@example.com');
    await user.click(screen.getByRole('button', { name: /access \/ export/i }));
    await user.click(await screen.findByRole('button', { name: /export \(json\)/i }));
    expect(requestDataExport).toHaveBeenCalledWith('u-1', 'json');
  });

  it('requests erasure for a looked-up subject', async () => {
    useUsers.mockReturnValue({ data: [baseUser], mode: 'mock', reload: vi.fn() });
    requestDataErasure.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByPlaceholderText(/search by user id or email/i),
      'alice@example.com',
    );
    await screen.findByText('alice@example.com');
    await user.click(screen.getByRole('button', { name: /erase/i }));
    await user.click(await screen.findByRole('button', { name: /confirm erasure/i }));
    expect(requestDataErasure).toHaveBeenCalledWith('u-1');
  });

  it('hides action buttons when permission missing', () => {
    hasPermission.mockReturnValue(false);
    renderPage();
    expect(screen.queryByRole('button', { name: /dismiss all|dismiss/i })).not.toBeInTheDocument();
  });
});
