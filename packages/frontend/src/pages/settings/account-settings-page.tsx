import { useCallback, useEffect, useState } from 'react';
import { Mail, Shield, Lock, Upload, Trash2, AlertCircle, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/auth-context';
import { authRepo, employeeRepo } from '@/lib/api/repositories';
import { isRealBackend } from '@/data/data-layer';

const PASSWORD_POLICY = [
  'At least 8 characters',
  'At least 1 uppercase letter (A-Z)',
  'At least 1 lowercase letter (a-z)',
  'At least 1 number (0-9)',
  'At least 1 special character (!@#$%^&*...)',
];

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-700';
    case 'pending_setup':
      return 'bg-yellow-100 text-yellow-700';
    case 'deactivated':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'pending_setup':
      return 'Pending Setup';
    case 'deactivated':
      return 'Deactivated';
    default:
      return status;
  }
}

export function AccountSettingsPage() {
  const { user, employee, updateEmployee } = useAuth();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [changingPassword, setChangingPassword] = useState(false);

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleChangePassword = useCallback(async () => {
    const errors: Record<string, string> = {};

    if (!currentPassword) {
      errors.currentPassword = 'Current password is required.';
    }
    if (!newPassword) {
      errors.newPassword = 'New password is required.';
    }
    if (newPassword && newPassword !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    if (Object.keys(errors).length > 0) {
      setPasswordErrors(errors);
      return;
    }

    setChangingPassword(true);
    try {
      if (isRealBackend()) {
        await authRepo.changePassword(currentPassword, newPassword);
      }

      setToast({ type: 'success', message: 'Password changed successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordErrors({});
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not change password.';
      const status = (err as { status?: number }).status;

      if (status === 401) {
        setPasswordErrors({ currentPassword: 'Current password is incorrect.' });
      } else if (status === 400) {
        setPasswordErrors({ newPassword: message });
      } else if (status === 429) {
        setToast({ type: 'error', message: 'Too many attempts. Please try again later.' });
      } else {
        setToast({ type: 'error', message });
      }
    } finally {
      setChangingPassword(false);
    }
  }, [currentPassword, newPassword, confirmPassword]);

  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (!user?.employeeId) return;

      // Client-side validation
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        setToast({ type: 'error', message: 'Only JPEG, PNG, and WebP images are allowed.' });
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setToast({ type: 'error', message: 'File size must be under 2 MB.' });
        return;
      }

      setUploadingAvatar(true);
      try {
        if (isRealBackend()) {
          await employeeRepo.uploadAvatar(user.employeeId, file);
        }
        // Update cached employee with a cache-busting avatar URL
        const avatarUrl = `/api/employees/${user.employeeId}/avatar?t=${Date.now()}`;
        updateEmployee({ avatarUrl });

        setToast({ type: 'success', message: 'Avatar uploaded successfully.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not upload avatar.';
        setToast({ type: 'error', message });
      } finally {
        setUploadingAvatar(false);
      }
    },
    [user, updateEmployee],
  );

  const handleAvatarRemove = useCallback(async () => {
    if (!user?.employeeId) return;

    try {
      if (isRealBackend()) {
        await employeeRepo.removeAvatar(user.employeeId);
      }
      updateEmployee({ avatarUrl: undefined });
      setToast({ type: 'success', message: 'Avatar removed.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not remove avatar.';
      setToast({ type: 'error', message });
    }
  }, [user, updateEmployee]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleAvatarUpload(file);
    }
    // Reset the input so the same file can be selected again
    e.target.value = '';
  };

  if (!user) return null;

  const hasEmployee = !!employee;
  const displayName = employee ? `${employee.firstName} ${employee.lastName}` : user.email;
  const initials = employee
    ? `${employee.firstName[0] ?? ''}${employee.lastName[0] ?? ''}`.toUpperCase()
    : (user.email[0]?.toUpperCase() ?? '?');

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg ${
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Account Settings</h1>
        <p className="mt-1 text-sm text-ink-500">Manage your account credentials and preferences</p>
      </div>

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Information</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-ink-100">
          <div className="flex items-start justify-between gap-4 py-2.5">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <Mail className="h-4 w-4" />
              Email
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-ink-900">{user.email}</div>
              <p className="text-xs text-ink-400">Contact HR to change your email address.</p>
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 py-2.5">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <Shield className="h-4 w-4" />
              Role
            </div>
            <Badge variant="secondary">{user.role}</Badge>
          </div>
          <div className="flex items-start justify-between gap-4 py-2.5">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <AlertCircle className="h-4 w-4" />
              Account Status
            </div>
            <Badge className={statusBadgeClass(user.status)}>{statusLabel(user.status)}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password" className="text-xs text-ink-500">
              Current Password
            </Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={passwordErrors.currentPassword ? 'border-red-500' : ''}
              placeholder="Enter your current password"
            />
            {passwordErrors.currentPassword && (
              <p className="text-xs text-red-500">{passwordErrors.currentPassword}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-xs text-ink-500">
              New Password
            </Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={passwordErrors.newPassword ? 'border-red-500' : ''}
              placeholder="Enter your new password"
            />
            {passwordErrors.newPassword && (
              <p className="text-xs text-red-500">{passwordErrors.newPassword}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password" className="text-xs text-ink-500">
              Confirm New Password
            </Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={passwordErrors.confirmPassword ? 'border-red-500' : ''}
              placeholder="Re-enter your new password"
            />
            {passwordErrors.confirmPassword && (
              <p className="text-xs text-red-500">{passwordErrors.confirmPassword}</p>
            )}
          </div>
          <div className="rounded-lg bg-ink-50 p-3">
            <p className="mb-1.5 text-xs font-medium text-ink-600">Password requirements:</p>
            <ul className="space-y-1">
              {PASSWORD_POLICY.map((req) => (
                <li key={req} className="text-xs text-ink-500">
                  • {req}
                </li>
              ))}
            </ul>
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
          >
            {changingPassword ? 'Changing...' : 'Change Password'}
          </Button>
        </CardContent>
      </Card>

      {/* Avatar Upload (Phase 2) — only if user has a linked employee */}
      {hasEmployee && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Profile Avatar
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-accent-100 text-2xl font-semibold text-accent-700">
              {employee?.avatarUrl ? (
                <img
                  src={employee.avatarUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={uploadingAvatar}
                  onClick={() => document.getElementById('avatar-upload')?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {uploadingAvatar ? 'Uploading...' : 'Upload'}
                </Button>
                {employee?.avatarUrl && (
                  <Button variant="outline" onClick={handleAvatarRemove}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink-400">JPEG, PNG, or WebP. Maximum 2 MB.</p>
              <input
                id="avatar-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
