import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginPage } from './login-page';

// --- Mocks ---

const loginMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({
    login: loginMock,
    logout: vi.fn(),
    hasPermission: vi.fn(),
    canViewEmployee: vi.fn(),
  }),
}));

vi.mock('react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => navigateMock,
}));

const emailValue = 'admin@example.com';
const passwordValue = 'Admin@12345!';

describe('LoginPage', () => {
  beforeEach(() => {
    loginMock.mockReset();
    loginMock.mockResolvedValue({ success: true });
    navigateMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form, headings and demo accounts', () => {
    render(<LoginPage />);
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText(/Sign in to your account/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sign in$/ })).toBeInTheDocument();

    // Demo account buttons are rendered.
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('HR Manager')).toBeInTheDocument();
    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.getByText('Employee')).toBeInTheDocument();
  });

  it('renders the forgot password link', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /Forgot password/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/forgot-password');
  });

  it('shows required-field validation errors when submitted empty', async () => {
    render(<LoginPage />);
    await userEvent.click(screen.getByRole('button', { name: /^Sign in$/ }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('shows format validation errors for an invalid email and short password', async () => {
    render(<LoginPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Must be at least 8 characters.')).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('navigates to /app on a successful login', async () => {
    loginMock.mockResolvedValue({ success: true });
    render(<LoginPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), emailValue);
    await user.type(screen.getByLabelText('Password'), passwordValue);
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith(emailValue, passwordValue));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/app'));
  });

  it('shows the returned server error when login fails', async () => {
    loginMock.mockResolvedValue({ success: false, error: 'Invalid credentials' });
    render(<LoginPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), emailValue);
    await user.type(screen.getByLabelText('Password'), passwordValue);
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows a generic error message when login fails without an error string', async () => {
    loginMock.mockResolvedValue({ success: false, error: undefined });
    render(<LoginPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), emailValue);
    await user.type(screen.getByLabelText('Password'), passwordValue);
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }));

    expect(await screen.findByText('Login failed.')).toBeInTheDocument();
  });

  it('displays the submitting state while login is pending', async () => {
    let resolveLogin: (v: { success: boolean }) => void = () => {};
    loginMock.mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        resolveLogin = resolve;
      }),
    );
    render(<LoginPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), emailValue);
    await user.type(screen.getByLabelText('Password'), passwordValue);
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }));

    expect(screen.getByText('Signing in…')).toBeInTheDocument();

    resolveLogin({ success: true });
    await waitFor(() => expect(screen.queryByText('Signing in…')).not.toBeInTheDocument());
  });

  it('clears a previous server error before a new submit', async () => {
    loginMock.mockResolvedValueOnce({ success: false, error: 'First failure' });
    render(<LoginPage />);

    const user = userEvent.setup();
    const emailInput = screen.getByLabelText('Email address');
    const passwordInput = screen.getByLabelText('Password');
    const submitButton = screen.getByRole('button', { name: /^Sign in$/ });

    await user.type(emailInput, emailValue);
    await user.type(passwordInput, passwordValue);
    await user.click(submitButton);
    expect(await screen.findByText('First failure')).toBeInTheDocument();

    // Second attempt succeeds -> error banner is removed and user is navigated.
    loginMock.mockResolvedValue({ success: true });
    await user.click(submitButton);

    await waitFor(() => expect(screen.queryByText('First failure')).not.toBeInTheDocument());
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/app'));
  });

  it('fills the form fields when a demo account is clicked', async () => {
    render(<LoginPage />);

    const user = userEvent.setup();
    const adminButton = screen.getByRole('button', { name: /Admin/ });
    await user.click(adminButton);

    expect(screen.getByLabelText('Email address')).toHaveValue('admin@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('Admin@12345!');

    // Submitting the prefilled form should succeed.
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }));
    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith('admin@example.com', 'Admin@12345!'),
    );
  });
});
