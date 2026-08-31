/**
 * In-memory session store for the real-backend auth session.
 *
 * The access token and the signed-in user are kept only in module-scoped
 * memory — never persisted to `localStorage` — so they are unreachable by
 * XSS payloads through storage APIs (CodeQL alert #12). The session does not
 * survive a page reload; instead it is silently restored via the httpOnly
 * refresh-token cookie (see `tryRefresh` in `api-client.ts`).
 */

let accessToken: string | null = null;
let storedUser: unknown = null;

export const authStorage = {
  getAccessToken(): string | null {
    return accessToken;
  },
  getSessionUser<T>(): T | null {
    return (storedUser as T | null) ?? null;
  },
  setSession(newAccessToken: string, user: unknown): void {
    accessToken = newAccessToken;
    storedUser = user;
  },
  clear(): void {
    accessToken = null;
    storedUser = null;
  },
};
