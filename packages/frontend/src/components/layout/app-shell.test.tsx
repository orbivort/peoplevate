import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { AppShell } from './app-shell';

const useAuth = vi.fn();

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuth(),
}));

function renderShell(user: unknown) {
  useAuth.mockReturnValue({
    user,
    employee: user ? { firstName: 'Jane', lastName: 'Doe' } : null,
    logout: vi.fn(),
    hasPermission: (cap: string) => (user ? mockPerms(user.role).includes(cap) : false),
  });
  return render(
    <MemoryRouter initialEntries={['/app/employees']}>
      <AppShell />
    </MemoryRouter>,
  );
}

function mockPerms(role: string): string[] {
  // Minimal capability sets used to exercise the sidebar filter branches.
  if (role === 'Admin')
    return [
      'manageOrg',
      'manageUsers',
      'viewAllEmployees',
      'viewAuditLog',
      'manageOffboarding',
      'manageRecruitment',
      'viewFullAuditLog',
    ];
  if (role === 'HR Manager')
    return ['manageOrg', 'manageUsers', 'viewAllEmployees', 'viewAuditLog'];
  if (role === 'Manager')
    return ['viewDirectReports', 'manageRecruitmentDept', 'viewOwnOffboarding'];
  return [];
}

describe('AppShell', () => {
  beforeEach(() => cleanup());

  it('renders nothing when no user', () => {
    const { container } = renderShell(null);
    expect(container.firstChild).toBeNull();
  });

  it('renders all nav items for Admin', () => {
    renderShell({ id: '1', role: 'Admin', email: 'admin@example.com' });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Departments')).toBeInTheDocument();
    expect(screen.getByText('Positions')).toBeInTheDocument();
    expect(screen.getByText('Audit Log')).toBeInTheDocument();
    expect(screen.getByText('Offer Letters')).toBeInTheDocument();
  });

  it('hides HR-only items for Manager', () => {
    renderShell({ id: '2', role: 'Manager', email: 'm@example.com' });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('User Management')).not.toBeInTheDocument();
    expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
  });

  it('collapses the sidebar on toggle', () => {
    renderShell({ id: '1', role: 'Admin', email: 'admin@example.com' });
    expect(screen.getByText('Collapse sidebar')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Collapse sidebar'));
    // When collapsed, the label is hidden (icon-only button).
    expect(screen.queryByText('Collapse sidebar')).not.toBeInTheDocument();
  });

  it('shows the user display name in the header', () => {
    renderShell({ id: '1', role: 'Admin', email: 'admin@example.com' });
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('displays role badge', () => {
    renderShell({ id: '1', role: 'HR Manager', email: 'hr@example.com' });
    expect(screen.getByText('HR Manager')).toBeInTheDocument();
  });

  it('renders the user dropdown trigger', () => {
    renderShell({ id: '1', role: 'Admin', email: 'admin@example.com' });
    // The dropdown trigger is the button containing the display name.
    // Radix UI dropdowns don't render content in jsdom until triggered,
    // so we verify the trigger exists — the onClick handlers are tested via
    // the route integration and the profile/settings page tests.
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });
});
