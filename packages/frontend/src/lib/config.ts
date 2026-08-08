/**
 * Centralized runtime configuration for the frontend.
 *
 * The `VITE_USE_MOCK` flag (set in `.env.local`) controls whether the UI reads
 * from the local mock data source (`src/data/mock-data.ts`) or from the real
 * backend API.
 *
 *   - When `'true'`: mock mode is enabled. HTTP requests are intercepted at the
 *     network layer by MSW and answered from the in-memory mock store. No
 *     backend required.
 *   - Any other value (unset, `'false'`, etc.): API mode. Pages call the real
 *     backend via `VITE_API_BASE`.
 *
 * Mock mode is an explicit opt-in so developers never unknowingly see mock data.
 * This module is the single source of truth for the switch.
 */
export const config = {
  useMock: import.meta.env.VITE_USE_MOCK === 'true',
  apiBase: import.meta.env.VITE_API_BASE ?? '',
} as const;

/** True when the app is talking to the real backend (mock mode disabled). */
export function isRealBackend(): boolean {
  return !config.useMock;
}
