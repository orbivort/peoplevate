import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { UserRole, UserStatus } from '#prisma';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import * as authService from '../services/auth-service.js';
import { withAuditContext } from '../utils/audit-context.js';
import { getAuthUser } from '../middleware/auth.js';

export const userRoutes: Router = Router();

userRoutes.use(authenticate, requireAdmin);

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
  employeeId: z.string().optional(),
});

const roleChangeSchema = z.object({
  role: z.nativeEnum(UserRole),
});

const statusChangeSchema = z.object({
  status: z.nativeEnum(UserStatus),
});

userRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, role } = req.query as { search?: string; role?: string };

    const where: Record<string, unknown> = { deleted_at: null };
    if (role) {
      where.role = role;
    }
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        {
          employee: {
            OR: [
              { first_name: { contains: search, mode: 'insensitive' } },
              { last_name: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        created_at: true,
        employee: {
          select: { id: true, first_name: true, last_name: true, employee_no: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json({ users });
  } catch (err) {
    next(err);
  }
});

userRoutes.post('/invite', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, role, employeeId } = inviteSchema.parse(req.body);
    const user = getAuthUser(req)!;
    await withAuditContext(prisma, user.userId, user.email, async () => {
      await authService.inviteUser({
        email,
        role,
        employeeId,
        actorId: user.userId,
        actorName: user.email,
      });
    });
    res.status(201).json({ message: 'Invitation sent' });
  } catch (err) {
    next(err);
  }
});

userRoutes.patch('/:id/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role } = roleChangeSchema.parse(req.body);
    const user = getAuthUser(req)!;
    await withAuditContext(prisma, user.userId, user.email, async () => {
      await authService.changeUserRole({
        userId: String(req.params.id),
        newRole: role,
        actorId: user.userId,
      });
    });
    res.json({ message: 'Role updated' });
  } catch (err) {
    next(err);
  }
});

userRoutes.patch('/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = statusChangeSchema.parse(req.body);
    const user = getAuthUser(req)!;
    await withAuditContext(prisma, user.userId, user.email, async () => {
      await authService.changeUserStatus({
        userId: String(req.params.id),
        status,
        actorId: user.userId,
      });
    });
    res.json({ message: 'Status updated' });
  } catch (err) {
    next(err);
  }
});

userRoutes.post('/:id/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    await authService.adminResetPassword({
      userId: String(req.params.id),
      actorId: user.userId,
    });
    res.json({ message: 'Password reset email sent' });
  } catch (err) {
    next(err);
  }
});

userRoutes.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    await authService.deleteUser({
      userId: String(req.params.id),
      actorId: user.userId,
    });
    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});
