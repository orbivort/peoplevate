import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 transition-colors',
        'placeholder:text-ink-400',
        'focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-500/20 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
