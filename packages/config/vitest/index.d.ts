import type { UserConfig } from 'vitest/config';

/**
 * Shared Vitest `test` options for the peoplevate monorepo.
 *
 * Centralises the conventions that every package should follow so they cannot
 * silently drift apart: CI-only retry, a generous default timeout, and a
 * consistent v8 coverage provider and reporter set.
 *
 * Package-specific concerns (environment, envFile, setupFiles, include, and
 * coverage include/exclude/thresholds) are left to each package's
 * `vitest.config.ts` — this export only carries the shared defaults.
 */
export declare const sharedTestOptions: Partial<UserConfig['test']>;
