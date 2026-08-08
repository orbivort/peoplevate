/**
 * Persistence helpers for the real-backend auth session.
 *
 * In real mode (VITE_USE_MOCK=false) the app stores the JWT access token,
 * the refresh token and the signed-in user in localStorage so the session
 * survives page reloads.
 */

const ACCESS_TOKEN_KEY = 'elms-access-token';
const REFRESH_TOKEN_KEY = 'elms-refresh-token';
const USER_KEY = 'elms-api-user';

export const authStorage = {
  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  getStoredUser<T>(): T | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setSession(accessToken: string, refreshToken: string, user: unknown): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};
