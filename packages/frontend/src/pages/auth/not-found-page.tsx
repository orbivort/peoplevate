import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="bg-dots flex min-h-screen flex-col items-center justify-center gap-6 bg-ink-50 p-6 text-center">
      <div>
        <p className="font-display text-7xl font-semibold tracking-tight text-ink-900">404</p>
        <p className="mt-2 text-sm text-ink-500">The page you are looking for does not exist.</p>
      </div>
      <Button asChild>
        <Link to="/app">Back to dashboard</Link>
      </Button>
    </div>
  );
}
