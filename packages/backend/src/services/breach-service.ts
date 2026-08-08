import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { logAuditEvent } from './audit-service.js';
import { BreachSeverity, BreachContainmentStatus, type BreachNotificationType } from '#prisma';

/**
 * Breach Notification Service
 *
 * Manages the personal-data breach register, 72-hour supervisory-authority
 * escalation tracking, and notification templates.
 */

/** Create a new breach record with auto-computed 72-hour deadline. */
export async function createBreach(params: {
  title: string;
  description: string;
  detectionAt: Date;
  severity: BreachSeverity;
  isHighRisk: boolean;
  dataCategoriesAffected: string[];
  affectedSubjectsCount: number;
  actorId: string;
  actorName: string;
}) {
  const saDeadline = new Date(params.detectionAt.getTime() + 72 * 60 * 60 * 1000);

  const breach = await prisma.dataBreach.create({
    data: {
      title: params.title,
      description: params.description,
      detection_at: params.detectionAt,
      severity: params.severity,
      is_high_risk: params.isHighRisk,
      data_categories_affected: params.dataCategoriesAffected,
      affected_subjects_count: params.affectedSubjectsCount,
      sa_notification_deadline: saDeadline,
      created_by_id: params.actorId,
    },
  });

  await logAuditEvent({
    actorId: params.actorId,
    actorName: params.actorName,
    action: 'CREATE' as never,
    entity: 'BREACH' as never,
    entityId: breach.id,
    newValue: { title: breach.title, severity: breach.severity },
  });

  return breach;
}

/** List all breaches. */
export async function listBreaches(containmentStatus?: BreachContainmentStatus) {
  return prisma.dataBreach.findMany({
    where: containmentStatus ? { containment_status: containmentStatus } : {},
    include: { notifications: true },
    orderBy: { detection_at: 'desc' },
  });
}

/** Get a single breach with notifications. */
export async function getBreach(breachId: string) {
  const breach = await prisma.dataBreach.findUnique({
    where: { id: breachId },
    include: { notifications: true },
  });
  if (!breach) {
    throw new HttpError(404, 'Breach not found');
  }
  return breach;
}

/** Update a breach record. */
export async function updateBreach(
  breachId: string,
  updates: {
    title?: string;
    description?: string;
    containmentStatus?: BreachContainmentStatus;
    rootCause?: string;
    resolution?: string;
    isHighRisk?: boolean;
    subjectNotificationPlan?: string;
  },
  actorId: string,
  actorName: string,
) {
  // High-risk breaches require a notification plan before closing
  if (updates.containmentStatus === BreachContainmentStatus.CLOSED) {
    const existing = await getBreach(breachId);
    if (
      existing.is_high_risk &&
      !existing.subject_notification_plan &&
      !updates.subjectNotificationPlan
    ) {
      throw new HttpError(
        400,
        'High-risk breaches require a data-subject notification plan before closing',
      );
    }
  }

  const breach = await prisma.dataBreach.update({
    where: { id: breachId },
    data: updates,
  });

  await logAuditEvent({
    actorId,
    actorName,
    action: 'UPDATE' as never,
    entity: 'BREACH' as never,
    entityId: breachId,
    newValue: updates,
  });

  return breach;
}

/** Record a supervisory-authority or data-subject notification. */
export async function recordBreachNotification(
  breachId: string,
  params: {
    notificationType: BreachNotificationType;
    method: string;
    reference?: string | undefined;
  },
  actorId: string,
  actorName: string,
) {
  const notification = await prisma.dataBreachNotification.create({
    data: {
      breach_id: breachId,
      notification_type: params.notificationType,
      method: params.method,
      reference: params.reference ?? null,
      created_by_id: actorId,
    },
  });

  // If SA notification, record the timestamp on the breach
  if (params.notificationType === 'SUPERVISORY_AUTHORITY') {
    await prisma.dataBreach.update({
      where: { id: breachId },
      data: {
        sa_notified_at: new Date(),
        sa_notification_method: params.method,
        sa_notification_reference: params.reference ?? null,
      },
    });
  } else {
    await prisma.dataBreach.update({
      where: { id: breachId },
      data: { subject_notified_at: new Date() },
    });
  }

  await logAuditEvent({
    actorId,
    actorName,
    action: 'CREATE' as never,
    entity: 'BREACH' as never,
    entityId: breachId,
    newValue: { notificationType: params.notificationType, method: params.method },
  });

  return notification;
}

/** Generate a notification template pre-populated with GDPR-required fields. */
export function generateNotificationTemplate(breach: {
  title: string;
  description: string;
  detection_at: Date;
  data_categories_affected: string[];
  affected_subjects_count: number;
  severity: string;
  containment_status: string;
  root_cause: string | null;
  resolution: string | null;
}) {
  return {
    nature: breach.title,
    description: breach.description,
    detectionTime: breach.detection_at.toISOString(),
    dataCategoriesAffected: breach.data_categories_affected,
    approximateRecordsAffected: breach.affected_subjects_count,
    severity: breach.severity,
    likelyConsequences: 'Potential unauthorized access to personal data of affected individuals.',
    measuresTaken: breach.resolution || breach.containment_status,
    rootCause: breach.root_cause || 'Under investigation',
  };
}

/** Check breach escalation: send alerts before deadline, flag overdue. Called by cron. */
export async function checkBreachEscalations(): Promise<void> {
  const now = new Date();
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Breaches approaching deadline (< 24h remaining, not yet notified)
  const approaching = await prisma.dataBreach.findMany({
    where: {
      sa_notified_at: null,
      sa_notification_deadline: { lte: twentyFourHoursFromNow, gt: now },
    },
  });
  for (const breach of approaching) {
    console.log(
      `[BREACH ESCALATION] Breach "${breach.title}" - less than 24h to SA notification deadline. ` +
        `Escalating to DPO: ${env.DPO_CONTACT_EMAIL}`,
    );
  }

  // Overdue breaches (deadline passed, not notified)
  const overdue = await prisma.dataBreach.findMany({
    where: {
      sa_notified_at: null,
      sa_notification_deadline: { lt: now },
    },
  });
  for (const breach of overdue) {
    console.log(
      `[BREACH OVERDUE] Breach "${breach.title}" - SA notification deadline PASSED. ` +
        `Escalating to DPO: ${env.DPO_CONTACT_EMAIL}`,
    );
  }
}

// ──────────────────────────────────────────────
// Anomaly Detection
// ──────────────────────────────────────────────

/** Check for failed-login spikes and create anomaly alerts. */
export async function checkFailedLoginSpike(ipAddress: string): Promise<void> {
  const windowMinutes = env.ANOMALY_FAILED_LOGIN_WINDOW_MINUTES;
  const threshold = env.ANOMALY_FAILED_LOGIN_THRESHOLD;
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  const recentFailures = await prisma.auditLog.count({
    where: {
      action: 'LOGIN' as never,
      entity_id: ipAddress,
      timestamp: { gte: windowStart },
    },
  });

  if (recentFailures >= threshold) {
    const existing = await prisma.anomalyAlert.findFirst({
      where: {
        alert_type: 'FAILED_LOGIN_SPIKE',
        entity_id: ipAddress,
        status: 'OPEN',
      },
    });
    if (!existing) {
      await prisma.anomalyAlert.create({
        data: {
          alert_type: 'FAILED_LOGIN_SPIKE',
          entity_type: 'auth',
          entity_id: ipAddress,
          severity: 'HIGH',
          details: { failedAttempts: recentFailures, windowMinutes, threshold },
        },
      });
      console.log(
        `[ANOMALY] Failed-login spike detected for IP ${ipAddress}: ${recentFailures} attempts in ${windowMinutes}min`,
      );
    }
  }
}

/** Check for bulk-download spikes and create anomaly alerts. */
export async function checkBulkDownloadSpike(userId: string): Promise<void> {
  const windowMinutes = env.ANOMALY_BULK_DOWNLOAD_WINDOW_MINUTES;
  const threshold = env.ANOMALY_BULK_DOWNLOAD_THRESHOLD;
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  const recentDownloads = await prisma.auditLog.count({
    where: {
      action: 'DOWNLOAD' as never,
      actor_id: userId,
      timestamp: { gte: windowStart },
    },
  });

  if (recentDownloads >= threshold) {
    const existing = await prisma.anomalyAlert.findFirst({
      where: {
        alert_type: 'BULK_DOWNLOAD_SPIKE',
        entity_id: userId,
        status: 'OPEN',
      },
    });
    if (!existing) {
      await prisma.anomalyAlert.create({
        data: {
          alert_type: 'BULK_DOWNLOAD_SPIKE',
          entity_type: 'documents',
          entity_id: userId,
          severity: 'MEDIUM',
          details: { downloadCount: recentDownloads, windowMinutes, threshold },
        },
      });
      console.log(
        `[ANOMALY] Bulk-download spike detected for user ${userId}: ${recentDownloads} downloads in ${windowMinutes}min`,
      );
    }
  }
}
