import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

import { ProtectedRoute } from './protected-route';

const useAuth = vi.fn();
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => useAuth() }));

function renderRoute(roles?: string[]) {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route element={<ProtectedRoute roles={roles as never} />}>
          <Route path="/app" element={<div>secret content</div>} />
        </Route>
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => cleanup());

  it('shows loading state while isLoading', () => {
    useAuth.mockReturnValue({ isLoading: true, isAuthenticated: false, user: null });
    renderRoute();
    expect(screen.getByText(/Loading workspace/i)).toBeInTheDocument();
  });

  it('redirects to login when unauthenticated', () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, user: null });
    renderRoute();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders outlet when authenticated', () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      user: { role: 'Admin' },
    });
    renderRoute();
    expect(screen.getByText('secret content')).toBeInTheDocument();
  });

  it('does NOT render protected content when role not permitted', () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      user: { role: 'Employee' },
    });
    renderRoute(['Admin']);
    // Employee is not in roles => redirect, secret content never renders.
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });
});
