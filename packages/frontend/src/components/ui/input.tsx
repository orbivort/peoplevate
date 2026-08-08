import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-10 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 transition-colors duration-200',
        'placeholder:text-ink-400',
        'focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-500/20 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-danger-500 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger-500/20',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
