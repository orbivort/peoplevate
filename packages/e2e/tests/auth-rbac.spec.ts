import { expect, test } from '@playwright/test';
import { loginThroughUI } from './fixtures/auth.js';

/**
 * Critical journey #1 — Auth & RBAC seam.
 *
 * This is the class of defect unit and integration tests cannot catch: each side
 * passes in isolation (frontend route guards, backend rbac middleware) but the
 * browser + proxy + token flow can break. These specs assert the REAL login form
 * works, unauthenticated users are redirected, and role-based navigation is
 * honored in the browser.
 */
test.describe('Auth & RBAC seam', () => {
  test('redirects unauthenticated visitors to the login page', async ({ page }) => {
    await page.goto('/app/employees');
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^Sign in$/ })).toBeVisible();
  });

  test('an HR manager can sign in and reach the dashboard', async ({ page }) => {
    await loginThroughUI(page, 'hr');
    // Authenticated shell (sidebar) renders on the dashboard.
    await expect(page.locator('aside')).toBeVisible();
  });

  test('an employee does NOT see HR-only navigation items', async ({ page }) => {
    await loginThroughUI(page, 'employee');
    // HR/Admin-only nav must be hidden for an employee.
    await expect(page.getByText('Departments')).toHaveCount(0);
    await expect(page.getByText('User Management')).toHaveCount(0);
    await expect(page.getByText('Audit Log')).toHaveCount(0);
    // Always-visible nav is present.
    await expect(page.getByText('Employees').first()).toBeVisible();
    await expect(page.getByText('Attendance & Leave').first()).toBeVisible();
  });

  test('an employee is redirected away from an Admin-only route', async ({ page }) => {
    await loginThroughUI(page, 'employee');
    // /app/users is Admin-only. The ProtectedRoute redirects non-admins to /app.
    await page.goto('/app/users');
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
  });

  test('an admin can reach the user management route', async ({ page }) => {
    await loginThroughUI(page, 'admin');
    await page.goto('/app/users');
    await expect(page.getByRole('heading', { name: /User Management/i })).toBeVisible();
  });
});
