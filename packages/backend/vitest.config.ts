import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sharedTestOptions } from '@peoplevate/vitest-config';

export default defineConfig({
  resolve: {
    alias: {
      // Match the `#prisma` import alias declared in package.json so tests resolve
      // to the generated Prisma client the same way the app does.
      '#prisma': fileURLToPath(new URL('./src/generated/prisma/client.ts', import.meta.url)),
    },
  },
  test: {
    // Backend tests exercise Node.js APIs (Express routes, services, utils),
    // so the plain `node` environment is the correct choice.
    environment: 'node',
    // Load test-only env before any module (e.g. src/config/env.ts) is imported.
    envFile: './.env.test',
    setupFiles: ['./src/test/setup.ts'],
    // Co-locate test files next to the source they exercise. Tests import
    // vitest APIs explicitly rather than relying on global injection.
    include: ['src/**/*.{test,spec}.ts'],
    // Integration tests need a real Postgres (`peoplevate_test`) and run via
    // `test:integration` with a dedicated config, so exclude them from the
    // fast, hermetic unit suite.
    exclude: ['src/test/integration/**', 'src/**/*.integration.test.ts'],
    // Shared retry/timeout and coverage provider/reporter conventions.
    ...sharedTestOptions,
    coverage: {
      // Provider/reporter come from the shared config.
      ...sharedTestOptions.coverage,
      reportsDirectory: './coverage',
      // Coverage gates the whole source tree. Thresholds reflect the current
      // whole-tree baseline (~90% stmts / 91% lines / 78% branches / 97% funcs,
      // see the last coverage report) with a safety margin so CI stays green.
      // Raise them as coverage grows — do NOT shrink the include list to game
      // the percentage.
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/generated/**', 'src/**/*.{test,spec}.ts', 'src/test/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
