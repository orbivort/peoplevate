import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { sharedTestOptions } from '@peoplevate/vitest-config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Frontend tests run against React components, so a DOM-like environment is required.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Co-locate test files next to the source they exercise. Tests import
    // vitest APIs explicitly rather than relying on global injection.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    // Shared retry/timeout and coverage provider/reporter conventions.
    ...sharedTestOptions,
    coverage: {
      // Provider/reporter come from the shared config.
      ...sharedTestOptions.coverage,
      reportsDirectory: './coverage',
      // Coverage gates the whole source tree. Thresholds reflect the current
      // whole-tree baseline (~57% stmts / 59% lines / 47% branches / 51% funcs,
      // see the last coverage report) with a safety margin so CI stays green.
      // Raise them as coverage grows — do NOT shrink the include list to game
      // the percentage.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/router.tsx',
        'src/vite-env.d.ts',
        'src/types/**',
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        'src/mocks/**',
        'src/components/layout/mock-mode-banner.tsx',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
