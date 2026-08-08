import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from '@/components/error-boundary';
import { AppRouter } from '@/router';
import { config } from '@/lib/config';
import '@/index.css';

async function bootstrap() {
  // In mock mode, start the MSW service worker so HTTP requests are intercepted
  // at the network layer and answered from the in-memory mock store.
  // Gating on `config.useMock` (a build-time constant resolved from
  // `VITE_USE_MOCK`) instead of `import.meta.env.DEV` lets mock mode also run in
  // a static production build (e.g. the GitHub Pages demo, which has no
  // backend). When `VITE_USE_MOCK` is unset/false, the branch is dead code and
  // Vite still tree-shakes the mock chunk (and its demo credentials) from the
  // production bundle.
  if (config.useMock) {
    try {
      const { startMockWorker } = await import('@/mocks/browser');
      await startMockWorker();
    } catch (err) {
      // Never let a worker failure blank the page. Log it and continue so the
      // app still renders (requests will pass through unhandled).
      console.error('[mock] Failed to start MSW worker:', err);
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <AppRouter />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrap();
