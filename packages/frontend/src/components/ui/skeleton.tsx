import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A soft shimmer placeholder used to indicate loading content. Use it to
 * reserve space for data that is still being fetched, preventing layout shift.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-ink-100', className)}
      {...props}
    />
  );
}

export { Skeleton };
