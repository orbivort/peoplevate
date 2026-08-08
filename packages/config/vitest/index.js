/**
 * Shared Vitest `test` options for the peoplevate monorepo.
 *
 * Centralises the conventions that every package should follow so they cannot
 * silently drift apart:
 *  - Retry flaky async tests once in CI only (keeps local runs fast).
 *  - A generous default timeout for Node/jsdom + Tailwind boot time.
 *  - Consistent v8 coverage provider and reporters.
 *
 * Package-specific concerns (environment, envFile, setupFiles, include, and
 * coverage include/exclude/thresholds) are deliberately left to each package's
 * `vitest.config.ts` — this file only carries the shared defaults.
 */
export const sharedTestOptions = {
  // Retry flaky async tests once in CI only.
  retry: process.env.CI ? 1 : 0,
  // jsdom + Tailwind CSS parser and Node async I/O are slow to boot; give tests
  // a generous timeout.
  testTimeout: 15000,
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov', 'html'],
  },
};
