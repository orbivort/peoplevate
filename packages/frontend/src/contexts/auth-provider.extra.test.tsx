import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  return {
    authRepoMock: { login: vi.fn(), logout: vi.fn() },
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
import { config } from '@/lib/config';

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthProvider (real backend + edge cases)', () => {
  const prevMock = config.useMock;

  beforeEach(() => {
    config.useMock = false;
    localStorage.clear();
    vi.clearAllMocks();
    mocks.registerSpy.mockImplementation((fn: unknown) => {
      mocks.registerSessionExpiredHandler(fn);
      return () => {};
    });
  });

  afterEach(() => {
    config.useMock = prevMock;
    localStorage.clear();
  });

  it('logs in via the real backend and loads own employee', async () => {
    mocks.authRepoMock.login.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
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

  it('restores session from persisted real-backend tokens', async () => {
    localStorage.setItem(
      'elms-auth-user',
      JSON.stringify({ id: 'u2', email: 'saved@x.com', role: 'Manager', employeeId: 'e2' }),
    );
    // Inject a token so the restore branch is taken.
    const { authStorage } = await import('@/lib/auth-storage');
    authStorage.setSession('tok', 'rt', {
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
  });

  it('logout calls real backend logout when refresh token exists', async () => {
    const { authStorage } = await import('@/lib/auth-storage');
    authStorage.setSession('tok', 'rt', { id: 'u3', email: 'l@x.com', role: 'Admin' });
    mocks.authRepoMock.logout.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.logout();
    });
    expect(mocks.authRepoMock.logout).toHaveBeenCalledWith('rt');
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
