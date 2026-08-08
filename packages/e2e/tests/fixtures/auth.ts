import { expect, type Page } from '@playwright/test';
import { ACCOUNTS, type AccountKey } from './accounts.js';

/**
 * Signs a seeded account in through the REAL login form (`/login`), which
 * exercises the browser → Vite proxy → backend → DB path end to end, including
 * token issuance and the client-side redirect to `/app`.
 */
export async function loginThroughUI(page: Page, key: AccountKey): Promise<void> {
  const account = ACCOUNTS[key];
  await page.goto('/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  // Successful login lands on the authenticated app shell (the dashboard route is
  // /app, but the SPA may deep-link to a sub-route), so assert the URL entered the
  // /app area rather than an exact path.
  await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
  await expect(page.locator('aside')).toBeVisible();
}

/**
 * Asserts a seeded role can reach a protected route and that the shell renders.
 * Used for the auth/RBAC seam journey.
 */
export async function assertSignedInAt(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // The authenticated shell (sidebar brand) is present rather than the login page.
  await expect(page.locator('aside')).toBeVisible();
}
