import { expect, test } from '@playwright/test';
import { loginThroughUI } from './fixtures/auth.js';
import { getAs } from './fixtures/api.js';

interface AttendanceSummaryDto {
  employeeId: string;
  clockIn?: string | null;
  clockOut?: string | null;
}

interface SummaryDto {
  summaries: AttendanceSummaryDto[];
}

/**
 * Critical journey #4 — Attendance clock in/out.
 *
 * An employee clocks in and out through the real UI, and the resulting
 * AttendanceRecord is confirmed to persist in the backend (via the API) for
 * today's date. This verifies the Clock tab → attendance service → DB path and
 * the employee-scoped data access.
 */
test.describe('Attendance: clock in/out', () => {
  test('an employee can clock in and clock out, creating a record', async ({ page, request }) => {
    await loginThroughUI(page, 'employee');
    await page
      .getByRole('link', { name: /Attendance & Leave/i })
      .first()
      .click();

    // The Clock tab is active by default. Click Clock in then Clock out.
    await page.getByRole('button', { name: /Clock in/i }).click();
    await expect(page.getByText(/Clocked in at/)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /Clock out/i }).click();
    await expect(page.getByText(/Clocked out at/)).toBeVisible({ timeout: 10_000 });

    // Confirm today's attendance summary (employee-scoped) has a clock-out.
    await expect
      .poll(async () => {
        const res = await getAs<SummaryDto>(request, 'employee', '/api/attendance/summary');
        // The employee-scoped summary returns only the current user's record.
        return res.summaries.some((s) => Boolean(s.clockIn) && Boolean(s.clockOut));
      })
      .toBe(true);
  });
});
