import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';

// Mock the auth service before importing the routes so the service's Prisma
// dependencies are never touched.
vi.mock('../services/auth-service.js', () => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  setupAccount: vi.fn(),
  changePassword: vi.fn(),
}));

// The login rate limiter guards the /login route; a pass-through keeps tests
// fast and focused on route logic rather than the limiter itself.
vi.mock('../middleware/rate-limiter.js', () => ({
  loginRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  passwordChangeRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock authenticate middleware to simulate authenticated requests
vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: Request, _res: Response, next: NextFunction) => next(),
  getAuthUser: (req: Request) =>
    (req as { user?: { userId: string; email: string; role: string } }).user,
}));

// Mock audit context to pass through
vi.mock('../utils/audit-context.js', () => ({
  withAuditContext: vi.fn(
    (_prisma: unknown, _actorId: string, _actorName: string, cb: () => unknown) => cb(),
  ),
}));

// Also mock withAuditContext for the change-password route which uses the
// (prisma, actorId, actorName, fn) signature — same mock works for both.

// Mock prisma to avoid real DB calls
vi.mock('../config/prisma.js', () => ({
  prisma: {
    refreshToken: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

import * as authService from '../services/auth-service.js';
import { authRoutes } from './auth-routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import { prisma } from '../config/prisma.js';
import { withAuditContext } from '../utils/audit-context.js';

const mockedLogin = vi.mocked(authService.login);
const mockedRefresh = vi.mocked(authService.refresh);
const mockedLogout = vi.mocked(authService.logout);
const mockedRequestPasswordReset = vi.mocked(authService.requestPasswordReset);
const mockedResetPassword = vi.mocked(authService.resetPassword);
const mockedSetupAccount = vi.mocked(authService.setupAccount);
const mockedChangePassword = vi.mocked(authService.changePassword);

// Build a minimal app that mirrors how authRoutes is mounted in app.ts.
function buildApp() {
  const app = express();
  app.use(express.json());
  // Cookie parsing is required so the refresh-token cookie reaches the routes.
  // codeql[js/missing-token-validation] Test-only supertest harness (no real
  // server or users); production CSRF risk is mitigated because the refresh
  // cookie is SameSite=strict/httpOnly, so cross-site requests never carry it.
  app.use(cookieParser());
  // Set a mock authenticated user on the request for routes that use getAuthUser
  app.use((req, _res, next) => {
    (req as { user?: unknown }).user = {
      userId: 'user-1',
      email: 'john@example.com',
      role: 'EMPLOYEE',
    };
    next();
  });
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  return app;
}

const authResult = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: { id: 'user-1', email: 'john@example.com', role: 'EMPLOYEE', employeeId: 'emp-1' },
};

describe('authRoutes', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedLogin.mockResolvedValue(authResult);
    mockedRefresh.mockResolvedValue(authResult);
    mockedLogout.mockResolvedValue(undefined);
    mockedRequestPasswordReset.mockResolvedValue(undefined);
    mockedResetPassword.mockResolvedValue(undefined);
    mockedSetupAccount.mockResolvedValue(undefined);
    mockedChangePassword.mockResolvedValue(undefined);
    // Re-set prisma mock after clearAllMocks
    vi.mocked(prisma.refreshToken.findFirst).mockResolvedValue(null);
    // Re-set withAuditContext mock after clearAllMocks
    vi.mocked(withAuditContext).mockImplementation(
      (_prisma: unknown, _actorId: string, _actorName: string, cb: () => unknown) => cb(),
    );
  });

  describe('POST /api/auth/login', () => {
    it('returns the access token and user, and sets the refresh token cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@example.com', password: 'secret' });

      expect(res.status).toBe(200);
      // The refresh token must never appear in the JSON body (XSS mitigation).
      expect(res.body).toEqual({ accessToken: 'access-token', user: authResult.user });
      expect(res.body.refreshToken).toBeUndefined();
      // The login route forwards the client IP for failed-login anomaly detection.
      expect(mockedLogin).toHaveBeenCalledWith('john@example.com', 'secret', expect.any(String));
    });

    it('delivers the refresh token via an httpOnly SameSite cookie scoped to /api/auth', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@example.com', password: 'secret' });

      const cookieHeader = res.headers['set-cookie'];
      expect(cookieHeader).toBeDefined();
      const cookie = String(cookieHeader[0]);
      expect(cookie).toContain('refresh_token=refresh-token');
      expect(cookie.toLowerCase()).toContain('httponly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/auth');
    });

    it('rejects a request with an invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'not-an-email', password: 'secret' });

      expect(res.status).toBe(400);
      expect(mockedLogin).not.toHaveBeenCalled();
    });

    it('rejects a request with an empty password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@example.com', password: '' });

      expect(res.status).toBe(400);
      expect(mockedLogin).not.toHaveBeenCalled();
    });

    it('forwards service errors to the error handler', async () => {
      mockedLogin.mockRejectedValue(
        Object.assign(new Error('Invalid email or password'), { status: 401 }),
      );

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@example.com', password: 'wrong' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('returns a new access token for a valid refresh-token cookie', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=some-refresh-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ accessToken: 'access-token', user: authResult.user });
      expect(res.body.refreshToken).toBeUndefined();
      expect(mockedRefresh).toHaveBeenCalledWith('some-refresh-token');
    });

    it('rotates the refresh token via a new Set-Cookie header', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=some-refresh-token');

      const cookieHeader = res.headers['set-cookie'];
      expect(cookieHeader).toBeDefined();
      expect(String(cookieHeader[0])).toContain('refresh_token=refresh-token');
    });

    it('returns 401 when the refresh-token cookie is missing', async () => {
      const res = await request(app).post('/api/auth/refresh');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Refresh token missing' });
      expect(mockedRefresh).not.toHaveBeenCalled();
    });

    it('forwards service errors to the error handler', async () => {
      mockedRefresh.mockRejectedValue(
        Object.assign(new Error('Invalid refresh token'), { status: 401 }),
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=expired-token');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the refresh token from the cookie and clears the cookie', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', 'refresh_token=token-to-revoke');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Logged out' });
      expect(mockedLogout).toHaveBeenCalledWith('token-to-revoke');
      // The cookie is cleared (empty value + expired).
      const cookie = String(res.headers['set-cookie'][0]);
      expect(cookie).toContain('refresh_token=;');
    });

    it('still succeeds when no refresh-token cookie is provided', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Logged out' });
      expect(mockedLogout).not.toHaveBeenCalled();
    });

    it('forwards service errors to the error handler', async () => {
      mockedLogout.mockRejectedValue(Object.assign(new Error('Boom'), { status: 500 }));

      const res = await request(app).post('/api/auth/logout').set('Cookie', 'refresh_token=token');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('returns a generic message and triggers a reset request', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'john@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'If the email exists, a reset link has been sent.' });
      expect(mockedRequestPasswordReset).toHaveBeenCalledWith('john@example.com');
    });

    it('rejects an invalid email', async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nope' });

      expect(res.status).toBe(400);
      expect(mockedRequestPasswordReset).not.toHaveBeenCalled();
    });

    it('forwards service errors to the error handler', async () => {
      mockedRequestPasswordReset.mockRejectedValue(
        Object.assign(new Error('Boom'), { status: 500 }),
      );

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'john@example.com' });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('resets the password and returns a success message', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'reset-token', password: 'NewPassword123!' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Password reset successful' });
      expect(mockedResetPassword).toHaveBeenCalledWith('reset-token', 'NewPassword123!');
    });

    it('rejects a request missing the token', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ password: 'NewPassword123!' });

      expect(res.status).toBe(400);
      expect(mockedResetPassword).not.toHaveBeenCalled();
    });

    it('rejects a request with an empty password', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'reset-token', password: '' });

      expect(res.status).toBe(400);
      expect(mockedResetPassword).not.toHaveBeenCalled();
    });

    it('forwards service errors to the error handler', async () => {
      mockedResetPassword.mockRejectedValue(
        Object.assign(new Error('Invalid or expired reset token'), { status: 400 }),
      );

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'bad-token', password: 'NewPassword123!' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/setup', () => {
    it('activates the account and returns a success message', async () => {
      const res = await request(app)
        .post('/api/auth/setup')
        .send({ token: 'setup-token', password: 'NewPassword123!' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Account activated successfully' });
      expect(mockedSetupAccount).toHaveBeenCalledWith('setup-token', 'NewPassword123!');
    });

    it('rejects a request missing the token', async () => {
      const res = await request(app).post('/api/auth/setup').send({ password: 'NewPassword123!' });

      expect(res.status).toBe(400);
      expect(mockedSetupAccount).not.toHaveBeenCalled();
    });

    it('rejects a request with an empty password', async () => {
      const res = await request(app)
        .post('/api/auth/setup')
        .send({ token: 'setup-token', password: '' });

      expect(res.status).toBe(400);
      expect(mockedSetupAccount).not.toHaveBeenCalled();
    });

    it('forwards service errors to the error handler', async () => {
      mockedSetupAccount.mockRejectedValue(
        Object.assign(new Error('Invalid or expired setup token'), { status: 400 }),
      );

      const res = await request(app)
        .post('/api/auth/setup')
        .send({ token: 'bad-token', password: 'NewPassword123!' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('changes the password and returns a success message', async () => {
      mockedChangePassword.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'OldPass123!', newPassword: 'NewPass456@' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Password changed successfully' });
      expect(mockedChangePassword).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          userEmail: 'john@example.com',
          currentPassword: 'OldPass123!',
          newPassword: 'NewPass456@',
        }),
      );
    });

    it('rejects a request missing currentPassword', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ newPassword: 'NewPass456@' });

      expect(res.status).toBe(400);
      expect(mockedChangePassword).not.toHaveBeenCalled();
    });

    it('rejects a request missing newPassword', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'OldPass123!' });

      expect(res.status).toBe(400);
      expect(mockedChangePassword).not.toHaveBeenCalled();
    });

    it('forwards 401 error when current password is wrong', async () => {
      mockedChangePassword.mockRejectedValue(
        Object.assign(new Error('Current password is incorrect.'), { status: 401 }),
      );

      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'WrongPass', newPassword: 'NewPass456@' });

      expect(res.status).toBe(401);
    });

    it('forwards 400 error when new password fails policy', async () => {
      mockedChangePassword.mockRejectedValue(
        Object.assign(new Error('Password must be at least 8 characters'), { status: 400 }),
      );

      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'OldPass123!', newPassword: 'weak' });

      expect(res.status).toBe(400);
    });
  });
});
