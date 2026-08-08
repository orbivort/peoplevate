import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sharedTestOptions } from '@peoplevate/vitest-config';

export default defineConfig({
  resolve: {
    alias: {
      // Match the `#prisma` import alias declared in package.json.
      '#prisma': fileURLToPath(new URL('./src/generated/prisma/client.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Load the test env so the config/global-setup resolve the default local
    // DATABASE_URL and test secrets. Workers still get DATABASE_URL from the
    // per-worker setup (see src/test/integration/setup.ts), which reads the URL
    // resolved by global-setup (or INTEGRATION_DATABASE_URL).
    envFile: './.env.test',
    globalSetup: ['./src/test/integration/global-setup.ts'],
    setupFiles: ['./src/test/integration/setup.ts'],
    include: ['src/test/integration/**/*.integration.test.ts'],
    // A single local Postgres database is shared across the suite, so files must
    // not run in parallel workers against the same schema. `fileParallelism:
    // false` runs them serially; tests also reset the DB between cases.
    fileParallelism: false,
    ...sharedTestOptions,
  },
});
