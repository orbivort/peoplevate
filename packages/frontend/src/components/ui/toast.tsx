import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error';

export interface ToastState {
  type: ToastType;
  message: string;
}

/**
 * Lightweight toast hook mirroring the fixed-position toast pattern already
 * used across the app (see profile/settings pages), extracted for reuse.
 *
 * Renders nothing until `showToast` is called; the returned `toastElement`
 * should be placed once near the page root.
 */
export function useToast(durationMs = 4000) {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), durationMs);
    return () => clearTimeout(timer);
  }, [toast, durationMs]);

  const showToast = useCallback((type: ToastType, message: string) => {
    setToast({ type, message });
  }, []);

  const toastElement = toast ? (
    <div
      role="status"
      className={cn(
        'fixed top-20 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg',
        toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
      )}
    >
      {toast.message}
    </div>
  ) : null;

  return { showToast, toastElement };
}
