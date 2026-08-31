import { expect, type APIRequestContext } from '@playwright/test';
import { ACCOUNTS, type AccountKey } from './accounts.js';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

interface LoginResult {
  accessToken: string;
  // The refresh token is delivered via httpOnly cookie and is not part of the
  // JSON response body.
  user: { id: string; email: string; role: string };
}

/**
 * Logs a seeded account in through the real `/api/auth/login` endpoint and
 * returns the access token. Used for API-level seeding/arrangements that the
 * browser journey later verifies through the UI.
 */
export async function loginAs(request: APIRequestContext, key: AccountKey): Promise<LoginResult> {
  const account = ACCOUNTS[key];
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: account.email, password: account.password },
  });
  expect(res.ok(), `login as ${key} should succeed`).toBeTruthy();
  return (await res.json()) as LoginResult;
}

/** Bearer token helper for a seeded account. */
export async function tokenFor(request: APIRequestContext, key: AccountKey): Promise<string> {
  const login = await loginAs(request, key);
  return login.accessToken;
}

/** GET a JSON resource as a given role; fails the test if the request errors. */
export async function getAs<T>(
  request: APIRequestContext,
  key: AccountKey,
  path: string,
): Promise<T> {
  const token = await tokenFor(request, key);
  const res = await request.get(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `GET ${path} as ${key}`).toBeTruthy();
  return (await res.json()) as T;
}

/** POST a JSON resource as a given role; fails the test if the request errors. */
export async function postAs<T>(
  request: APIRequestContext,
  key: AccountKey,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await tokenFor(request, key);
  const res = await request.post(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  expect(res.ok(), `POST ${path} as ${key} (${res.status()})`).toBeTruthy();
  return (await res.json()) as T;
}

/** PATCH a JSON resource as a given role; fails the test if the request errors. */
export async function patchAs<T>(
  request: APIRequestContext,
  key: AccountKey,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await tokenFor(request, key);
  const res = await request.patch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  expect(res.ok(), `PATCH ${path} as ${key} (${res.status()})`).toBeTruthy();
  return (await res.json()) as T;
}
