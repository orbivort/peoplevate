import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Styled native `<select>` — used where cascading options and Testing Library
 * friendliness matter more than the Radix popover (e.g. project → task).
 * Carries the same visual language as `SelectTrigger`.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 transition-colors',
        'focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-500/20 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { NativeSelect };
