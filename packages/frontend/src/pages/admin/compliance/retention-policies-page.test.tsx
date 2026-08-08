import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

const hasPermission = vi.fn(() => true);
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ hasPermission }),
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

const useRetentionPolicies = vi.fn();
const upsertRetentionPolicy = vi.fn();
const runRetentionPurge = vi.fn();

vi.mock('@/data/data-layer', () => ({
  useRetentionPolicies: (...args: unknown[]) => useRetentionPolicies(...args),
  upsertRetentionPolicy: (...args: unknown[]) => upsertRetentionPolicy(...args),
  runRetentionPurge: (...args: unknown[]) => runRetentionPurge(...args),
}));

vi.mock('@/components/ui/dialog', () => {
  const Dialog = ({ open = true, children }: MockComponentProps) =>
    open ? <div>{children}</div> : null;
  const DialogContent = ({ children }: MockComponentProps) => <div>{children}</div>;
  const DialogHeader = ({ children }: MockComponentProps) => <div>{children}</div>;
  const DialogTitle = ({ children }: MockComponentProps) => <div>{children}</div>;
  const DialogFooter = ({ children }: MockComponentProps) => <div>{children}</div>;
  return { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter };
});

import { RetentionPoliciesPage } from './retention-policies-page';

const basePolicy = {
  id: 'p-1',
  dataCategory: 'CANDIDATE_RESUMES' as const,
  retentionYears: 2,
  action: 'HARD_DELETE' as const,
  description: 'Delete candidate resumes after hiring',
  isDefault: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'hr',
};

function renderPage() {
  return render(<RetentionPoliciesPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermission.mockReturnValue(true);
  useRetentionPolicies.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
});

describe('RetentionPoliciesPage', () => {
  it('renders the page header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Data retention' })).toBeInTheDocument();
  });

  it('renders empty state', () => {
    renderPage();
    expect(screen.getByText('No retention policies')).toBeInTheDocument();
  });

  it('renders policy rows', () => {
    useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
    renderPage();
    expect(screen.getByText('Candidate resumes')).toBeInTheDocument();
    expect(screen.getByText('HARD_DELETE')).toBeInTheDocument();
    expect(screen.getByText('Delete candidate resumes after hiring')).toBeInTheDocument();
  });

  it('hides "Edit policy" when permission missing', () => {
    hasPermission.mockReturnValue(false);
    renderPage();
    expect(screen.queryByRole('button', { name: /edit policy/i })).not.toBeInTheDocument();
  });

  it('opens policy dialog pre-filled with defaults and saves a new policy', async () => {
    const reload = vi.fn();
    useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload });
    upsertRetentionPolicy.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /edit policy/i }));
    expect(await screen.findByDisplayValue('2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save policy/i }));
    expect(upsertRetentionPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ dataCategory: 'CANDIDATE_RESUMES', retentionYears: 2 }),
    );
    expect(reload).toHaveBeenCalled();
  });

  it('shows error feedback when saving a policy fails', async () => {
    useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
    upsertRetentionPolicy.mockRejectedValue(new Error('Save failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /edit policy/i }));
    await user.click(screen.getByRole('button', { name: /save policy/i }));
    expect(await screen.findByText('Save failed')).toBeInTheDocument();
  });

  it('runs a dry-run purge from header', async () => {
    useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
    runRetentionPurge.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /dry run purge/i }));
    await user.click(await screen.findByRole('button', { name: /run dry run/i }));
    expect(runRetentionPurge).toHaveBeenCalledWith(true);
    expect(screen.getByText(/dry run completed/i)).toBeInTheDocument();
  });

  it('shows error feedback when purge fails', async () => {
    useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
    runRetentionPurge.mockRejectedValue(new Error('Purge failed'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /dry run purge/i }));
    await user.click(await screen.findByRole('button', { name: /run dry run/i }));
    expect(await screen.findByText('Purge failed')).toBeInTheDocument();
  });

  describe('stats cards and banners', () => {
    it('renders summary stats from policies', () => {
      useRetentionPolicies.mockReturnValue({
        data: [
          { ...basePolicy, retentionYears: 3 },
          { ...basePolicy, id: 'p-2', dataCategory: 'AUDIT_LOGS', action: 'ANONYMIZE' },
        ],
        mode: 'mock',
        reload: vi.fn(),
      });
      renderPage();
      expect(screen.getByText('2')).toBeInTheDocument(); // policy categories
      expect(screen.getByText('3y')).toBeInTheDocument(); // longest retention
      expect(screen.getByText('1')).toBeInTheDocument(); // hard-delete categories
    });

    it('shows zero stats when there are no policies', () => {
      renderPage();
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBeGreaterThan(0);
      // Longest retention card shows "0y" when no policies define a retention period.
      expect(screen.getByText('0y')).toBeInTheDocument();
    });

    it('shows the fallback banner when backend is unavailable', () => {
      useRetentionPolicies.mockReturnValue({ data: [], mode: 'fallback', reload: vi.fn() });
      renderPage();
      expect(screen.getByText(/backend unavailable — showing demo data/i)).toBeInTheDocument();
    });

    it('does not show the fallback banner in mock mode', () => {
      renderPage();
      expect(screen.queryByText(/backend unavailable/i)).not.toBeInTheDocument();
    });
  });

  describe('policy table details', () => {
    it('renders a default badge for default policies', () => {
      useRetentionPolicies.mockReturnValue({
        data: [{ ...basePolicy, isDefault: true }],
        mode: 'mock',
        reload: vi.fn(),
      });
      renderPage();
      expect(screen.getByText('default')).toBeInTheDocument();
    });

    it('renders an em dash for missing description', () => {
      useRetentionPolicies.mockReturnValue({
        data: [{ ...basePolicy, description: undefined }],
        mode: 'mock',
        reload: vi.fn(),
      });
      renderPage();
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('falls back to the raw category key for unknown categories', () => {
      useRetentionPolicies.mockReturnValue({
        data: [{ ...basePolicy, dataCategory: 'UNKNOWN_CATEGORY' }],
        mode: 'mock',
        reload: vi.fn(),
      });
      renderPage();
      expect(screen.getByText('UNKNOWN_CATEGORY')).toBeInTheDocument();
    });

    it('renders the stylized ANONYMIZE action badge', () => {
      useRetentionPolicies.mockReturnValue({
        data: [{ ...basePolicy, action: 'ANONYMIZE' as const }],
        mode: 'mock',
        reload: vi.fn(),
      });
      renderPage();
      expect(screen.getByText('ANONYMIZE')).toBeInTheDocument();
    });

    it('renders the retention years label', () => {
      useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
      renderPage();
      expect(screen.getByText('2 years')).toBeInTheDocument();
    });
  });

  describe('edit dialog prefill and save', () => {
    it('opens the form prefilled with the default CANDIDATE_RESUMES template', async () => {
      useRetentionPolicies.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
      upsertRetentionPolicy.mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /edit policy/i }));
      // The "Edit policy" button seeds the form with CANDIDATE_RESUMES / 2y / ANONYMIZE.
      expect(await screen.findByText('Candidate resumes')).toBeInTheDocument();
      expect(screen.getByDisplayValue('2')).toBeInTheDocument();
      expect(screen.getByText('Anonymize')).toBeInTheDocument();
    });

    it('prefills years/action/description when a matching category is selected', async () => {
      useRetentionPolicies.mockReturnValue({
        data: [
          {
            ...basePolicy,
            id: 'p-2',
            dataCategory: 'AUDIT_LOGS',
            retentionYears: 7,
            action: 'HARD_DELETE',
            description: 'Keep audit trail',
          },
        ],
        mode: 'mock',
        reload: vi.fn(),
      });
      upsertRetentionPolicy.mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /edit policy/i }));
      // Select the Audit logs category; it matches an existing policy so it prefills.
      await user.click(await screen.findByRole('button', { name: 'Audit logs' }));
      expect(await screen.findByDisplayValue('7')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Keep audit trail')).toBeInTheDocument();
      expect(screen.getByText('Hard delete')).toBeInTheDocument();
    });

    it('submits the form payload including the selected category and description', async () => {
      useRetentionPolicies.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
      upsertRetentionPolicy.mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /edit policy/i }));
      const desc = await screen.findByPlaceholderText(/optional note/i);
      await user.type(desc, 'Retain for legal hold');
      await user.click(screen.getByRole('button', { name: /save policy/i }));
      expect(upsertRetentionPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          dataCategory: 'CANDIDATE_RESUMES',
          retentionYears: 2,
          action: 'ANONYMIZE',
          description: 'Retain for legal hold',
        }),
      );
      // No existing target, so id is not part of the payload.
      expect(upsertRetentionPolicy).toHaveBeenCalledWith(
        expect.not.objectContaining({ id: expect.anything() }),
      );
    });

    it('changes the action to HARD_DELETE via the action select', async () => {
      useRetentionPolicies.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
      upsertRetentionPolicy.mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /edit policy/i }));
      // Default action is Anonymize; pick Hard delete instead.
      await user.click(await screen.findByText('Hard delete'));
      await user.click(screen.getByRole('button', { name: /save policy/i }));
      expect(upsertRetentionPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'HARD_DELETE' }),
      );
    });

    it('does not save when retention years is empty', async () => {
      useRetentionPolicies.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /edit policy/i }));
      const years = await screen.findByDisplayValue('2');
      await user.clear(years);
      await user.click(screen.getByRole('button', { name: /save policy/i }));
      // The save guard blocks the call when retention years is empty.
      expect(upsertRetentionPolicy).not.toHaveBeenCalled();
    });

    it('cancels the dialog without saving', async () => {
      useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /edit policy/i }));
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(upsertRetentionPolicy).not.toHaveBeenCalled();
    });

    it('handles non-Error reject values when saving', async () => {
      useRetentionPolicies.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
      upsertRetentionPolicy.mockRejectedValue('boom');
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /edit policy/i }));
      await user.click(screen.getByRole('button', { name: /save policy/i }));
      expect(await screen.findByText('Failed to save policy.')).toBeInTheDocument();
    });
  });

  describe('purge dialog', () => {
    it('shows the danger warning only when dry run is off', async () => {
      useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
      runRetentionPurge.mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /dry run purge/i }));
      expect(screen.queryByText(/this cannot be undone/i)).not.toBeInTheDocument();
      const checkbox = await screen.findByLabelText(/dry run/i);
      await user.click(checkbox);
      expect(await screen.findByText(/this cannot be undone/i)).toBeInTheDocument();
    });

    it('executes a real purge when dry run is toggled off', async () => {
      useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
      runRetentionPurge.mockResolvedValue(undefined);
      const reload = vi.fn();
      useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /dry run purge/i }));
      await user.click(await screen.findByLabelText(/dry run/i));
      await user.click(await screen.findByRole('button', { name: /execute purge/i }));
      expect(runRetentionPurge).toHaveBeenCalledWith(false);
      expect(await screen.findByText('Purge completed.')).toBeInTheDocument();
      expect(reload).toHaveBeenCalled();
    });

    it('handles non-Error reject values when purging', async () => {
      useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
      runRetentionPurge.mockRejectedValue('nope');
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /dry run purge/i }));
      await user.click(await screen.findByRole('button', { name: /run dry run/i }));
      expect(await screen.findByText('Purge failed.')).toBeInTheDocument();
    });

    it('cancels the purge dialog without running', async () => {
      useRetentionPolicies.mockReturnValue({ data: [basePolicy], mode: 'mock', reload: vi.fn() });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /dry run purge/i }));
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(runRetentionPurge).not.toHaveBeenCalled();
    });
  });
});
