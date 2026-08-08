import { expect, test } from '@playwright/test';
import { loginThroughUI } from './fixtures/auth.js';
import { getAs } from './fixtures/api.js';

/**
 * Critical journey #2 — Requisition lifecycle (flagship cross-module state machine).
 *
 * An HR manager signs in and drives a job requisition through the full pipeline
 * in the REAL browser: Draft → Pending Approval → Approved → Published. This
 * exercises the browser → Vite proxy → backend → DB path, the 5-stage state
 * machine, and the UI reflection of each transition. The auto-created internal
 * job posting is asserted via the API to confirm the backend side-effect.
 */
test.describe('Recruitment: requisition lifecycle', () => {
  test('an HR manager creates a requisition and advances it to Published', async ({
    page,
    request,
  }) => {
    await loginThroughUI(page, 'hr');
    await page
      .getByRole('link', { name: /Recruitment/i })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: /Recruitment/i })).toBeVisible();

    const title = `E2E Backend Engineer ${Date.now()}`;

    // Open the create dialog and fill it.
    await page.getByRole('button', { name: /New requisition/i }).click();
    await page.getByLabel('Title *').fill(title);
    // Radix Select: click the Department trigger then the Engineering option.
    await page.getByText('Select department').click();
    await page.getByRole('option', { name: /Engineering/i }).click();
    await page.getByText('Select position').click();
    await page.getByRole('option', { name: /Software Developer/i }).click();
    // Headcount defaults to 1 — leave it. Submit creates a DRAFT.
    await page.getByRole('button', { name: /Submit for approval/i }).click();

    // The dialog closes and the new requisition appears as Draft.
    await expect(page.getByText(title)).toBeVisible();
    const draftRow = page.getByRole('row', { name: new RegExp(title) });
    await expect(draftRow.getByText('Draft')).toBeVisible();

    // Advance through the pipeline: Draft → Pending Approval → Approved → Published.
    for (const expected of ['Pending Approval', 'Approved', 'Published']) {
      await draftRow.getByRole('button', { name: /Advance/i }).click();
      await expect(draftRow.getByText(expected)).toBeVisible({ timeout: 10_000 });
    }

    // Backend side-effect: publishing auto-creates an internal job posting.
    const list = await getAs<{ requisitions: { title: string; status: string }[] }>(
      request,
      'hr',
      '/api/recruitment/requisitions',
    );
    const found = list.requisitions.find((r) => r.title === title);
    expect(found?.status).toBe('PUBLISHED');
  });
});
