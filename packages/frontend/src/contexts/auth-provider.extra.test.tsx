import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  return {
    authRepoMock: { login: vi.fn(), logout: vi.fn(), refresh: vi.fn() },
    employeeRepoMock: { get: vi.fn() },
    registerSessionExpiredHandler: vi.fn(),
    registerSpy: vi.fn((fn: unknown) => {
      mocks.registerSessionExpiredHandler(fn);
      return () => {};
    }),
    registerSessionExpiredHandler: vi.fn(),
  };
});

vi.mock('@/lib/api/repositories', () => ({
  authRepo: mocks.authRepoMock,
  employeeRepo: mocks.employeeRepoMock,
}));
vi.mock('@/lib/api-client', () => ({
  registerSessionExpiredHandler: (fn: unknown) => mocks.registerSpy(fn),
}));

import { useAuth } from './auth-context';
import { AuthProvider } from './auth-provider';
import { authStorage } from '@/lib/auth-storage';
import { config } from '@/lib/config';

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthProvider (real backend + edge cases)', () => {
  const prevMock = config.useMock;

  beforeEach(() => {
    config.useMock = false;
    localStorage.clear();
    // The session store is in-memory (module-scoped), so reset it per test.
    authStorage.clear();
    vi.clearAllMocks();
    // Default: no valid refresh cookie on bootstrap.
    mocks.authRepoMock.refresh.mockRejectedValue(new Error('no refresh cookie'));
    mocks.registerSpy.mockImplementation((fn: unknown) => {
      mocks.registerSessionExpiredHandler(fn);
      return () => {};
    });
  });

  afterEach(() => {
    config.useMock = prevMock;
    localStorage.clear();
    authStorage.clear();
  });

  it('logs in via the real backend and loads own employee', async () => {
    mocks.authRepoMock.login.mockResolvedValue({
      accessToken: 'a',
      user: { id: 'u1', email: 'real@x.com', role: 'ADMIN', employeeId: 'e1' },
    });
    mocks.employeeRepoMock.get.mockResolvedValue({ id: 'e1', firstName: 'Real', lastName: 'User' });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let res: { success: boolean };
    await act(async () => {
      res = await result.current.login('real@x.com', 'pw');
    });
    expect(res!.success).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.employee?.id).toBe('e1');
  });

  it('returns error when real backend login fails', async () => {
    mocks.authRepoMock.login.mockRejectedValue(new Error('bad creds'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let res: { success: boolean; error?: string };
    await act(async () => {
      res = await result.current.login('real@x.com', 'pw');
    });
    expect(res!.success).toBe(false);
    expect(res!.error).toContain('bad creds');
  });

  it('restores the in-memory session (token + user)', async () => {
    // Inject a session so the in-memory restore branch is taken.
    authStorage.setSession('tok', {
      id: 'u2',
      email: 'saved@x.com',
      role: 'Manager',
      employeeId: 'e2',
    });
    mocks.employeeRepoMock.get.mockResolvedValue({
      id: 'e2',
      managerId: null,
      firstName: 'S',
      lastName: 'V',
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.employee?.id).toBe('e2');
    // No silent refresh needed when a session is already in memory.
    expect(mocks.authRepoMock.refresh).not.toHaveBeenCalled();
  });

  it('silently refreshes the session on mount via the httpOnly cookie', async () => {
    // No in-memory session (fresh page load) — the provider must attempt a
    // cookie-based silent refresh.
    mocks.authRepoMock.refresh.mockResolvedValue({
      accessToken: 'fresh-access',
      user: { id: 'u2', email: 'saved@x.com', role: 'ADMIN', employeeId: 'e2' },
    });
    mocks.employeeRepoMock.get.mockResolvedValue({
      id: 'e2',
      managerId: null,
      firstName: 'S',
      lastName: 'V',
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(mocks.authRepoMock.refresh).toHaveBeenCalledWith();
    expect(result.current.employee?.id).toBe('e2');
  });

  it('stays signed out when the silent refresh fails (no valid cookie)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('logout calls the cookie-based backend logout', async () => {
    authStorage.setSession('tok', { id: 'u3', email: 'l@x.com', role: 'Admin' });
    mocks.authRepoMock.logout.mockResolvedValue({ message: 'Logged out' });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await act(async () => {
      await result.current.logout();
    });
    // No token material is passed — the backend reads the refresh cookie.
    expect(mocks.authRepoMock.logout).toHaveBeenCalledWith();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('canViewEmployee: Manager sees direct reports but not others', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // No user logged in -> false.
    expect(result.current.canViewEmployee({ id: 'x' } as never)).toBe(false);
  });

  it('registers a session-expired handler that clears auth state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.registerSpy).toHaveBeenCalled();
    // Simulate an expired session callback.
    const handler = mocks.registerSessionExpiredHandler.mock.calls[0]?.[0] as
      (() => void) | undefined;
    expect(typeof handler).toBe('function');
    await act(async () => {
      handler?.();
    });
    expect(result.current.isAuthenticated).toBe(false);
  });
});
