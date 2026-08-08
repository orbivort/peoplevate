import { FlaskConical } from 'lucide-react';

import { config } from '@/lib/config';

/**
 * Persistent "MOCK MODE" indicator.
 *
 * Rendered whenever the app is running in mock mode so developers always know
 * the data source. Hidden entirely in API mode.
 */
export function MockModeBanner() {
  if (!config.useMock) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-amber-800">
      <FlaskConical className="h-3.5 w-3.5" />
      MOCK MODE — data is served locally, no backend required
    </div>
  );
}
