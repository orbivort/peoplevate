import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRole, UserStatus } from '#prisma';

// Mock all module dependencies before importing the service so no real DB,
// email transporter, or crypto-heavy code is touched by unit tests.

vi.mock('../config/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../config/env.js', () => ({
  env: {
    ACCOUNT_LOCKOUT_THRESHOLD: 5,
    ACCOUNT_LOCKOUT_DURATION_MIN: 15,
    PASSWORD_RESET_TOKEN_EXPIRY_HOURS: 1,
    SETUP_TOKEN_EXPIRY_HOURS: 24,
  },
}));

vi.mock('../utils/password.js', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  validatePasswordPolicy: vi.fn(),
}));

vi.mock('../utils/token.js', () => ({
  generateToken: vi.fn(),
  hashToken: vi.fn(),
  signAccessToken: vi.fn(),
  signRefreshToken: vi.fn(),
  verifyJwt: vi.fn(),
  addHours: vi.fn((h: number) => {
    const d = new Date();
    d.setHours(d.getHours() + h);
    return d;
  }),
}));

vi.mock('./audit-service.js', () => ({
  logLogin: vi.fn(),
  logLogout: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock('./breach-service.js', () => ({
  checkFailedLoginSpike: vi.fn(),
}));

vi.mock('./email-service.js', () => ({
  sendSetupEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendLockoutNotification: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import * as passwordUtils from '../utils/password.js';
import * as tokenUtils from '../utils/token.js';
import * as auditService from './audit-service.js';
import * as breachService from './breach-service.js';
import * as emailService from './email-service.js';
import {
  login,
  refresh,
  logout,
  requestPasswordReset,
  resetPassword,
  setupAccount,
  inviteUser,
  changeUserRole,
  changeUserStatus,
  adminResetPassword,
  deleteUser,
  changePassword,
} from './auth-service.js';

const mockedUser = {
  findUnique: vi.mocked(prisma.user.findUnique),
  findFirst: vi.mocked(prisma.user.findFirst),
  create: vi.mocked(prisma.user.create),
  update: vi.mocked(prisma.user.update),
};
const mockedRefreshToken = {
  findUnique: vi.mocked(prisma.refreshToken.findUnique),
  create: vi.mocked(prisma.refreshToken.create),
  update: vi.mocked(prisma.refreshToken.update),
  updateMany: vi.mocked(prisma.refreshToken.updateMany),
};
const mockedTransaction = vi.mocked(prisma.$transaction);
const mockedHashPassword = vi.mocked(passwordUtils.hashPassword);
const mockedVerifyPassword = vi.mocked(passwordUtils.verifyPassword);
const mockedValidatePasswordPolicy = vi.mocked(passwordUtils.validatePasswordPolicy);
const mockedGenerateToken = vi.mocked(tokenUtils.generateToken);
const mockedHashToken = vi.mocked(tokenUtils.hashToken);
const mockedSignAccessToken = vi.mocked(tokenUtils.signAccessToken);
const mockedSignRefreshToken = vi.mocked(tokenUtils.signRefreshToken);
const mockedVerifyJwt = vi.mocked(tokenUtils.verifyJwt);
const mockedLogLogin = vi.mocked(auditService.logLogin);
const mockedLogLogout = vi.mocked(auditService.logLogout);
const mockedLogAuditEvent = vi.mocked(auditService.logAuditEvent);
const mockedCheckFailedLoginSpike = vi.mocked(breachService.checkFailedLoginSpike);
const mockedSendSetupEmail = vi.mocked(emailService.sendSetupEmail);
const mockedSendPasswordResetEmail = vi.mocked(emailService.sendPasswordResetEmail);
const mockedSendLockoutNotification = vi.mocked(emailService.sendLockoutNotification);

// Generic (non-enum) base user shape used across tests.
const baseUser = {
  id: 'user-1',
  email: 'john@example.com',
  password_hash: 'hashed',
  deleted_at: null,
  locked_until: null,
  failed_login_count: 0,
  role: UserRole.EMPLOYEE,
  status: UserStatus.ACTIVE,
  employee: { id: 'emp-1' },
};

function expectHttpError(promise: Promise<unknown>, status: number, message?: string) {
  return promise.then(
    () => {
      throw new Error(`Expected promise to reject with status ${status}`);
    },
    (err: Error & { status?: number }) => {
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(status);
      if (message !== undefined) expect(err.message).toBe(message);
    },
  );
}

describe('auth-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tokenUtils.addHours).mockImplementation((h: number) => {
      const d = new Date();
      d.setHours(d.getHours() + h);
      return d;
    });
    mockedCheckFailedLoginSpike.mockResolvedValue(undefined);
  });

  describe('login', () => {
    it('returns a token pair and user payload for valid credentials', async () => {
      const user = { ...baseUser };
      mockedUser.findUnique.mockResolvedValue(user);
      mockedVerifyPassword.mockResolvedValue(true);
      mockedSignAccessToken.mockReturnValue('access-token');
      mockedSignRefreshToken.mockReturnValue('refresh-raw-token');
      mockedHashToken.mockReturnValue('refresh-hash');
      mockedUser.update.mockResolvedValue({} as never);
      mockedRefreshToken.create.mockResolvedValue({} as never);
      mockedLogLogin.mockResolvedValue(undefined);

      const result = await login('JOHN@example.com', 'Password123!');

      expect(mockedUser.findUnique).toHaveBeenCalledWith({
        where: { email: 'john@example.com' },
        include: { employee: { select: { id: true } } },
      });
      expect(mockedVerifyPassword).toHaveBeenCalledWith('hashed', 'Password123!');
      expect(mockedUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failed_login_count: 0, locked_until: null },
      });
      expect(mockedLogLogin).toHaveBeenCalledWith('user-1', 'john@example.com');
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-raw-token',
        user: { id: 'user-1', email: 'john@example.com', role: 'EMPLOYEE', employeeId: 'emp-1' },
      });
    });

    it('rejects when the user does not exist', async () => {
      mockedUser.findUnique.mockResolvedValue(null);
      await expectHttpError(
        login('ghost@example.com', 'Password123!'),
        401,
        'Invalid email or password',
      );
    });

    it('rejects a soft-deleted user', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, deleted_at: new Date() } as never);
      await expectHttpError(
        login('john@example.com', 'Password123!'),
        401,
        'Invalid email or password',
      );
    });

    it('rejects a deactivated user', async () => {
      mockedUser.findUnique.mockResolvedValue({
        ...baseUser,
        status: UserStatus.DEACTIVATED,
      } as never);
      await expectHttpError(
        login('john@example.com', 'Password123!'),
        401,
        'Invalid email or password',
      );
    });

    it('rejects a locked account while still locked', async () => {
      mockedUser.findUnique.mockResolvedValue({
        ...baseUser,
        locked_until: new Date(Date.now() + 60_000),
      } as never);
      await expectHttpError(
        login('john@example.com', 'Password123!'),
        423,
        'Account is locked. Try again later or contact HR.',
      );
    });

    it('rejects an account awaiting password setup', async () => {
      mockedUser.findUnique.mockResolvedValue({
        ...baseUser,
        status: UserStatus.PENDING_SETUP,
      } as never);
      await expectHttpError(
        login('john@example.com', 'Password123!'),
        403,
        'Please set up your password first. Check your email for the setup link.',
      );
    });

    it('rejects when the user has no password hash', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, password_hash: null } as never);
      await expectHttpError(
        login('john@example.com', 'Password123!'),
        401,
        'Invalid email or password',
      );
    });

    it('increments the failed-login count on a wrong password', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, failed_login_count: 1 } as never);
      mockedVerifyPassword.mockResolvedValue(false);
      mockedUser.update.mockResolvedValue({} as never);

      await expectHttpError(login('john@example.com', 'wrong'), 401, 'Invalid email or password');

      expect(mockedUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failed_login_count: 2, locked_until: null },
      });
    });

    it('records the failed login and feeds the spike detector with the client IP', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, failed_login_count: 0 } as never);
      mockedVerifyPassword.mockResolvedValue(false);
      mockedUser.update.mockResolvedValue({} as never);

      await expectHttpError(
        login('john@example.com', 'wrong', '203.0.113.10'),
        401,
        'Invalid email or password',
      );

      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          action: 'LOGIN',
          entity: 'AUTH',
          entityId: '203.0.113.10',
          newValue: expect.objectContaining({ outcome: 'FAILED' }),
        }),
      );
      expect(mockedCheckFailedLoginSpike).toHaveBeenCalledWith('203.0.113.10');
    });

    it('does not run the spike detector when the IP is absent', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, failed_login_count: 0 } as never);
      mockedVerifyPassword.mockResolvedValue(false);
      mockedUser.update.mockResolvedValue({} as never);

      await expectHttpError(login('john@example.com', 'wrong'), 401, 'Invalid email or password');

      expect(mockedCheckFailedLoginSpike).not.toHaveBeenCalled();
    });

    it('locks the account and notifies when the threshold is reached', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, failed_login_count: 4 } as never);
      mockedVerifyPassword.mockResolvedValue(false);
      mockedUser.update.mockResolvedValue({} as never);
      mockedSendLockoutNotification.mockResolvedValue(undefined);

      await expectHttpError(
        login('john@example.com', 'wrong'),
        423,
        'Account is locked. Try again later or contact HR.',
      );

      const updateCall = mockedUser.update.mock.calls[0][0] as {
        data: { failed_login_count: number; locked_until: Date | null };
      };
      expect(updateCall.data.failed_login_count).toBe(5);
      expect(updateCall.data.locked_until).toBeInstanceOf(Date);
      expect(mockedSendLockoutNotification).toHaveBeenCalledWith('john@example.com');
    });

    it('does not lock when below the threshold', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, failed_login_count: 0 } as never);
      mockedVerifyPassword.mockResolvedValue(false);
      mockedUser.update.mockResolvedValue({} as never);

      await expectHttpError(login('john@example.com', 'wrong'), 401, 'Invalid email or password');

      const updateCall = mockedUser.update.mock.calls[0][0] as {
        data: { failed_login_count: number; locked_until: Date | null };
      };
      expect(updateCall.data.failed_login_count).toBe(1);
      expect(updateCall.data.locked_until).toBeNull();
    });

    it('returns null employeeId when the user has no employee record', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, employee: null } as never);
      mockedVerifyPassword.mockResolvedValue(true);
      mockedSignAccessToken.mockReturnValue('access-token');
      mockedSignRefreshToken.mockReturnValue('refresh-raw-token');
      mockedHashToken.mockReturnValue('refresh-hash');
      mockedUser.update.mockResolvedValue({} as never);
      mockedRefreshToken.create.mockResolvedValue({} as never);

      const result = await login('john@example.com', 'Password123!');
      expect(result.user.employeeId).toBeNull();
    });
  });

  describe('refresh', () => {
    const storedToken = {
      id: 'rt-1',
      token_hash: 'hash',
      user_id: 'user-1',
      family_id: 'family-1',
      revoked: false,
      expires_at: new Date(Date.now() + 3_600_000),
      user: {
        ...baseUser,
        employee: { id: 'emp-1' },
      },
    };

    it('rotates the token family and returns a new pair', async () => {
      mockedVerifyJwt.mockReturnValue({ userId: 'user-1', role: 'EMPLOYEE' });
      mockedHashToken.mockReturnValue('token-hash');
      mockedRefreshToken.findUnique.mockResolvedValue(storedToken as never);
      mockedRefreshToken.update.mockResolvedValue({} as never);
      mockedSignAccessToken.mockReturnValue('new-access');
      mockedSignRefreshToken.mockReturnValue('new-refresh-raw');
      mockedRefreshToken.create.mockResolvedValue({} as never);

      const result = await refresh('some-refresh-token');

      expect(mockedRefreshToken.findUnique).toHaveBeenCalledWith({
        where: { token_hash: 'token-hash' },
        include: { user: { include: { employee: { select: { id: true } } } } },
      });
      // Revoke old token
      expect(mockedRefreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revoked: true },
      });
      expect(result).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh-raw',
        user: { id: 'user-1', email: 'john@example.com', role: 'EMPLOYEE', employeeId: 'emp-1' },
      });
      // New token issued in the same family
      const createCall = mockedRefreshToken.create.mock.calls[0][0] as {
        data: { family_id: string };
      };
      expect(createCall.data.family_id).toBe('family-1');
    });

    it('rejects an invalid JWT', async () => {
      mockedVerifyJwt.mockReturnValue(null);
      await expectHttpError(refresh('bad-token'), 401, 'Invalid refresh token');
    });

    it('rejects a revoked token', async () => {
      mockedVerifyJwt.mockReturnValue({ userId: 'user-1', role: 'EMPLOYEE' });
      mockedHashToken.mockReturnValue('token-hash');
      mockedRefreshToken.findUnique.mockResolvedValue({ ...storedToken, revoked: true } as never);
      await expectHttpError(refresh('revoked-token'), 401, 'Invalid refresh token');
    });

    it('rejects an expired token', async () => {
      mockedVerifyJwt.mockReturnValue({ userId: 'user-1', role: 'EMPLOYEE' });
      mockedHashToken.mockReturnValue('token-hash');
      mockedRefreshToken.findUnique.mockResolvedValue({
        ...storedToken,
        expires_at: new Date(Date.now() - 1000),
      } as never);
      await expectHttpError(refresh('expired-token'), 401, 'Invalid refresh token');
    });

    it('revokes the entire family when a non-revoked, missing-record token is reused', async () => {
      // No stored record found for the token hash -> reuse detection branch with stored undefined.
      mockedVerifyJwt.mockReturnValue({ userId: 'user-1', role: 'EMPLOYEE' });
      mockedHashToken.mockReturnValue('token-hash');
      mockedRefreshToken.findUnique.mockResolvedValue(null);

      await expectHttpError(refresh('reused-token'), 401, 'Invalid refresh token');

      // stored is null, so no family updateMany should be triggered.
      expect(mockedRefreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a non-active account', async () => {
      mockedVerifyJwt.mockReturnValue({ userId: 'user-1', role: 'EMPLOYEE' });
      mockedHashToken.mockReturnValue('token-hash');
      mockedRefreshToken.findUnique.mockResolvedValue({
        ...storedToken,
        user: { ...baseUser, status: UserStatus.DEACTIVATED },
      } as never);
      mockedRefreshToken.update.mockResolvedValue({} as never);

      await expectHttpError(refresh('token-for-inactive'), 401, 'Account is not active');
    });

    it('returns null employeeId when the user has no employee record', async () => {
      mockedVerifyJwt.mockReturnValue({ userId: 'user-1', role: 'EMPLOYEE' });
      mockedHashToken.mockReturnValue('token-hash');
      mockedRefreshToken.findUnique.mockResolvedValue({
        ...storedToken,
        user: { ...baseUser, employee: null },
      } as never);
      mockedRefreshToken.update.mockResolvedValue({} as never);
      mockedSignAccessToken.mockReturnValue('new-access');
      mockedSignRefreshToken.mockReturnValue('new-refresh-raw');
      mockedRefreshToken.create.mockResolvedValue({} as never);

      const result = await refresh('valid-token');
      expect(result.user.employeeId).toBeNull();
    });
  });

  describe('logout', () => {
    it('revokes the token and logs the logout', async () => {
      mockedHashToken.mockReturnValue('token-hash');
      mockedRefreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        user_id: 'user-1',
      } as never);
      mockedRefreshToken.update.mockResolvedValue({} as never);
      mockedUser.findUnique.mockResolvedValue({ id: 'user-1', email: 'john@example.com' } as never);

      await logout('refresh-token');

      expect(mockedRefreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revoked: true },
      });
      expect(mockedLogLogout).toHaveBeenCalledWith('user-1', 'john@example.com');
    });

    it('does nothing when the token is not found', async () => {
      mockedHashToken.mockReturnValue('token-hash');
      mockedRefreshToken.findUnique.mockResolvedValue(null);

      await logout('unknown-token');

      expect(mockedRefreshToken.update).not.toHaveBeenCalled();
      expect(mockedUser.findUnique).not.toHaveBeenCalled();
      expect(mockedLogLogout).not.toHaveBeenCalled();
    });

    it('does not log the logout if the user is not found', async () => {
      mockedHashToken.mockReturnValue('token-hash');
      mockedRefreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        user_id: 'user-1',
      } as never);
      mockedRefreshToken.update.mockResolvedValue({} as never);
      mockedUser.findUnique.mockResolvedValue(null);

      await logout('refresh-token');

      expect(mockedLogLogout).not.toHaveBeenCalled();
    });
  });

  describe('requestPasswordReset', () => {
    it('sends a reset email and stores a hashed token', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      mockedGenerateToken.mockReturnValue('raw-reset-token');
      mockedHashToken.mockReturnValue('hashed-reset-token');
      mockedUser.update.mockResolvedValue({} as never);
      mockedSendPasswordResetEmail.mockResolvedValue(undefined);

      await requestPasswordReset('JOHN@example.com');

      expect(mockedUser.findUnique).toHaveBeenCalledWith({ where: { email: 'john@example.com' } });
      expect(mockedUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          reset_token: 'hashed-reset-token',
          reset_token_expires: expect.any(Date),
        },
      });
      expect(mockedSendPasswordResetEmail).toHaveBeenCalledWith(
        'john@example.com',
        'raw-reset-token',
      );
    });

    it('returns silently when the user does not exist', async () => {
      mockedUser.findUnique.mockResolvedValue(null);
      await expect(requestPasswordReset('ghost@example.com')).resolves.toBeUndefined();
      expect(mockedUser.update).not.toHaveBeenCalled();
      expect(mockedSendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('returns silently for a deleted user', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, deleted_at: new Date() } as never);
      await expect(requestPasswordReset('john@example.com')).resolves.toBeUndefined();
      expect(mockedUser.update).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('resets the password and clears lockout fields', async () => {
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });
      mockedHashToken.mockReturnValue('hashed-reset-token');
      mockedUser.findFirst.mockResolvedValue({
        ...baseUser,
        reset_token: 'hashed-reset-token',
        reset_token_expires: new Date(Date.now() + 3_600_000),
      } as never);
      mockedHashPassword.mockResolvedValue('new-hashed-password');
      mockedUser.update.mockResolvedValue({} as never);

      await resetPassword('raw-token', 'NewPassword123!');

      expect(mockedUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          password_hash: 'new-hashed-password',
          reset_token: null,
          reset_token_expires: null,
          failed_login_count: 0,
          locked_until: null,
        },
      });
    });

    it('rejects a password that fails the policy', async () => {
      mockedValidatePasswordPolicy.mockReturnValue({
        valid: false,
        errors: ['Password too weak', 'No uppercase'],
      });
      await expectHttpError(
        resetPassword('raw-token', 'weak'),
        400,
        'Password too weak; No uppercase',
      );
    });

    it('rejects a missing user', async () => {
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });
      mockedHashToken.mockReturnValue('hashed-reset-token');
      mockedUser.findFirst.mockResolvedValue(null);
      await expectHttpError(
        resetPassword('raw-token', 'NewPassword123!'),
        400,
        'Invalid or expired reset token',
      );
    });

    it('rejects an expired reset token', async () => {
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });
      mockedHashToken.mockReturnValue('hashed-reset-token');
      mockedUser.findFirst.mockResolvedValue({
        ...baseUser,
        reset_token: 'hashed-reset-token',
        reset_token_expires: new Date(Date.now() - 1000),
      } as never);
      await expectHttpError(
        resetPassword('raw-token', 'NewPassword123!'),
        400,
        'Invalid or expired reset token',
      );
    });

    it('rejects when there is no reset expiry', async () => {
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });
      mockedHashToken.mockReturnValue('hashed-reset-token');
      mockedUser.findFirst.mockResolvedValue({ ...baseUser, reset_token_expires: null } as never);
      await expectHttpError(
        resetPassword('raw-token', 'NewPassword123!'),
        400,
        'Invalid or expired reset token',
      );
    });
  });

  describe('setupAccount', () => {
    it('activates the account and sets the password', async () => {
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });
      mockedHashToken.mockReturnValue('hashed-setup-token');
      mockedUser.findFirst.mockResolvedValue({
        ...baseUser,
        setup_token: 'hashed-setup-token',
        setup_token_expires: new Date(Date.now() + 3_600_000),
      } as never);
      mockedHashPassword.mockResolvedValue('new-hashed-password');
      mockedUser.update.mockResolvedValue({} as never);

      await setupAccount('raw-token', 'NewPassword123!');

      expect(mockedUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          password_hash: 'new-hashed-password',
          setup_token: null,
          setup_token_expires: null,
          status: UserStatus.ACTIVE,
        },
      });
    });

    it('rejects a password that fails the policy', async () => {
      mockedValidatePasswordPolicy.mockReturnValue({ valid: false, errors: ['Password too weak'] });
      await expectHttpError(setupAccount('raw-token', 'weak'), 400, 'Password too weak');
    });

    it('rejects a missing user', async () => {
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });
      mockedHashToken.mockReturnValue('hashed-setup-token');
      mockedUser.findFirst.mockResolvedValue(null);
      await expectHttpError(
        setupAccount('raw-token', 'NewPassword123!'),
        400,
        'Invalid or expired setup token',
      );
    });

    it('rejects an expired setup token', async () => {
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });
      mockedHashToken.mockReturnValue('hashed-setup-token');
      mockedUser.findFirst.mockResolvedValue({
        ...baseUser,
        setup_token: 'hashed-setup-token',
        setup_token_expires: new Date(Date.now() - 1000),
      } as never);
      await expectHttpError(
        setupAccount('raw-token', 'NewPassword123!'),
        400,
        'Invalid or expired setup token',
      );
    });
  });

  describe('inviteUser', () => {
    it('creates a pending-setup user and sends a setup email', async () => {
      mockedUser.findUnique.mockResolvedValue(null);
      mockedGenerateToken.mockReturnValue('setup-raw-token');
      mockedHashToken.mockReturnValue('hashed-setup-token');
      mockedUser.create.mockResolvedValue({} as never);
      mockedSendSetupEmail.mockResolvedValue(undefined);

      await inviteUser({
        email: 'NEW@example.com',
        role: UserRole.EMPLOYEE,
        actorId: 'admin-1',
        actorName: 'Admin',
      });

      expect(mockedUser.create).toHaveBeenCalledWith({
        data: {
          email: 'new@example.com',
          role: UserRole.EMPLOYEE,
          status: UserStatus.PENDING_SETUP,
          setup_token: 'hashed-setup-token',
          setup_token_expires: expect.any(Date),
        },
      });
      expect(mockedSendSetupEmail).toHaveBeenCalledWith('new@example.com', 'setup-raw-token');
    });

    it('connects an employee record when an employeeId is provided', async () => {
      mockedUser.findUnique.mockResolvedValue(null);
      mockedGenerateToken.mockReturnValue('setup-raw-token');
      mockedHashToken.mockReturnValue('hashed-setup-token');
      mockedUser.create.mockResolvedValue({} as never);

      await inviteUser({
        email: 'new@example.com',
        role: UserRole.HR_MANAGER,
        employeeId: 'emp-9',
        actorId: 'admin-1',
        actorName: 'Admin',
      });

      const createCall = mockedUser.create.mock.calls[0][0] as { data: { employee: unknown } };
      expect(createCall.data.employee).toEqual({ connect: { id: 'emp-9' } });
    });

    it('rejects when the email is already registered', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      await expectHttpError(
        inviteUser({
          email: 'john@example.com',
          role: UserRole.EMPLOYEE,
          actorId: 'admin-1',
          actorName: 'Admin',
        }),
        409,
        'User with this email already exists',
      );
    });
  });

  describe('changeUserRole', () => {
    it('updates the user role', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      mockedUser.update.mockResolvedValue({} as never);

      await changeUserRole({ userId: 'user-1', newRole: UserRole.MANAGER, actorId: 'admin-1' });

      expect(mockedUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: UserRole.MANAGER },
      });
    });

    it('rejects changing your own role', async () => {
      await expectHttpError(
        changeUserRole({ userId: 'admin-1', newRole: UserRole.MANAGER, actorId: 'admin-1' }),
        400,
        'You cannot change your own role',
      );
    });

    it('rejects when the user is not found', async () => {
      mockedUser.findUnique.mockResolvedValue(null);
      await expectHttpError(
        changeUserRole({ userId: 'missing', newRole: UserRole.MANAGER, actorId: 'admin-1' }),
        404,
        'User not found',
      );
    });
  });

  describe('changeUserStatus', () => {
    it('updates the user status', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      mockedUser.update.mockResolvedValue({} as never);

      await changeUserStatus({
        userId: 'user-1',
        status: UserStatus.DEACTIVATED,
        actorId: 'admin-1',
      });

      expect(mockedUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.DEACTIVATED },
      });
    });

    it('rejects changing your own status', async () => {
      await expectHttpError(
        changeUserStatus({ userId: 'admin-1', status: UserStatus.DEACTIVATED, actorId: 'admin-1' }),
        400,
        'You cannot deactivate your own account',
      );
    });

    it('rejects when the user is not found', async () => {
      mockedUser.findUnique.mockResolvedValue(null);
      await expectHttpError(
        changeUserStatus({ userId: 'missing', status: UserStatus.ACTIVE, actorId: 'admin-1' }),
        404,
        'User not found',
      );
    });
  });

  describe('adminResetPassword', () => {
    it('resets the password and emails a reset token', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      mockedGenerateToken.mockReturnValue('admin-reset-token');
      mockedHashToken.mockReturnValue('hashed-admin-token');
      mockedUser.update.mockResolvedValue({} as never);
      mockedSendPasswordResetEmail.mockResolvedValue(undefined);

      await adminResetPassword({ userId: 'user-1', actorId: 'admin-1' });

      expect(mockedUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          reset_token: 'hashed-admin-token',
          reset_token_expires: expect.any(Date),
        },
      });
      expect(mockedSendPasswordResetEmail).toHaveBeenCalledWith(
        'john@example.com',
        'admin-reset-token',
      );
    });

    it('rejects when the user is not found', async () => {
      mockedUser.findUnique.mockResolvedValue(null);
      await expectHttpError(
        adminResetPassword({ userId: 'missing', actorId: 'admin-1' }),
        404,
        'User not found',
      );
    });
  });

  describe('deleteUser', () => {
    it('soft-deletes the user and revokes active refresh tokens', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      mockedRefreshToken.updateMany.mockResolvedValue({ count: 1 } as never);
      mockedUser.update.mockResolvedValue({} as never);
      mockedTransaction.mockResolvedValue([]);

      await deleteUser({ userId: 'user-1', actorId: 'admin-1' });

      expect(mockedTransaction).toHaveBeenCalledWith([
        mockedRefreshToken.updateMany({
          where: { user_id: 'user-1', revoked: false },
          data: { revoked: true },
        }),
        mockedUser.update({
          where: { id: 'user-1' },
          data: { deleted_at: expect.any(Date), status: UserStatus.DEACTIVATED },
        }),
      ]);
    });

    it('rejects deleting your own account', async () => {
      await expectHttpError(
        deleteUser({ userId: 'admin-1', actorId: 'admin-1' }),
        400,
        'You cannot delete your own account',
      );
    });

    it('rejects when the user is not found', async () => {
      mockedUser.findUnique.mockResolvedValue(null);
      await expectHttpError(
        deleteUser({ userId: 'missing', actorId: 'admin-1' }),
        404,
        'User not found',
      );
    });

    it('rejects an already-deleted user', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser, deleted_at: new Date() } as never);
      await expectHttpError(
        deleteUser({ userId: 'user-1', actorId: 'admin-1' }),
        404,
        'User not found',
      );
      expect(mockedTransaction).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('changes the password and revokes other sessions when current password is correct', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      mockedVerifyPassword
        // First call: verify current password → true
        .mockResolvedValueOnce(true)
        // Second call: check new !== current → false (new password is different)
        .mockResolvedValueOnce(false);
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });
      mockedHashPassword.mockResolvedValue('new-hash');
      mockedUser.update.mockResolvedValue({} as never);
      mockedRefreshToken.updateMany.mockResolvedValue({ count: 2 } as never);
      mockedLogAuditEvent.mockResolvedValue(undefined);

      await changePassword({
        userId: 'user-1',
        userEmail: 'john@example.com',
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass456@',
        currentFamilyId: 'family-1',
      });

      expect(mockedUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password_hash: 'new-hash' },
      });
      expect(mockedRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', family_id: { not: 'family-1' } },
        data: { revoked: true },
      });
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'UPDATE',
          entity: 'USERS',
          entityId: 'user-1',
        }),
      );
    });

    it('rejects when current password is incorrect', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      mockedVerifyPassword.mockResolvedValueOnce(false);

      await expectHttpError(
        changePassword({
          userId: 'user-1',
          userEmail: 'john@example.com',
          currentPassword: 'WrongPass123!',
          newPassword: 'NewPass456@',
          currentFamilyId: 'family-1',
        }),
        401,
        'Current password is incorrect.',
      );

      expect(mockedUser.update).not.toHaveBeenCalled();
      expect(mockedRefreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when new password fails policy', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      mockedVerifyPassword.mockResolvedValueOnce(true);
      mockedValidatePasswordPolicy.mockReturnValue({
        valid: false,
        errors: ['Password must be at least 8 characters long'],
      });

      await expectHttpError(
        changePassword({
          userId: 'user-1',
          userEmail: 'john@example.com',
          currentPassword: 'OldPass123!',
          newPassword: 'weak',
          currentFamilyId: 'family-1',
        }),
        400,
        'Password must be at least 8 characters long',
      );
    });

    it('rejects when new password is the same as current', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      // First call: verify current password → true
      // Second call: check new !== current → true (new password matches current)
      mockedVerifyPassword.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });

      await expectHttpError(
        changePassword({
          userId: 'user-1',
          userEmail: 'john@example.com',
          currentPassword: 'SamePass123!',
          newPassword: 'SamePass123!',
          currentFamilyId: 'family-1',
        }),
        400,
        'New password must be different from current password.',
      );
    });

    it('revokes all tokens when no current family ID is provided', async () => {
      mockedUser.findUnique.mockResolvedValue({ ...baseUser } as never);
      mockedVerifyPassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      mockedValidatePasswordPolicy.mockReturnValue({ valid: true, errors: [] });
      mockedHashPassword.mockResolvedValue('new-hash');
      mockedUser.update.mockResolvedValue({} as never);
      mockedRefreshToken.updateMany.mockResolvedValue({ count: 3 } as never);
      mockedLogAuditEvent.mockResolvedValue(undefined);

      await changePassword({
        userId: 'user-1',
        userEmail: 'john@example.com',
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass456@',
        currentFamilyId: null,
      });

      expect(mockedRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        data: { revoked: true },
      });
    });

    it('rejects when user is not found', async () => {
      mockedUser.findUnique.mockResolvedValue(null);

      await expectHttpError(
        changePassword({
          userId: 'missing',
          userEmail: 'missing@example.com',
          currentPassword: 'OldPass123!',
          newPassword: 'NewPass456@',
          currentFamilyId: 'family-1',
        }),
        404,
        'User not found',
      );
    });
  });
});
