import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { AccountSettingsPage } from './account-settings-page';

const useAuth = vi.fn();
const authRepoChangePassword = vi.fn();
const employeeRepoUploadAvatar = vi.fn();
const employeeRepoRemoveAvatar = vi.fn();
const isRealBackend = vi.fn();

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuth(),
}));

vi.mock('@/lib/api/repositories', () => ({
  authRepo: {
    changePassword: (...args: unknown[]) => authRepoChangePassword(...args),
  },
  employeeRepo: {
    uploadAvatar: (...args: unknown[]) => employeeRepoUploadAvatar(...args),
    removeAvatar: (...args: unknown[]) => employeeRepoRemoveAvatar(...args),
  },
}));

vi.mock('@/data/data-layer', () => ({
  isRealBackend: () => isRealBackend(),
}));

const mockUser = {
  id: 'u-1',
  email: 'jane@example.com',
  role: 'Employee',
  status: 'active' as const,
  employeeId: 'emp-1',
};

const mockEmployee = {
  id: 'emp-1',
  firstName: 'Jane',
  lastName: 'Doe',
  avatarUrl: undefined,
};

const updateEmployee = vi.fn();

function renderSettings(overrides: Record<string, unknown> = {}) {
  useAuth.mockReturnValue({
    user: mockUser,
    employee: mockEmployee,
    updateEmployee,
    ...overrides,
  });
  return render(
    <MemoryRouter>
      <AccountSettingsPage />
    </MemoryRouter>,
  );
}

function fillPasswordForm(current: string, newPw: string, confirm: string) {
  fireEvent.change(screen.getByPlaceholderText('Enter your current password'), {
    target: { value: current },
  });
  fireEvent.change(screen.getByPlaceholderText('Enter your new password'), {
    target: { value: newPw },
  });
  fireEvent.change(screen.getByPlaceholderText('Re-enter your new password'), {
    target: { value: confirm },
  });
}

function clickChangePasswordButton() {
  fireEvent.click(screen.getByRole('button', { name: /Change Password/i }));
}

describe('AccountSettingsPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    isRealBackend.mockReturnValue(false);
  });

  it('renders account info section with email', () => {
    renderSettings();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('renders password change form inputs', () => {
    renderSettings();
    expect(screen.getByPlaceholderText('Enter your current password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your new password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Re-enter your new password')).toBeInTheDocument();
  });

  it('renders password policy checklist', () => {
    renderSettings();
    expect(screen.getByText('Password requirements:')).toBeInTheDocument();
    expect(screen.getByText(/At least 8 characters/)).toBeInTheDocument();
  });

  it('shows confirm password mismatch error', () => {
    renderSettings();
    fillPasswordForm('OldPass123!', 'NewPass456@', 'DifferentPass@');
    clickChangePasswordButton();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
  });

  it('shows success toast after password change in mock mode', async () => {
    renderSettings();
    fillPasswordForm('OldPass123!', 'NewPass456@', 'NewPass456@');
    clickChangePasswordButton();

    await waitFor(() => {
      expect(screen.getByText('Password changed successfully.')).toBeInTheDocument();
    });
  });

  it('calls changePassword API when real backend is active', async () => {
    isRealBackend.mockReturnValue(true);
    authRepoChangePassword.mockResolvedValue({ message: 'Password changed successfully' });
    renderSettings();
    fillPasswordForm('OldPass123!', 'NewPass456@', 'NewPass456@');
    clickChangePasswordButton();

    await waitFor(() => {
      expect(authRepoChangePassword).toHaveBeenCalledWith('OldPass123!', 'NewPass456@');
    });
  });

  it('shows inline error on 401 (wrong current password)', async () => {
    isRealBackend.mockReturnValue(true);
    authRepoChangePassword.mockRejectedValue(
      Object.assign(new Error('Current password is incorrect.'), { status: 401 }),
    );
    renderSettings();
    fillPasswordForm('WrongPass', 'NewPass456@', 'NewPass456@');
    clickChangePasswordButton();

    await waitFor(() => {
      expect(screen.getByText('Current password is incorrect.')).toBeInTheDocument();
    });
  });

  it('shows toast error on 429 (rate limit)', async () => {
    isRealBackend.mockReturnValue(true);
    authRepoChangePassword.mockRejectedValue(
      Object.assign(new Error('Too many requests'), { status: 429 }),
    );
    renderSettings();
    fillPasswordForm('OldPass123!', 'NewPass456@', 'NewPass456@');
    clickChangePasswordButton();

    await waitFor(() => {
      expect(screen.getByText('Too many attempts. Please try again later.')).toBeInTheDocument();
    });
  });

  it('hides avatar section when no employee is linked', () => {
    renderSettings({ employee: null });
    expect(screen.queryByText('Profile Avatar')).not.toBeInTheDocument();
  });

  it('shows avatar section with initials fallback when employee is linked', () => {
    renderSettings();
    expect(screen.getByText('Profile Avatar')).toBeInTheDocument();
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Submit button enable/disable (the "required" messages are guarded by the
  // disabled state, so we assert the button itself)
  // ---------------------------------------------------------------------------

  it('disables the change password button until all fields are filled', () => {
    renderSettings();
    const button = screen.getByRole('button', { name: /Change Password/i });
    expect(button).toBeDisabled();

    fillPasswordForm('OldPass123!', 'NewPass456@', 'NewPass456@');
    expect(button).not.toBeDisabled();
  });

  it('keeps the button disabled when the current password is empty', () => {
    renderSettings();
    fillPasswordForm('', 'NewPass456@', 'NewPass456@');
    expect(screen.getByRole('button', { name: /Change Password/i })).toBeDisabled();
  });

  it('keeps the button disabled when the new password is empty', () => {
    renderSettings();
    fillPasswordForm('OldPass123!', '', '');
    expect(screen.getByRole('button', { name: /Change Password/i })).toBeDisabled();
  });

  it('keeps the button disabled when the confirm password is empty', () => {
    renderSettings();
    fillPasswordForm('OldPass123!', 'NewPass456@', '');
    expect(screen.getByRole('button', { name: /Change Password/i })).toBeDisabled();
  });

  it('does not call changePassword API when client-side validation fails', async () => {
    isRealBackend.mockReturnValue(true);
    renderSettings();
    fillPasswordForm('OldPass123!', 'NewPass456@', 'Different123!');
    clickChangePasswordButton();

    // Validation error shown, API never invoked.
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(authRepoChangePassword).not.toHaveBeenCalled();
  });

  it('shows newPassword inline error on 400 response', async () => {
    isRealBackend.mockReturnValue(true);
    authRepoChangePassword.mockRejectedValue(
      Object.assign(new Error('Password does not meet policy.'), { status: 400 }),
    );
    renderSettings();
    fillPasswordForm('OldPass123!', 'weak', 'weak');
    clickChangePasswordButton();

    await waitFor(() => {
      expect(screen.getByText('Password does not meet policy.')).toBeInTheDocument();
    });
  });

  it('shows generic error toast for unknown error status', async () => {
    isRealBackend.mockReturnValue(true);
    authRepoChangePassword.mockRejectedValue(
      Object.assign(new Error('Something broke'), { status: 500 }),
    );
    renderSettings();
    fillPasswordForm('OldPass123!', 'NewPass456@', 'NewPass456@');
    clickChangePasswordButton();

    await waitFor(() => {
      expect(screen.getByText('Something broke')).toBeInTheDocument();
    });
  });

  it('shows generic error toast when error has no status and is not an Error instance', async () => {
    isRealBackend.mockReturnValue(true);
    authRepoChangePassword.mockRejectedValue('a plain string rejection');
    renderSettings();
    fillPasswordForm('OldPass123!', 'NewPass456@', 'NewPass456@');
    clickChangePasswordButton();

    await waitFor(() => {
      expect(screen.getByText('Could not change password.')).toBeInTheDocument();
    });
  });

  it('clears password fields after a successful change', async () => {
    renderSettings();
    const current = screen.getByPlaceholderText('Enter your current password') as HTMLInputElement;
    const next = screen.getByPlaceholderText('Enter your new password') as HTMLInputElement;
    const confirm = screen.getByPlaceholderText('Re-enter your new password') as HTMLInputElement;

    fillPasswordForm('OldPass123!', 'NewPass456@', 'NewPass456@');
    clickChangePasswordButton();

    await waitFor(() => {
      expect(screen.getByText('Password changed successfully.')).toBeInTheDocument();
    });
    expect(current.value).toBe('');
    expect(next.value).toBe('');
    expect(confirm.value).toBe('');
  });

  it('shows "Changing..." label while the request is in flight', async () => {
    isRealBackend.mockReturnValue(true);
    // Never resolve so the button stays in the loading state.
    authRepoChangePassword.mockReturnValue(new Promise(() => {}));
    renderSettings();
    fillPasswordForm('OldPass123!', 'NewPass456@', 'NewPass456@');
    clickChangePasswordButton();

    expect(screen.getByRole('button', { name: /Changing\.\.\./i })).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Account status badge variations
  // ---------------------------------------------------------------------------

  it('renders Active status label', () => {
    renderSettings({ user: { ...mockUser, status: 'active' } });
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders Pending Setup status label', () => {
    renderSettings({ user: { ...mockUser, status: 'pending_setup' } });
    expect(screen.getByText('Pending Setup')).toBeInTheDocument();
  });

  it('renders Deactivated status label', () => {
    renderSettings({ user: { ...mockUser, status: 'deactivated' } });
    expect(screen.getByText('Deactivated')).toBeInTheDocument();
  });

  it('renders the raw status when it is unknown', () => {
    renderSettings({ user: { ...mockUser, status: 'frozen' } as unknown as typeof mockUser });
    expect(screen.getByText('frozen')).toBeInTheDocument();
  });

  it('renders the user role badge', () => {
    renderSettings();
    expect(screen.getByText('Employee')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Avatar initials edge cases (avatar card only renders with a linked employee)
  // ---------------------------------------------------------------------------

  it('renders combined initials from a single-letter first and last name', () => {
    renderSettings({
      employee: { ...mockEmployee, firstName: 'A', lastName: 'B' },
    });
    expect(screen.getByText('AB')).toBeInTheDocument();
  });

  it('shows an avatar image when employee has an avatarUrl', () => {
    renderSettings({
      employee: { ...mockEmployee, avatarUrl: 'http://img/avatar.png' },
    });
    const img = screen.getByAltText('Jane Doe') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain('http://img/avatar.png');
  });

  // ---------------------------------------------------------------------------
  // Avatar upload
  // ---------------------------------------------------------------------------

  function getAvatarInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('#avatar-upload') as HTMLInputElement;
  }

  it('uploads a valid image and updates the cached employee in real backend mode', async () => {
    isRealBackend.mockReturnValue(true);
    employeeRepoUploadAvatar.mockResolvedValue({ avatarUrl: 'http://img/avatar.png' });
    const file = new File(['data'], 'pic.png', { type: 'image/png' });
    const { container } = renderSettings();

    fireEvent.change(getAvatarInput(container), { target: { files: [file] } });

    await waitFor(() => {
      expect(employeeRepoUploadAvatar).toHaveBeenCalledWith('emp-1', file);
    });
    expect(updateEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarUrl: expect.stringContaining('/api/employees/emp-1/avatar'),
      }),
    );
    expect(screen.getByText('Avatar uploaded successfully.')).toBeInTheDocument();
  });

  it('uploads an image using employee data only in mock mode (no API call)', async () => {
    isRealBackend.mockReturnValue(false);
    const file = new File(['data'], 'pic.webp', { type: 'image/webp' });
    const { container } = renderSettings();

    fireEvent.change(getAvatarInput(container), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Avatar uploaded successfully.')).toBeInTheDocument();
    });
    expect(employeeRepoUploadAvatar).not.toHaveBeenCalled();
  });

  it('rejects an invalid file type with an error toast', async () => {
    const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' });
    const { container } = renderSettings();

    fireEvent.change(getAvatarInput(container), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Only JPEG, PNG, and WebP images are allowed.')).toBeInTheDocument();
    });
    expect(employeeRepoUploadAvatar).not.toHaveBeenCalled();
  });

  it('rejects a file larger than 2 MB with an error toast', async () => {
    const file = new File(['x'.repeat(3 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    const { container } = renderSettings();

    fireEvent.change(getAvatarInput(container), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('File size must be under 2 MB.')).toBeInTheDocument();
    });
    expect(employeeRepoUploadAvatar).not.toHaveBeenCalled();
  });

  it('shows an error toast when avatar upload fails', async () => {
    isRealBackend.mockReturnValue(true);
    employeeRepoUploadAvatar.mockRejectedValue(new Error('Upload failed'));
    const file = new File(['data'], 'pic.png', { type: 'image/png' });
    const { container } = renderSettings();

    fireEvent.change(getAvatarInput(container), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Upload failed')).toBeInTheDocument();
    });
  });

  it('shows generic upload error when rejection is not an Error instance', async () => {
    isRealBackend.mockReturnValue(true);
    employeeRepoUploadAvatar.mockRejectedValue('boom');
    const file = new File(['data'], 'pic.png', { type: 'image/png' });
    const { container } = renderSettings();

    fireEvent.change(getAvatarInput(container), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Could not upload avatar.')).toBeInTheDocument();
    });
  });

  it('does nothing when avatar upload is triggered without an employeeId', async () => {
    isRealBackend.mockReturnValue(true);
    const file = new File(['data'], 'pic.png', { type: 'image/png' });
    const { container } = renderSettings({ user: { ...mockUser, employeeId: undefined } });

    fireEvent.change(getAvatarInput(container), { target: { files: [file] } });

    expect(employeeRepoUploadAvatar).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Avatar removal
  // ---------------------------------------------------------------------------

  it('removes the avatar and clears the cached avatarUrl in real backend mode', async () => {
    isRealBackend.mockReturnValue(true);
    employeeRepoRemoveAvatar.mockResolvedValue(undefined);
    renderSettings({
      employee: { ...mockEmployee, avatarUrl: 'http://img/avatar.png' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));

    await waitFor(() => {
      expect(employeeRepoRemoveAvatar).toHaveBeenCalledWith('emp-1');
    });
    expect(updateEmployee).toHaveBeenCalledWith({ avatarUrl: undefined });
    expect(screen.getByText('Avatar removed.')).toBeInTheDocument();
  });

  it('removes the avatar in mock mode without calling the API', async () => {
    isRealBackend.mockReturnValue(false);
    renderSettings({
      employee: { ...mockEmployee, avatarUrl: 'http://img/avatar.png' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));

    await waitFor(() => {
      expect(screen.getByText('Avatar removed.')).toBeInTheDocument();
    });
    expect(employeeRepoRemoveAvatar).not.toHaveBeenCalled();
  });

  it('shows an error toast when avatar removal fails', async () => {
    isRealBackend.mockReturnValue(true);
    employeeRepoRemoveAvatar.mockRejectedValue(new Error('Remove failed'));
    renderSettings({
      employee: { ...mockEmployee, avatarUrl: 'http://img/avatar.png' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));

    await waitFor(() => {
      expect(screen.getByText('Remove failed')).toBeInTheDocument();
    });
  });

  it('shows generic removal error when rejection is not an Error instance', async () => {
    isRealBackend.mockReturnValue(true);
    employeeRepoRemoveAvatar.mockRejectedValue('nope');
    renderSettings({
      employee: { ...mockEmployee, avatarUrl: 'http://img/avatar.png' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));

    await waitFor(() => {
      expect(screen.getByText('Could not remove avatar.')).toBeInTheDocument();
    });
  });

  it('does nothing when avatar removal is triggered without an employeeId', async () => {
    isRealBackend.mockReturnValue(true);
    renderSettings({
      user: { ...mockUser, employeeId: undefined },
      employee: { ...mockEmployee, avatarUrl: 'http://img/avatar.png' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));

    expect(employeeRepoRemoveAvatar).not.toHaveBeenCalled();
  });

  it('does not render a Remove button when there is no avatar', () => {
    renderSettings({ employee: { ...mockEmployee, avatarUrl: undefined } });
    expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Toast auto-dismiss
  // ---------------------------------------------------------------------------

  it('auto-dismisses the success toast after 4 seconds', async () => {
    vi.useFakeTimers();
    try {
      renderSettings();
      fillPasswordForm('OldPass123!', 'NewPass456@', 'NewPass456@');
      clickChangePasswordButton();

      await vi.waitFor(() => {
        expect(screen.getByText('Password changed successfully.')).toBeInTheDocument();
      });

      vi.advanceTimersByTime(4000);

      await vi.waitFor(() => {
        expect(screen.queryByText('Password changed successfully.')).not.toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the page header and account information card', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: /Account Settings/i })).toBeInTheDocument();
    expect(screen.getByText('Account Information')).toBeInTheDocument();
    expect(
      screen.getByText(/Manage your account credentials and preferences/i),
    ).toBeInTheDocument();
  });
});
