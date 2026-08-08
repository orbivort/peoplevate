/**
 * MSW browser worker setup.
 *
 * Starts the service worker that intercepts requests in mock mode. Only loaded
 * and started when mock mode is enabled (see `main.tsx`).
 */
import { setupWorker } from 'msw/browser';
import { config } from '@/lib/config';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

/**
 * Resolves the service worker script URL relative to the deployment base.
 *
 * MSW defaults to an absolute root path (`/mockServiceWorker.js`), which works
 * on the dev server but breaks on GitHub Pages project sites, where the app is
 * served under a subpath (`https://<owner>.github.io/<repo>/`). Registering the
 * worker at the root path there 404s, so MSW never intercepts requests and API
 * calls fall through to GitHub Pages, which rejects POSTs with 405. Prefixing
 * with `config.basePath` keeps the worker scoped correctly in both cases.
 */
function mockWorkerUrl(): string {
  const { basePath } = config;
  return basePath === '/'
    ? '/mockServiceWorker.js'
    : `${basePath}/mockServiceWorker.js`;
}

/** Starts the worker and waits until it is ready. */
export async function startMockWorker(): Promise<void> {
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: mockWorkerUrl() },
  });
}
