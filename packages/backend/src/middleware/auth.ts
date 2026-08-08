import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/token.js';
import { prisma } from '../config/prisma.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    role: string;
    email: string;
    employeeId?: string | null;
  };
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.slice(7);
  const decoded = verifyJwt(token);
  if (!decoded) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      employee: { select: { id: true } },
    },
  });

  if (!user || user.status !== 'ACTIVE') {
    res.status(401).json({ error: 'Account is not active' });
    return;
  }

  (req as AuthenticatedRequest).user = {
    userId: user.id,
    role: user.role,
    email: user.email,
    employeeId: user.employee?.id ?? null,
  };

  next();
};

export function getAuthUser(req: Request): NonNullable<AuthenticatedRequest['user']> {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    throw new Error('Authenticated user not found. Ensure the authenticate middleware is applied.');
  }
  return user;
}
