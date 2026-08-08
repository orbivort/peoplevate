import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright end-to-end config for Peoplevate.
 *
 * E2E tests drive a real browser against a REAL frontend + REAL backend +
 * seeded PostgreSQL database. They deliberately close the seam that unit and
 * integration tests cannot: routing/RBAC gating, token refresh, the Vite `/api`
 * proxy, and stateful cross-role workflows rendered in the browser.
 *
 * Environment (defaults match local `pnpm dev`):
 *   E2E_BASE_URL   frontend origin   default http://localhost:5173
 *   E2E_API_URL    backend origin    default http://localhost:4000
 *
 * Server lifecycle is NOT managed here. The root `test:e2e` script boots the
 * backend (against an E2E database) and the frontend first, then runs Playwright
 * against them. A single Chromium project keeps the suite small and fast — E2E
 * is a smoke layer over an already well-covered codebase, not a cross-browser
 * matrix.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

// When E2E_BROWSER_CHANNEL is set (e.g. "chrome" or "msedge"), Playwright drives
// a system-installed browser instead of its own managed Chromium build. This lets
// local runs skip `playwright install` entirely. Leave unset on CI to keep using
// the bundled Chrome for Testing build for reproducibility.
const browserChannel = process.env.E2E_BROWSER_CHANNEL;

export default defineConfig({
  testDir: './tests',
  // One worker + serial execution avoids cross-spec interference on the shared
  // E2E database and keeps critical-journey ordering predictable.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // When a system browser channel is selected, Playwright drives the
        // installed Chrome/Edge directly and must NOT use its bundled
        // headless-shell executable (which is only shipped with `playwright install`).
        ...(browserChannel
          ? { channel: browserChannel, launchOptions: { channel: browserChannel } }
          : {}),
      },
    },
  ],
});
