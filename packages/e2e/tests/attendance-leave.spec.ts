import { expect, test } from '@playwright/test';
import { loginThroughUI } from './fixtures/auth.js';
import { getAs } from './fixtures/api.js';

interface LeaveRequestDto {
  id: string;
  status: string;
  reason?: string | null;
  leave_type: { id: string; name: string };
}

interface LeaveListDto {
  requests: LeaveRequestDto[];
}

/** Dates one and two days from today (the seed has no overlapping leave). */
function futureDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Critical journey #3 — Leave request submission & manager approval chain.
 *
 * An EMPLOYEE submits a personal leave request through the real UI (exercising
 * browser → proxy → backend → DB), verifies it lands in "My leave", then a
 * MANAGER approves it through the Approvals UI. The cross-role transition is
 * confirmed via the API to close the browser↔role seam.
 *
 * "Personal" leave is single-level (approval_levels: 1) so the journey is
 * deterministic and not dependent on HR's second-level step.
 */
test.describe('Attendance & Leave: request → approval chain', () => {
  test('employee submits personal leave and a manager approves it', async ({ page, request }) => {
    const reason = `E2E personal leave ${Date.now()}`;
    // A single Personal day keeps the request well within the seeded balance.
    const start = futureDate(7);
    const end = futureDate(7);

    // 1) Employee submits leave through the UI.
    await loginThroughUI(page, 'employee');
    await page
      .getByRole('link', { name: /Attendance & Leave/i })
      .first()
      .click();
    await page.getByRole('button', { name: /Request leave/i }).click();

    // Leave type defaults to Annual; switch to Personal for single-level approval.
    // Scope to the dialog so the trigger (not the balance card) is targeted.
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Annual').click();
    await page.getByRole('option', { name: /Personal/i }).click();

    await page.getByLabel('Start date *').fill(start);
    await page.getByLabel('End date *').fill(end);
    await page.getByLabel('Reason *').fill(reason);
    await page.getByRole('button', { name: /Submit request/i }).click();

    // 2) The request appears in the "My leave" tab (auto-navigated there).
    await expect(page.getByText(reason)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Pending Manager Approval')).toBeVisible();

    // 3) Confirm via the API the request persisted with a pending status.
    const employeeList = await getAs<LeaveListDto>(
      request,
      'employee',
      '/api/attendance/leave-requests',
    );
    const submitted = employeeList.requests.find((r) => r.reason === reason);
    expect(submitted).toBeTruthy();
    expect(submitted!.status).toBe('PENDING_MANAGER_APPROVAL');
    expect(submitted!.leave_type.name).toBe('Personal');

    // 4) The MANAGER approves it through the Approvals UI.
    await loginThroughUI(page, 'manager');
    await page
      .getByRole('link', { name: /Attendance & Leave/i })
      .first()
      .click();
    await page.getByRole('tab', { name: /Approvals/i }).click();

    // Locate the request row by its reason and approve it.
    const approvalCard = page.locator('div', { hasText: reason }).first();
    await approvalCard.getByRole('button', { name: /Approve/i }).click();

    // 5) Confirm via the API the request is now Approved.
    await expect
      .poll(async () => {
        const list = await getAs<LeaveListDto>(request, 'hr', '/api/attendance/leave-requests');
        return list.requests.find((r) => r.reason === reason)?.status;
      })
      .toBe('APPROVED');
  });
});
