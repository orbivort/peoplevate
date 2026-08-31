import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { CookieOptions } from 'express';
import { z } from 'zod';
import { loginRateLimiter, passwordChangeRateLimiter } from '../middleware/rate-limiter.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { withAuditContext } from '../utils/audit-context.js';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import * as authService from '../services/auth-service.js';

export const authRoutes: Router = Router();

/**
 * Name of the httpOnly cookie carrying the refresh token. The token is never
 * exposed to client-side JavaScript (XSS mitigation; see CodeQL alert #12).
 */
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Parse a JWT-style duration string (e.g. "15m", "7d") into milliseconds.
 * Used to keep the refresh-token cookie lifetime aligned with the token's
 * `exp` claim from JWT_REFRESH_EXPIRES_IN.
 */
function durationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000; // fall back to 7 days
  const value = Number(match[1]);
  switch (match[2]) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      return value * 24 * 60 * 60 * 1000; // 'd'
  }
}

/** Cookie options for the refresh token. Shared by set and clear calls. */
function refreshTokenCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: durationToMs(env.JWT_REFRESH_EXPIRES_IN),
  };
}

/** Send the refresh token to the client exclusively via an httpOnly cookie. */
function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, refreshTokenCookieOptions());
}

/** Read the refresh token from the httpOnly cookie (or null when absent). */
function getRefreshTokenFromRequest(req: Request): string | undefined {
  return req.cookies?.[REFRESH_TOKEN_COOKIE];
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const resetRequestSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

const setupSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

authRoutes.post(
  '/login',
  loginRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const result = await authService.login(email, password, req.ip);
      // The refresh token is delivered via httpOnly cookie only — never in the
      // JSON body, so client-side JavaScript (and any XSS payload) cannot read it.
      setRefreshTokenCookie(res, result.refreshToken);
      res.json({ accessToken: result.accessToken, user: result.user });
    } catch (err) {
      next(err);
    }
  },
);

authRoutes.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) {
      res.status(401).json({ error: 'Refresh token missing' });
      return;
    }
    const result = await authService.refresh(refreshToken);
    // Rotation: replace the cookie with the newly issued refresh token.
    setRefreshTokenCookie(res, result.refreshToken);
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    res.clearCookie(REFRESH_TOKEN_COOKIE, refreshTokenCookieOptions());
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = resetRequestSchema.parse(req.body);
    await authService.requestPasswordReset(email);
    res.json({ message: 'If the email exists, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    await authService.resetPassword(token, password);
    res.json({ message: 'Password reset successful' });
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = setupSchema.parse(req.body);
    await authService.setupAccount(token, password);
    res.json({ message: 'Account activated successfully' });
  } catch (err) {
    next(err);
  }
});

authRoutes.post(
  '/change-password',
  authenticate,
  passwordChangeRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      const authUser = getAuthUser(req);

      // Look up the current session's refresh token family to preserve it
      const currentToken = await prisma.refreshToken.findFirst({
        where: { user_id: authUser.userId },
        orderBy: { created_at: 'desc' },
        select: { family_id: true },
      });

      await withAuditContext(prisma, authUser.userId, authUser.email, async () => {
        await authService.changePassword({
          userId: authUser.userId,
          userEmail: authUser.email,
          currentPassword,
          newPassword,
          currentFamilyId: currentToken?.family_id ?? null,
        });
      });

      res.json({ message: 'Password changed successfully' });
    } catch (err) {
      next(err);
    }
  },
);
