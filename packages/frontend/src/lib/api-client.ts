import { config } from './config';
import { authStorage } from './auth-storage';

/**
 * Thrown when the backend responds with an error (4xx/5xx).
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** If true, body is JSON-encoded. Defaults to true for non-GET requests. */
  json?: boolean;
  body?: unknown;
  /** Set to false to skip attaching the Authorization header. */
  auth?: boolean;
}

/**
 * Called once a session can no longer be refreshed (e.g. the access token is
 * expired AND the refresh token is invalid/expired). The auth layer registers
 * this so it can clear the session and redirect the user to the login page.
 */
let onSessionExpired: (() => void) | null = null;
export function registerSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/**
 * Minimal fetch wrapper for the backend API.
 *
 * - Prefixes every URL with `config.apiBase` (same-origin '' in dev; the Vite
 *   dev proxy rewrites '/api' to the backend).
 * - Attaches `Authorization: Bearer <accessToken>` when an access token exists.
 * - JSON-encodes/decodes payloads and normalizes errors into {@link ApiError}.
 */
/**
 * Perform a single request with automatic access-token refresh.
 *
 * On a 401 response, we try to refresh the access token once (using the stored
 * refresh token) and then retry the original request with the new token. If the
 * refresh fails (the refresh token is invalid/expired), we invoke the session
 * expired handler so the auth layer can sign the user out and redirect to login.
 *
 * The refresh call itself (`auth: false`) is excluded from this logic to avoid
 * infinite recursion.
 */
async function requestWithRetry<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json = true, body, auth = true, headers, ...rest } = options;

  const buildFetch = (): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    const accessToken = auth ? authStorage.getAccessToken() : null;
    if (accessToken) {
      requestHeaders.set('Authorization', `Bearer ${accessToken}`);
    }

    let requestBody: BodyInit | undefined;
    if (body !== undefined) {
      if (json) {
        requestHeaders.set('Content-Type', 'application/json');
        requestBody = JSON.stringify(body);
      } else {
        requestBody = body as BodyInit;
      }
    }

    return fetch(`${config.apiBase}${path}`, {
      ...rest,
      headers: requestHeaders,
      body: requestBody ?? null,
    });
  };

  let res: Response;
  try {
    res = await buildFetch();
  } catch {
    throw new ApiError(0, 'Unable to reach the server. Is the backend running?');
  }

  // A 401 from a non-auth request (e.g. login) means the credentials
  // themselves are rejected — do not attempt to refresh in that case.
  if (res.status === 401 && auth) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      // Retry the original request once with the new access token.
      try {
        res = await buildFetch();
      } catch {
        throw new ApiError(0, 'Unable to reach the server. Is the backend running?');
      }
    } else {
      // Refresh failed — the session can no longer be restored.
      onSessionExpired?.();
      throw await toApiError(res);
    }
  }

  if (res.status === 204) return undefined as T;

  const data = await parseBody(res);
  if (!res.ok) {
    throw await toApiError(res, data);
  }

  return data as T;
}

/** Attempt to refresh the access token using the stored refresh token. */
async function tryRefresh(): Promise<boolean> {
  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${config.apiBase}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      authStorage.clear();
      return false;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string; user: unknown };
    authStorage.setSession(
      data.accessToken,
      data.refreshToken,
      data.user ?? authStorage.getStoredUser(),
    );
    return true;
  } catch {
    return false;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function toApiError(res: Response, parsed?: unknown): Promise<ApiError> {
  const data = parsed ?? (await parseBody(res).catch(() => null));
  const message =
    (data && typeof data === 'object' && 'error' in (data as object)
      ? String((data as { error: unknown }).error)
      : res.statusText) || `Request failed (${res.status})`;
  return new ApiError(res.status, message);
}

/** @internal convenience entrypoint for {@link requestWithRetry}. */
export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  return requestWithRetry<T>(path, options);
}

/** Convenience helpers */
export const api = {
  get: <T = unknown>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  del: <T = unknown>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
