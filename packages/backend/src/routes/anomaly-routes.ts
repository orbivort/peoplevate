import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireRoles } from '../middleware/rbac.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { UserRole, AnomalyAlertStatus } from '#prisma';
import { prisma } from '../config/prisma.js';
import { logAuditEvent } from '../services/audit-service.js';

export const anomalyRoutes: Router = Router();

anomalyRoutes.use(authenticate);
anomalyRoutes.use(requireRoles(UserRole.ADMIN));

// GET /api/anomalies - list anomaly alerts
anomalyRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, alertType } = req.query as { status?: AnomalyAlertStatus; alertType?: string };
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (alertType) where.alert_type = alertType;

    const alerts = await prisma.anomalyAlert.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/anomalies/:id/dismiss - dismiss an anomaly alert
anomalyRoutes.patch('/:id/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const { dismissalReason } = req.body as { dismissalReason: string };

    const alert = await prisma.anomalyAlert.update({
      where: { id: String(req.params.id) },
      data: {
        status: AnomalyAlertStatus.DISMISSED,
        reviewed_by_id: user.userId,
        reviewed_at: new Date(),
        dismissal_reason: dismissalReason,
      },
    });

    await logAuditEvent({
      actorId: user.userId,
      actorName: user.email,
      action: 'UPDATE' as never,
      entity: 'ANOMALIES' as never,
      entityId: alert.id,
      newValue: { status: 'DISMISSED', reason: dismissalReason },
    });

    res.json({ alert });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/anomalies/:id/review - mark as reviewed
anomalyRoutes.patch('/:id/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const alert = await prisma.anomalyAlert.update({
      where: { id: String(req.params.id) },
      data: {
        status: AnomalyAlertStatus.REVIEWED,
        reviewed_by_id: user.userId,
        reviewed_at: new Date(),
      },
    });
    res.json({ alert });
  } catch (err) {
    next(err);
  }
});
