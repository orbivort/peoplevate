import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

import { FirstTimeSetupPage } from './first-time-setup-page';

beforeEach(() => {
  useAuthMock.mockReturnValue({
    user: null,
    employee: null,
    hasPermission: vi.fn(() => false),
    canViewEmployee: vi.fn(() => false),
  });
  navigateMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('FirstTimeSetupPage', () => {
  it('renders the setup heading and the two password fields', () => {
    render(<FirstTimeSetupPage />);
    expect(screen.getByRole('heading', { name: /set your password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activate account/i })).toBeInTheDocument();
  });

  it('shows the live password policy checklist', () => {
    render(<FirstTimeSetupPage />);
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/one uppercase letter/i)).toBeInTheDocument();
    expect(screen.getByText(/one special character/i)).toBeInTheDocument();
  });

  it('highlights a satisfied rule as the user types a strong password', async () => {
    const user = userEvent.setup();
    render(<FirstTimeSetupPage />);
    await user.type(screen.getByLabelText(/new password/i), 'Abcdef1!');
    // The "At least 8 characters" rule satisfied -> row turns accent colored.
    expect(screen.getByText(/at least 8 characters/i).closest('li')).toHaveClass('text-accent-700');
  });

  it('shows a validation error when the password is too weak on submit', async () => {
    const user = userEvent.setup();
    render(<FirstTimeSetupPage />);
    await user.type(screen.getByLabelText(/new password/i), 'weak');
    await user.type(screen.getByLabelText(/confirm password/i), 'weak');
    await user.click(screen.getByRole('button', { name: /activate account/i }));
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows a mismatch error when passwords differ', async () => {
    const user = userEvent.setup();
    render(<FirstTimeSetupPage />);
    await user.type(screen.getByLabelText(/new password/i), 'Passw0rd!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Different1!');
    await user.click(screen.getByRole('button', { name: /activate account/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('submits valid data and navigates to the login page after the delay', async () => {
    const user = userEvent.setup();
    render(<FirstTimeSetupPage />);
    await user.type(screen.getByLabelText(/new password/i), 'Passw0rd!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Passw0rd!');
    await user.click(screen.getByRole('button', { name: /activate account/i }));

    // The submit handler awaits an 800ms delay before navigating.
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/login'), {
      timeout: 2000,
    });
  });

  it('shows a "Sign in" link back to the login page', () => {
    render(<FirstTimeSetupPage />);
    const signIn = screen.getByRole('link', { name: /sign in/i });
    expect(signIn).toBeInTheDocument();
    expect(signIn).toHaveAttribute('href', '/login');
  });
});
