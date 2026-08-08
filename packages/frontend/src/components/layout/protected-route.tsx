import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from '@/contexts/auth-context';
import type { Role } from '@/types';

interface ProtectedRouteProps {
  /** If provided, only these roles may access; others are redirected. */
  roles?: Role[];
}

export function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-50">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-accent-500" />
          <p className="text-sm text-ink-500">Loading workspace…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/app" replace />;
  }

  return <Outlet />;
}
