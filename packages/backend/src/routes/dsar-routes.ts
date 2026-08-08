import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { UserRole, type DsarType, type DsarStatus } from '#prisma';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { logAuditEvent } from '../services/audit-service.js';

export const dsarRoutes: Router = Router();

dsarRoutes.use(authenticate);

// POST /api/dsar - submit a DSAR (self or Admin/HR on behalf)
dsarRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const { requestType, dataSubjectEmail, description } = req.body as {
      requestType: DsarType;
      dataSubjectEmail: string;
      description?: string;
    };

    const dsar = await prisma.dataSubjectAccessRequest.create({
      data: {
        request_type: requestType,
        status: 'PENDING_VERIFICATION' as DsarStatus,
        data_subject_user_id: user.userId,
        data_subject_email: dataSubjectEmail,
        description: description ?? null,
      },
    });

    await logAuditEvent({
      actorId: user.userId,
      actorName: user.email,
      action: 'DSAR' as never,
      entity: 'DATA_SUBJECT_RIGHTS' as never,
      entityId: dsar.id,
      newValue: { requestType, status: 'PENDING_VERIFICATION' },
    });

    res.status(201).json({ dsar });
  } catch (err) {
    next(err);
  }
});

// GET /api/dsar - list DSARs (Admin/HR see all; self sees own only)
dsarRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const { status } = req.query as { status?: DsarStatus };

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HR_MANAGER) {
      where.data_subject_user_id = user.userId;
    }

    const dsars = await prisma.dataSubjectAccessRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    res.json({ dsars });
  } catch (err) {
    next(err);
  }
});

// GET /api/dsar/:id - get a single DSAR
dsarRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const dsar = await prisma.dataSubjectAccessRequest.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!dsar) {
      res.status(404).json({ error: 'DSAR not found' });
      return;
    }
    if (
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.HR_MANAGER &&
      dsar.data_subject_user_id !== user.userId
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    res.json({ dsar });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dsar/:id/status - update DSAR status (Admin/HR only)
dsarRoutes.patch(
  '/:id/status',
  requireRoles(UserRole.ADMIN, UserRole.HR_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req)!;
      const { status, rejectionReason, assignedToId } = req.body as {
        status: DsarStatus;
        rejectionReason?: string;
        assignedToId?: string;
      };

      const existing = await prisma.dataSubjectAccessRequest.findUnique({
        where: { id: String(req.params.id) },
      });
      if (!existing) {
        res.status(404).json({ error: 'DSAR not found' });
        return;
      }

      const updates: Record<string, unknown> = { status };
      const now = new Date();

      if (status === 'VERIFIED' && existing.status === 'PENDING_VERIFICATION') {
        updates.identity_verified_by_id = user.userId;
        updates.identity_verified_at = now;
        updates.verified_at = now;
        updates.sla_deadline = new Date(now.getTime() + env.DSAR_SLA_DAYS * 24 * 60 * 60 * 1000);
        if (assignedToId) updates.assigned_to_id = assignedToId;
      }
      if (status === 'IN_PROGRESS' && existing.status === 'VERIFIED') {
        // No special fields, just status transition
      }
      if (status === 'COMPLETED') {
        updates.completed_at = now;
      }
      if (status === 'REJECTED' && rejectionReason) {
        updates.rejection_reason = rejectionReason;
      }

      const dsar = await prisma.dataSubjectAccessRequest.update({
        where: { id: String(req.params.id) },
        data: updates,
      });

      await logAuditEvent({
        actorId: user.userId,
        actorName: user.email,
        action: 'DSAR' as never,
        entity: 'DATA_SUBJECT_RIGHTS' as never,
        entityId: dsar.id,
        newValue: { status, previousStatus: existing.status },
      });

      res.json({ dsar });
    } catch (err) {
      next(err);
    }
  },
);

/** Check DSAR SLA and send reminders/escalations. Called by cron. */
export async function checkDsarSla(): Promise<void> {
  const now = new Date();
  const reminderDate = new Date(
    now.getTime() + (env.DSAR_SLA_DAYS - env.DSAR_REMINDER_DAYS) * 24 * 60 * 60 * 1000,
  );

  // Send reminders for DSARs approaching deadline
  const approaching = await prisma.dataSubjectAccessRequest.findMany({
    where: {
      status: { in: ['VERIFIED', 'IN_PROGRESS'] },
      sla_deadline: { lte: reminderDate, gt: now },
    },
  });
  // In a real system, send emails here. For now, log.
  if (approaching.length > 0) {
    console.log(`[DSAR SLA] ${approaching.length} DSAR(s) approaching deadline`);
  }

  // Flag overdue DSARs
  const overdue = await prisma.dataSubjectAccessRequest.findMany({
    where: {
      status: { in: ['VERIFIED', 'IN_PROGRESS'] },
      sla_deadline: { lt: now },
    },
  });
  if (overdue.length > 0) {
    console.log(
      `[DSAR SLA] ${overdue.length} DSAR(s) overdue - escalating to DPO: ${env.DPO_CONTACT_EMAIL}`,
    );
  }
}
