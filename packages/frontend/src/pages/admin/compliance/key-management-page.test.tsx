import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

const hasPermission = vi.fn(() => true);
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ hasPermission }),
}));

const useKeyVersions = vi.fn();
const rotateKey = vi.fn();

vi.mock('@/data/data-layer', () => ({
  useKeyVersions: (...args: unknown[]) => useKeyVersions(...args),
  rotateKey: (...args: unknown[]) => rotateKey(...args),
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

import { KeyManagementPage } from './key-management-page';

const dataKey = {
  keyId: 'field-enc-v2',
  purpose: 'DATA_ENCRYPTION' as const,
  algorithm: 'AES-256-GCM' as const,
  status: 'ACTIVE' as const,
  activatedAt: '2026-01-01T00:00:00.000Z',
  retiredAt: null,
};

const tokenKey = {
  keyId: 'token-v1',
  purpose: 'TOKEN_SIGNING' as const,
  algorithm: 'HS256' as const,
  status: 'ACTIVE' as const,
  activatedAt: '2026-01-01T00:00:00.000Z',
  retiredAt: null,
};

function renderPage() {
  return render(<KeyManagementPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermission.mockReturnValue(true);
  useKeyVersions.mockReturnValue({ data: [], mode: 'mock', reload: vi.fn() });
});

describe('KeyManagementPage', () => {
  it('renders the page header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Encryption keys' })).toBeInTheDocument();
  });

  it('renders "No key versions" empty state', () => {
    renderPage();
    expect(screen.getByText('No key versions')).toBeInTheDocument();
  });

  it('shows both encryption purposes', () => {
    renderPage();
    expect(screen.getByText('Field & file encryption')).toBeInTheDocument();
    expect(screen.getByText('JWT / token signing')).toBeInTheDocument();
  });

  it('shows active key id when present', () => {
    useKeyVersions.mockReturnValue({ data: [dataKey, tokenKey], mode: 'mock', reload: vi.fn() });
    renderPage();
    expect(screen.getByText('Active: field-enc-v2')).toBeInTheDocument();
    expect(screen.getByText('Active: token-v1')).toBeInTheDocument();
  });

  it('rotates the data-encryption key', async () => {
    const reload = vi.fn();
    useKeyVersions.mockReturnValue({ data: [dataKey], mode: 'mock', reload });
    rotateKey.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    // Click the first "Rotate" button (DATA_ENCRYPTION card).
    const rotateButtons = screen.getAllByRole('button', { name: /^rotate$/i });
    await user.click(rotateButtons[0]);
    await user.click(await screen.findByRole('button', { name: /rotate key/i }));
    expect(rotateKey).toHaveBeenCalledWith('DATA_ENCRYPTION');
    expect(reload).toHaveBeenCalled();
  });

  it('shows error feedback when rotateKey rejects', async () => {
    useKeyVersions.mockReturnValue({ data: [dataKey], mode: 'mock', reload: vi.fn() });
    rotateKey.mockRejectedValue(new Error('Rotate failed'));
    const user = userEvent.setup();
    renderPage();
    const rotateButtons = screen.getAllByRole('button', { name: /^rotate$/i });
    await user.click(rotateButtons[0]);
    await user.click(await screen.findByRole('button', { name: /rotate key/i }));
    expect(await screen.findByText('Rotate failed')).toBeInTheDocument();
  });

  it('hides Rotate buttons when permission missing', () => {
    hasPermission.mockReturnValue(false);
    renderPage();
    expect(screen.queryByRole('button', { name: /^rotate$/i })).not.toBeInTheDocument();
  });
});
