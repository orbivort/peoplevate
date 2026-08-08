import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireRoles } from '../middleware/rbac.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { UserRole } from '#prisma';
import {
  listKeyVersions,
  rotateKey,
  getKeyRotationStatus,
} from '../services/key-management-service.js';

export const keyManagementRoutes: Router = Router();

keyManagementRoutes.use(authenticate);

// GET /api/keys - list all key versions (Admin only)
keyManagementRoutes.get(
  '/',
  requireRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { purpose } = req.query as Record<string, string | undefined>;
      const versions = await listKeyVersions(
        purpose ? (purpose as 'DATA_ENCRYPTION' | 'TOKEN_SIGNING') : undefined,
      );
      res.json({ versions });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/keys/status - get rotation status per purpose (Admin only)
keyManagementRoutes.get(
  '/status',
  requireRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { purpose } = req.query as Record<string, string | undefined>;
      const purposes = purpose
        ? [purpose as 'DATA_ENCRYPTION' | 'TOKEN_SIGNING']
        : ['DATA_ENCRYPTION', 'TOKEN_SIGNING'];
      const statuses = await Promise.all(
        purposes.map((p) => getKeyRotationStatus(p as 'DATA_ENCRYPTION' | 'TOKEN_SIGNING')),
      );
      res.json({ statuses });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/keys/rotate - rotate the key for a purpose (Admin only)
keyManagementRoutes.post(
  '/rotate',
  requireRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { purpose } = req.body as { purpose: 'DATA_ENCRYPTION' | 'TOKEN_SIGNING' };
      if (!purpose || !['DATA_ENCRYPTION', 'TOKEN_SIGNING'].includes(purpose)) {
        return res
          .status(400)
          .json({ error: 'Invalid purpose. Must be DATA_ENCRYPTION or TOKEN_SIGNING.' });
      }
      const user = getAuthUser(req)!;
      const newVersion = await rotateKey(purpose, user.userId, user.email);
      res.status(201).json({
        message:
          'Key rotated successfully. Update the corresponding env var and run the re-encryption script.',
        newVersion,
      });
    } catch (err) {
      next(err);
    }
  },
);
