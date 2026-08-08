import { expect, test } from '@playwright/test';
import { loginThroughUI } from './fixtures/auth.js';
import { getAs } from './fixtures/api.js';

interface OffboardingRecordDto {
  id: string;
  reason: string | null;
  status: string;
}

interface OffboardingListDto {
  records: OffboardingRecordDto[];
}

/** A proposed last working day ~40 days out (respects the 30-day notice). */
function futureDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Critical journey #5 — Offboarding initiation.
 *
 * An employee initiates their own offboarding through the real UI (self
 * resignation dialog), which creates an OffboardingRecord in INITIATED state.
 * The record + its audit trail are confirmed via the API. This closes the
 * browser → offboarding service → DB path for the start of the lifecycle.
 */
test.describe('Offboarding: self-initiation', () => {
  test('an employee submits a resignation and an offboarding record is created', async ({
    page,
    request,
  }) => {
    const reason = `E2E resignation ${Date.now()}`;
    const lwd = futureDate(40);
    const deactivation = futureDate(45);

    // 1) Employee initiates offboarding through the UI.
    await loginThroughUI(page, 'employee');
    await page
      .getByRole('link', { name: /Offboarding/i })
      .first()
      .click();

    // Open the self-resignation dialog.
    await page.getByRole('button', { name: /Submit resignation/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason for leaving *').fill(reason);
    await dialog.getByLabel('Proposed last working day *').fill(lwd);
    await dialog.getByLabel('Deactivation date *').fill(deactivation);
    await dialog.getByLabel(/I understand/).check();
    // Submit via the dialog footer button (disambiguated from the page header one).
    await dialog.getByRole('button', { name: /Submit resignation/i }).click();

    // 2) The dialog closes and the resignation is recorded.
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // 3) Confirm via the API that the record exists in INITIATED state.
    await expect
      .poll(async () => {
        const res = await getAs<OffboardingListDto>(request, 'hr', '/api/offboarding');
        return res.records.find((r) => r.reason === reason)?.status;
      })
      .toBe('INITIATED');
  });
});
