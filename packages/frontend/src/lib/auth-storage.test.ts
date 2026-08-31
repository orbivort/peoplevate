import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authStorage } from '@/lib/auth-storage';

describe('auth-storage (in-memory session)', () => {
  // localStorage must never be touched by the session store: tokens kept in
  // localStorage are readable by any XSS payload (CodeQL alert #12).
  const lsMock = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };

  beforeEach(() => {
    authStorage.clear();
    vi.stubGlobal('localStorage', lsMock);
    lsMock.getItem.mockClear();
    lsMock.setItem.mockClear();
    lsMock.removeItem.mockClear();
  });

  it('stores a session in memory', () => {
    authStorage.setSession('a', { email: 'e@x.com' });
    expect(authStorage.getAccessToken()).toBe('a');
    expect(authStorage.getSessionUser<{ email: string }>()?.email).toBe('e@x.com');
  });

  it('never persists anything to localStorage', () => {
    authStorage.setSession('a', { email: 'e@x.com' });
    authStorage.getAccessToken();
    authStorage.getSessionUser();
    authStorage.clear();
    expect(lsMock.setItem).not.toHaveBeenCalled();
    expect(lsMock.removeItem).not.toHaveBeenCalled();
    expect(lsMock.getItem).not.toHaveBeenCalled();
  });

  it('returns null when nothing is stored', () => {
    expect(authStorage.getAccessToken()).toBeNull();
    expect(authStorage.getSessionUser()).toBeNull();
  });

  it('clears the session', () => {
    authStorage.setSession('a', { email: 'e@x.com' });
    authStorage.clear();
    expect(authStorage.getAccessToken()).toBeNull();
    expect(authStorage.getSessionUser()).toBeNull();
  });

  it('replaces a previous session on setSession', () => {
    authStorage.setSession('old', { email: 'old@x.com' });
    authStorage.setSession('new', { email: 'new@x.com' });
    expect(authStorage.getAccessToken()).toBe('new');
    expect(authStorage.getSessionUser<{ email: string }>()?.email).toBe('new@x.com');
  });
});
