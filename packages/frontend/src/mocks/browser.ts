/**
 * MSW browser worker setup.
 *
 * Starts the service worker that intercepts requests in mock mode. Only loaded
 * and started when mock mode is enabled (see `main.tsx`).
 */
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

/** Starts the worker and waits until it is ready. */
export async function startMockWorker(): Promise<void> {
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
}
