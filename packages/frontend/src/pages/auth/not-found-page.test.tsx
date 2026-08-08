import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Hoisted mutable mocks
const navigateMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

import { NotFoundPage } from './not-found-page';

beforeEach(() => {
  useAuthMock.mockReturnValue({
    user: { id: 'u1', role: 'admin', name: 'Admin User' },
    employee: { id: 'e1', firstName: 'Admin', lastName: 'User' },
    hasPermission: vi.fn(() => true),
    canViewEmployee: vi.fn(() => true),
  });
  navigateMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotFoundPage', () => {
  it('renders the 404 status code', () => {
    render(<NotFoundPage />);
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('renders a descriptive message for the missing route', () => {
    render(<NotFoundPage />);
    expect(screen.getByText(/the page you are looking for does not exist/i)).toBeInTheDocument();
  });

  it('renders a link back to the dashboard', () => {
    render(<NotFoundPage />);
    const homeLink = screen.getByRole('link', { name: /back to dashboard/i });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/app');
  });

  it('links to /app via an anchor element', () => {
    render(<NotFoundPage />);
    const homeLink = screen.getByRole('link', { name: /back to dashboard/i });
    expect(homeLink.tagName).toBe('A');
    expect(homeLink).toHaveAttribute('href', '/app');
  });

  it('does not crash when auth context provides a minimal user', () => {
    useAuthMock.mockReturnValue({
      user: null,
      employee: null,
      hasPermission: vi.fn(() => false),
      canViewEmployee: vi.fn(() => false),
    });
    render(<NotFoundPage />);
    expect(screen.getByText('404')).toBeInTheDocument();
  });
});
