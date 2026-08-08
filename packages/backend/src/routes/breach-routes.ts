import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireRoles } from '../middleware/rbac.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import {
  UserRole,
  BreachSeverity,
  BreachContainmentStatus,
  type BreachNotificationType,
} from '#prisma';
import {
  createBreach,
  listBreaches,
  getBreach,
  updateBreach,
  recordBreachNotification,
  generateNotificationTemplate,
} from '../services/breach-service.js';

export const breachRoutes: Router = Router();

breachRoutes.use(authenticate);
breachRoutes.use(requireRoles(UserRole.ADMIN));

// GET /api/breach - list all breaches
breachRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query as { status?: BreachContainmentStatus };
    const breaches = await listBreaches(status);
    res.json({ breaches });
  } catch (err) {
    next(err);
  }
});

// GET /api/breach/:id - get a single breach
breachRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const breach = await getBreach(String(req.params.id));
    res.json({ breach });
  } catch (err) {
    next(err);
  }
});

// POST /api/breach - create a new breach
breachRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const {
      title,
      description,
      detectionAt,
      severity,
      isHighRisk,
      dataCategoriesAffected,
      affectedSubjectsCount,
    } = req.body as {
      title: string;
      description: string;
      detectionAt: string;
      severity: BreachSeverity;
      isHighRisk: boolean;
      dataCategoriesAffected: string[];
      affectedSubjectsCount: number;
    };
    const breach = await createBreach({
      title,
      description,
      detectionAt: new Date(detectionAt),
      severity,
      isHighRisk,
      dataCategoriesAffected,
      affectedSubjectsCount,
      actorId: user.userId,
      actorName: user.email,
    });
    res.status(201).json({ breach });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/breach/:id - update a breach
breachRoutes.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const breach = await updateBreach(String(req.params.id), req.body, user.userId, user.email);
    res.json({ breach });
  } catch (err) {
    next(err);
  }
});

// POST /api/breach/:id/notification - record a notification
breachRoutes.post('/:id/notification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const { notificationType, method, reference } = req.body as {
      notificationType: BreachNotificationType;
      method: string;
      reference?: string;
    };
    const notification = await recordBreachNotification(
      String(req.params.id),
      { notificationType, method, reference: reference ?? undefined },
      user.userId,
      user.email,
    );
    res.status(201).json({ notification });
  } catch (err) {
    next(err);
  }
});

// GET /api/breach/:id/template - generate a notification template
breachRoutes.get('/:id/template', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const breach = await getBreach(String(req.params.id));
    const template = generateNotificationTemplate(breach);
    res.json({ template });
  } catch (err) {
    next(err);
  }
});
