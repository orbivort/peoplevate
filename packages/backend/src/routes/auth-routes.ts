import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { loginRateLimiter, passwordChangeRateLimiter } from '../middleware/rate-limiter.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { withAuditContext } from '../utils/audit-context.js';
import { prisma } from '../config/prisma.js';
import * as authService from '../services/auth-service.js';

export const authRoutes: Router = Router();

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
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

authRoutes.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token required' });
      return;
    }
    const result = await authService.refresh(refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
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
