import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('auth-storage', () => {
  const store: Record<string, string> = {};
  const lsMock = {
    getItem: vi.fn((k: string) => (k in store ? store[k] : null)),
    setItem: vi.fn((k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: vi.fn((k: string) => {
      delete store[k];
    }),
  };
  const originalLS = globalThis.localStorage;

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    vi.stubGlobal('localStorage', lsMock);
    lsMock.getItem.mockClear();
    lsMock.setItem.mockClear();
    lsMock.removeItem.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.localStorage = originalLS;
  });

  it('persists and reads a full session', async () => {
    const { authStorage } = await import('@/lib/auth-storage');
    authStorage.setSession('a', 'r', { email: 'e@x.com' });
    expect(authStorage.getAccessToken()).toBe('a');
    expect(authStorage.getRefreshToken()).toBe('r');
    expect(authStorage.getStoredUser<{ email: string }>()?.email).toBe('e@x.com');
  });

  it('returns null when nothing stored', async () => {
    const { authStorage } = await import('@/lib/auth-storage');
    expect(authStorage.getAccessToken()).toBeNull();
    expect(authStorage.getRefreshToken()).toBeNull();
    expect(authStorage.getStoredUser()).toBeNull();
  });

  it('returns null user on malformed JSON', async () => {
    const { authStorage } = await import('@/lib/auth-storage');
    lsMock.getItem.mockImplementation((k: string) => (k === 'elms-api-user' ? '{bad' : null));
    expect(authStorage.getStoredUser()).toBeNull();
  });

  it('clears the session', async () => {
    const { authStorage } = await import('@/lib/auth-storage');
    authStorage.setSession('a', 'r', { email: 'e@x.com' });
    authStorage.clear();
    expect(authStorage.getAccessToken()).toBeNull();
    expect(authStorage.getRefreshToken()).toBeNull();
    expect(authStorage.getStoredUser()).toBeNull();
  });

  it('propagates errors when getItem throws', async () => {
    const brokenLS = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', brokenLS);
    const { authStorage } = await import('@/lib/auth-storage');
    expect(() => authStorage.getAccessToken()).toThrow();
    expect(() => authStorage.getStoredUser()).toThrow();
  });
});
