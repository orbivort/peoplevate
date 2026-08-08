import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { hashPassword, verifyPassword, validatePasswordPolicy } from '../utils/password.js';
import {
  generateToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyJwt,
  addHours,
} from '../utils/token.js';
import { logLogin, logLogout, logAuditEvent } from './audit-service.js';
import { checkFailedLoginSpike } from './breach-service.js';
import {
  sendSetupEmail,
  sendPasswordResetEmail,
  sendLockoutNotification,
} from './email-service.js';
import { HttpError } from '../utils/http-error.js';
import { UserRole, UserStatus, AuditAction, AuditEntity } from '#prisma';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: string; employeeId: string | null };
}

/** Normalize a request IP to a stable identifier used for anomaly tracking. */
function normalizeIp(ip?: string): string | null {
  if (!ip) return null;
  // `req.ip` may be "::ffff:1.2.3.4" (IPv4-mapped IPv6). Strip the prefix so
  // the same client always maps to the same key regardless of representation.
  const cleaned = ip.replace(/^::ffff:/, '');
  return cleaned === '::1' ? '127.0.0.1' : cleaned;
}

export async function login(
  email: string,
  password: string,
  ipAddress?: string,
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { employee: { select: { id: true } } },
  });

  if (!user || user.deleted_at || user.status === UserStatus.DEACTIVATED) {
    throw new HttpError(401, 'Invalid email or password');
  }

  // Check lockout
  if (user.locked_until && user.locked_until > new Date()) {
    throw new HttpError(423, 'Account is locked. Try again later or contact HR.');
  }

  if (user.status === UserStatus.PENDING_SETUP) {
    throw new HttpError(
      403,
      'Please set up your password first. Check your email for the setup link.',
    );
  }

  if (!user.password_hash) {
    throw new HttpError(401, 'Invalid email or password');
  }

  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    const newCount = user.failed_login_count + 1;
    const shouldLock = newCount >= env.ACCOUNT_LOCKOUT_THRESHOLD;
    const lockedUntil = shouldLock ? addMinutes(env.ACCOUNT_LOCKOUT_DURATION_MIN) : null;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failed_login_count: newCount,
        locked_until: lockedUntil,
      },
    });

    // Record the failed attempt and feed the failed-login-spike detector. The IP
    // is stored on the audit record's entity_id so checkFailedLoginSpike can count
    // attempts per source IP within its detection window (GDPR Art. 32 breach awareness).
    const ip = normalizeIp(ipAddress);
    if (ip) {
      await logAuditEvent({
        actorId: null,
        actorName: null,
        action: AuditAction.LOGIN,
        entity: AuditEntity.AUTH,
        entityId: ip,
        newValue: { outcome: 'FAILED', reason: shouldLock ? 'ACCOUNT_LOCKED' : 'BAD_CREDENTIALS' },
      });
      await checkFailedLoginSpike(ip);
    }

    if (shouldLock) {
      await sendLockoutNotification(user.email);
      throw new HttpError(423, 'Account is locked. Try again later or contact HR.');
    }

    throw new HttpError(401, 'Invalid email or password');
  }

  // Reset failed login count on success
  await prisma.user.update({
    where: { id: user.id },
    data: { failed_login_count: 0, locked_until: null },
  });

  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  const refreshToken = await issueRefreshToken(user.id, user.role);

  await logLogin(user.id, user.email);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employee?.id ?? null,
    },
  };
}

export async function refresh(refreshToken: string): Promise<AuthResult> {
  const decoded = verifyJwt(refreshToken);
  if (!decoded) {
    throw new HttpError(401, 'Invalid refresh token');
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { token_hash: tokenHash },
    include: { user: { include: { employee: { select: { id: true } } } } },
  });

  // Token reuse detected → revoke entire family
  if (!stored || stored.revoked || stored.expires_at < new Date()) {
    if (stored && !stored.revoked) {
      await prisma.refreshToken.updateMany({
        where: { family_id: stored.family_id },
        data: { revoked: true },
      });
    }
    throw new HttpError(401, 'Invalid refresh token');
  }

  // Rotate: revoke old token, issue new one in same family
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revoked: true },
  });

  const user = stored.user;
  if (user.status !== UserStatus.ACTIVE) {
    throw new HttpError(401, 'Account is not active');
  }

  const newAccessToken = signAccessToken({ userId: user.id, role: user.role });
  const newRefreshToken = await issueRefreshToken(user.id, user.role, stored.family_id);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employee?.id ?? null,
    },
  };
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { token_hash: tokenHash } });
  if (stored) {
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });
    const user = await prisma.user.findUnique({ where: { id: stored.user_id } });
    if (user) {
      await logLogout(user.id, user.email);
    }
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || user.deleted_at) {
    // Don't reveal that the email doesn't exist
    return;
  }

  const resetToken = generateToken();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      reset_token: hashToken(resetToken),
      reset_token_expires: addHours(env.PASSWORD_RESET_TOKEN_EXPIRY_HOURS),
    },
  });

  await sendPasswordResetEmail(user.email, resetToken);
}

export async function resetPassword(resetToken: string, newPassword: string): Promise<void> {
  const { valid, errors } = validatePasswordPolicy(newPassword);
  if (!valid) {
    throw new HttpError(400, errors.join('; '));
  }

  const tokenHash = hashToken(resetToken);
  const user = await prisma.user.findFirst({
    where: { reset_token: tokenHash },
  });

  if (!user || !user.reset_token_expires || user.reset_token_expires < new Date()) {
    throw new HttpError(400, 'Invalid or expired reset token');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password_hash: await hashPassword(newPassword),
      reset_token: null,
      reset_token_expires: null,
      failed_login_count: 0,
      locked_until: null,
    },
  });
}

export async function setupAccount(setupToken: string, password: string): Promise<void> {
  const { valid, errors } = validatePasswordPolicy(password);
  if (!valid) {
    throw new HttpError(400, errors.join('; '));
  }

  const tokenHash = hashToken(setupToken);
  const user = await prisma.user.findFirst({
    where: { setup_token: tokenHash },
  });

  if (!user || !user.setup_token_expires || user.setup_token_expires < new Date()) {
    throw new HttpError(400, 'Invalid or expired setup token');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password_hash: await hashPassword(password),
      setup_token: null,
      setup_token_expires: null,
      status: UserStatus.ACTIVE,
    },
  });
}

// ── Self-Service Password Change ─────────────

export async function changePassword(params: {
  userId: string;
  userEmail: string;
  currentPassword: string;
  newPassword: string;
  currentFamilyId?: string | null;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true, password_hash: true },
  });

  if (!user || !user.password_hash) {
    throw new HttpError(404, 'User not found');
  }

  // Verify current password
  const valid = await verifyPassword(user.password_hash, params.currentPassword);
  if (!valid) {
    throw new HttpError(401, 'Current password is incorrect.');
  }

  // Validate new password policy
  const { valid: policyValid, errors } = validatePasswordPolicy(params.newPassword);
  if (!policyValid) {
    throw new HttpError(400, errors.join('; '));
  }

  // New password must differ from current
  const sameAsCurrent = await verifyPassword(user.password_hash, params.newPassword);
  if (sameAsCurrent) {
    throw new HttpError(400, 'New password must be different from current password.');
  }

  // Hash and update
  const newHash = await hashPassword(params.newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { password_hash: newHash },
  });

  // Revoke all refresh tokens except the current session's family
  if (params.currentFamilyId) {
    await prisma.refreshToken.updateMany({
      where: { user_id: user.id, family_id: { not: params.currentFamilyId } },
      data: { revoked: true },
    });
  } else {
    await prisma.refreshToken.updateMany({
      where: { user_id: user.id },
      data: { revoked: true },
    });
  }

  // Audit log — do NOT store old/new password values
  await logAuditEvent({
    actorId: user.id,
    actorName: user.email,
    action: AuditAction.UPDATE,
    entity: AuditEntity.USERS,
    entityId: user.id,
    oldValue: { field: 'password' },
    newValue: { field: 'password' },
  });
}

// ── User Management (Admin) ──────────────────

export async function inviteUser(params: {
  email: string;
  role: UserRole;
  employeeId?: string | undefined;
  actorId: string;
  actorName: string;
}): Promise<void> {
  const email = params.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new HttpError(409, 'User with this email already exists');
  }

  const setupToken = generateToken();
  await prisma.user.create({
    data: {
      email,
      role: params.role,
      status: UserStatus.PENDING_SETUP,
      ...(params.employeeId ? { employee: { connect: { id: params.employeeId } } } : {}),
      setup_token: hashToken(setupToken),
      setup_token_expires: addHours(env.SETUP_TOKEN_EXPIRY_HOURS),
    },
  });

  await sendSetupEmail(email, setupToken);
}

export async function changeUserRole(params: {
  userId: string;
  newRole: UserRole;
  actorId: string;
}): Promise<void> {
  if (params.userId === params.actorId) {
    throw new HttpError(400, 'You cannot change your own role');
  }

  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  await prisma.user.update({
    where: { id: params.userId },
    data: { role: params.newRole },
  });
}

export async function changeUserStatus(params: {
  userId: string;
  status: UserStatus;
  actorId: string;
}): Promise<void> {
  if (params.userId === params.actorId) {
    throw new HttpError(400, 'You cannot deactivate your own account');
  }

  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  await prisma.user.update({
    where: { id: params.userId },
    data: { status: params.status },
  });
}

export async function adminResetPassword(params: {
  userId: string;
  actorId: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  const resetToken = generateToken();
  await prisma.user.update({
    where: { id: params.userId },
    data: {
      reset_token: hashToken(resetToken),
      reset_token_expires: addHours(env.PASSWORD_RESET_TOKEN_EXPIRY_HOURS),
    },
  });

  await sendPasswordResetEmail(user.email, resetToken);
}

export async function deleteUser(params: { userId: string; actorId: string }): Promise<void> {
  if (params.userId === params.actorId) {
    throw new HttpError(400, 'You cannot delete your own account');
  }

  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) {
    throw new HttpError(404, 'User not found');
  }
  if (user.deleted_at) {
    throw new HttpError(404, 'User not found');
  }

  // Soft delete: mark the record deleted and revoke active refresh tokens so
  // the account can no longer authenticate.
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { user_id: params.userId, revoked: false },
      data: { revoked: true },
    }),
    prisma.user.update({
      where: { id: params.userId },
      data: { deleted_at: new Date(), status: UserStatus.DEACTIVATED },
    }),
  ]);
}

// ── Helpers ──────────────────────────────────

async function issueRefreshToken(userId: string, role: string, familyId?: string): Promise<string> {
  // The refresh token is a signed JWT (so the refresh flow can verify it) whose
  // hash is stored server-side for rotation and reuse detection.
  const token = signRefreshToken({ userId, role });
  const family = familyId ?? generateToken(16);
  await prisma.refreshToken.create({
    data: {
      user_id: userId,
      token_hash: hashToken(token),
      family_id: family,
      expires_at: addDays(7),
    },
  });
  return token;
}

function addMinutes(minutes: number): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
