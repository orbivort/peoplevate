import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useAuth } from './auth-context';
import { AuthProvider } from './auth-provider';
import { permissionMatrix } from '@/data/mock-data';
import { config } from '@/lib/config';

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('useAuth', () => {
  const prevMock = config.useMock;
  beforeEach(() => {
    config.useMock = true;
    localStorage.clear();
  });
  afterEach(() => {
    config.useMock = prevMock;
    localStorage.clear();
  });

  it('throws when used outside provider', () => {
    // Silence the expected React error log.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider',
    );
    spy.mockRestore();
  });

  it('starts unauthenticated and can login as admin in mock mode', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);

    let res: { success: boolean; error?: string };
    await act(async () => {
      res = await result.current.login('admin@example.com', 'Admin@12345!');
    });
    expect(res!.success).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.role).toBe('Admin');
  });

  it('rejects wrong password', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let res: { success: boolean; error?: string };
    await act(async () => {
      res = await result.current.login('admin@example.com', 'wrong');
    });
    expect(res!.success).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('rejects unknown account', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let res: { success: boolean; error?: string };
    await act(async () => {
      res = await result.current.login('nobody@peoplevate.com', 'whatever');
    });
    expect(res!.success).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('logout clears session', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.login('admin@example.com', 'Admin@12345!');
    });
    expect(result.current.isAuthenticated).toBe(true);
    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem('elms-auth-user')).toBeNull();
  });

  it('hasPermission reflects role matrix', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission('manageUsers')).toBe(false); // not logged in
    await act(async () => {
      await result.current.login('admin@example.com', 'Admin@12345!');
    });
    expect(result.current.hasPermission('manageUsers')).toBe(permissionMatrix['Admin'].manageUsers);
  });

  it('canViewEmployee: admin sees everyone, employee sees self only', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.login('employee@example.com', 'Employee@12345!');
    });
    expect(result.current.canViewEmployee({ id: 'e-006' } as never)).toBe(true); // self
    expect(result.current.canViewEmployee({ id: '999' } as never)).toBe(false);
  });
});
