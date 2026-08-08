import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { logAuditEvent } from './audit-service.js';
import {
  checkBreachEscalations,
  checkBulkDownloadSpike,
  checkFailedLoginSpike,
  createBreach,
  generateNotificationTemplate,
  getBreach,
  listBreaches,
  recordBreachNotification,
  updateBreach,
} from './breach-service.js';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    dataBreach: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    dataBreachNotification: { create: vi.fn() },
    anomalyAlert: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { count: vi.fn() },
  },
}));

vi.mock('./audit-service.js', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('../config/env.js', () => ({
  env: {
    DPO_CONTACT_EMAIL: 'dpo@peoplevate.com',
    ANOMALY_FAILED_LOGIN_WINDOW_MINUTES: 15,
    ANOMALY_FAILED_LOGIN_THRESHOLD: 10,
    ANOMALY_BULK_DOWNLOAD_WINDOW_MINUTES: 60,
    ANOMALY_BULK_DOWNLOAD_THRESHOLD: 50,
  },
}));

const m = {
  breachCreate: vi.mocked(prisma.dataBreach.create),
  breachFindMany: vi.mocked(prisma.dataBreach.findMany),
  breachFindUnique: vi.mocked(prisma.dataBreach.findUnique),
  breachUpdate: vi.mocked(prisma.dataBreach.update),
  notificationCreate: vi.mocked(prisma.dataBreachNotification.create),
  anomalyFindFirst: vi.mocked(prisma.anomalyAlert.findFirst),
  anomalyCreate: vi.mocked(prisma.anomalyAlert.create),
  auditCount: vi.mocked(prisma.auditLog.count),
  logAuditEvent: vi.mocked(logAuditEvent),
};

const actor = { actorId: 'u-1', actorName: 'Jane' };
const detectionAt = new Date('2026-07-25T14:00:00Z');

describe('breach-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createBreach', () => {
    it('computes a 72-hour SA notification deadline', async () => {
      m.breachCreate.mockResolvedValue({ id: 'br-1', title: 't', severity: 'HIGH' } as never);

      const result = await createBreach({
        title: 'Misaddressed export',
        description: 'desc',
        detectionAt,
        severity: 'HIGH',
        isHighRisk: true,
        dataCategoriesAffected: ['SALARY_RECORDS'],
        affectedSubjectsCount: 10,
        ...actor,
      });

      const data = m.breachCreate.mock.calls[0][0].data;
      const expectedDeadline = new Date(detectionAt.getTime() + 72 * 60 * 60 * 1000);
      expect(data.sa_notification_deadline).toEqual(expectedDeadline);
      expect(m.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entity: 'BREACH' }),
      );
      expect(result.id).toBe('br-1');
    });
  });

  describe('getBreach', () => {
    it('throws 404 when not found', async () => {
      m.breachFindUnique.mockResolvedValue(null);
      await expect(getBreach('missing')).rejects.toBeInstanceOf(HttpError);
    });

    it('returns the breach with notifications when found', async () => {
      const found = { id: 'br-1', title: 't', notifications: [] };
      m.breachFindUnique.mockResolvedValue(found as never);

      const result = await getBreach('br-1');

      expect(m.breachFindUnique).toHaveBeenCalledWith({
        where: { id: 'br-1' },
        include: { notifications: true },
      });
      expect(result).toBe(found);
    });
  });

  describe('listBreaches', () => {
    it('lists all breaches without a filter', async () => {
      m.breachFindMany.mockResolvedValue([{ id: 'br-1' }] as never);

      const result = await listBreaches();

      expect(m.breachFindMany).toHaveBeenCalledWith({
        where: {},
        include: { notifications: true },
        orderBy: { detection_at: 'desc' },
      });
      expect(result).toHaveLength(1);
    });

    it('filters by containment status when provided', async () => {
      m.breachFindMany.mockResolvedValue([] as never);

      await listBreaches('OPEN');

      expect(m.breachFindMany).toHaveBeenCalledWith({
        where: { containment_status: 'OPEN' },
        include: { notifications: true },
        orderBy: { detection_at: 'desc' },
      });
    });
  });

  describe('updateBreach', () => {
    it('blocks closing a high-risk breach without a subject notification plan', async () => {
      m.breachFindUnique.mockResolvedValue({
        id: 'br-1',
        is_high_risk: true,
        subject_notification_plan: null,
      } as never);

      await expect(
        updateBreach('br-1', { containmentStatus: 'CLOSED' }, actor.actorId, actor.actorName),
      ).rejects.toBeInstanceOf(HttpError);
    });

    it('allows closing a high-risk breach when a plan is provided', async () => {
      m.breachFindUnique.mockResolvedValue({
        id: 'br-1',
        is_high_risk: true,
        subject_notification_plan: null,
      } as never);
      m.breachUpdate.mockResolvedValue({ id: 'br-1' } as never);

      await updateBreach(
        'br-1',
        { containmentStatus: 'CLOSED', subjectNotificationPlan: 'Notify all affected subjects' },
        actor.actorId,
        actor.actorName,
      );

      expect(m.breachUpdate).toHaveBeenCalledWith({
        where: { id: 'br-1' },
        data: expect.objectContaining({ containmentStatus: 'CLOSED' }),
      });
    });

    it('closes a non-high-risk breach without requiring a plan', async () => {
      m.breachFindUnique.mockResolvedValue({
        id: 'br-2',
        is_high_risk: false,
        subject_notification_plan: null,
      } as never);
      m.breachUpdate.mockResolvedValue({ id: 'br-2' } as never);

      await updateBreach('br-2', { containmentStatus: 'CLOSED' }, actor.actorId, actor.actorName);

      expect(m.breachUpdate).toHaveBeenCalledWith({
        where: { id: 'br-2' },
        data: expect.objectContaining({ containmentStatus: 'CLOSED' }),
      });
      expect(m.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entity: 'BREACH' }),
      );
    });

    it('applies a normal field update without re-reading the breach', async () => {
      m.breachUpdate.mockResolvedValue({ id: 'br-3', title: 'Updated' } as never);

      await updateBreach('br-3', { title: 'Updated' }, actor.actorId, actor.actorName);

      expect(m.breachFindUnique).not.toHaveBeenCalled();
      expect(m.breachUpdate).toHaveBeenCalledWith({
        where: { id: 'br-3' },
        data: { title: 'Updated' },
      });
    });

    it('reuses an existing subject notification plan when closing high-risk breach', async () => {
      m.breachFindUnique.mockResolvedValue({
        id: 'br-4',
        is_high_risk: true,
        subject_notification_plan: 'Existing plan',
      } as never);
      m.breachUpdate.mockResolvedValue({ id: 'br-4' } as never);

      await updateBreach('br-4', { containmentStatus: 'CLOSED' }, actor.actorId, actor.actorName);

      expect(m.breachUpdate).toHaveBeenCalled();
    });
  });

  describe('recordBreachNotification', () => {
    it('records SA notification timestamp on the breach', async () => {
      m.notificationCreate.mockResolvedValue({ id: 'n-1' } as never);
      m.breachUpdate.mockResolvedValue({} as never);

      await recordBreachNotification(
        'br-1',
        {
          notificationType: 'SUPERVISORY_AUTHORITY',
          method: 'portal',
          reference: 'SA-2026-1188',
        },
        actor.actorId,
        actor.actorName,
      );

      expect(m.breachUpdate).toHaveBeenCalledWith({
        where: { id: 'br-1' },
        data: expect.objectContaining({
          sa_notified_at: expect.any(Date),
          sa_notification_method: 'portal',
          sa_notification_reference: 'SA-2026-1188',
        }),
      });
    });

    it('records a data-subject notification and sets subject_notified_at', async () => {
      m.notificationCreate.mockResolvedValue({ id: 'n-2' } as never);
      m.breachUpdate.mockResolvedValue({} as never);

      await recordBreachNotification(
        'br-2',
        { notificationType: 'DATA_SUBJECT', method: 'email' },
        actor.actorId,
        actor.actorName,
      );

      expect(m.notificationCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          breach_id: 'br-2',
          notification_type: 'DATA_SUBJECT',
          method: 'email',
          reference: null,
          created_by_id: actor.actorId,
        }),
      });
      expect(m.breachUpdate).toHaveBeenCalledWith({
        where: { id: 'br-2' },
        data: { subject_notified_at: expect.any(Date) },
      });
      expect(m.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'BREACH', entityId: 'br-2' }),
      );
    });
  });

  describe('generateNotificationTemplate', () => {
    it('pre-populates GDPR-required fields', () => {
      const template = generateNotificationTemplate({
        title: 'Breach',
        description: 'desc',
        detection_at: detectionAt,
        data_categories_affected: ['SALARY_RECORDS'],
        affected_subjects_count: 5,
        severity: 'HIGH',
        containment_status: 'CONTAINED',
        root_cause: 'human error',
        resolution: 'contained',
      });
      expect(template.nature).toBe('Breach');
      expect(template.approximateRecordsAffected).toBe(5);
      expect(template.rootCause).toBe('human error');
      expect(template.detectionTime).toBe(detectionAt.toISOString());
    });

    it('falls back to defaults when root cause and resolution are null', () => {
      const template = generateNotificationTemplate({
        title: 'Breach',
        description: 'desc',
        detection_at: detectionAt,
        data_categories_affected: ['SALARY_RECORDS'],
        affected_subjects_count: 5,
        severity: 'HIGH',
        containment_status: 'OPEN',
        root_cause: null,
        resolution: null,
      });
      expect(template.rootCause).toBe('Under investigation');
      expect(template.measuresTaken).toBe('OPEN');
    });
  });

  describe('checkBreachEscalations', () => {
    it('logs approaching and overdue breaches to the DPO', async () => {
      const approaching = [{ id: 'br-1', title: 'Approaching' }];
      const overdue = [{ id: 'br-2', title: 'Overdue' }];
      m.breachFindMany
        .mockResolvedValueOnce(approaching as never)
        .mockResolvedValueOnce(overdue as never);

      const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await checkBreachEscalations();

      const calls = spy.mock.calls.map((c) => String(c[0]));
      expect(calls.some((c) => c.includes('BREACH ESCALATION'))).toBe(true);
      expect(calls.some((c) => c.includes('BREACH OVERDUE'))).toBe(true);
      expect(calls.every((c) => c.includes('dpo@peoplevate.com'))).toBe(true);
      spy.mockRestore();
    });

    it('does nothing when no breaches need escalation', async () => {
      m.breachFindMany.mockResolvedValue([] as never);

      const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await checkBreachEscalations();

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('anomaly detection', () => {
    it('creates a failed-login spike alert when threshold is met', async () => {
      m.auditCount.mockResolvedValue(25);
      m.anomalyFindFirst.mockResolvedValue(null);
      m.anomalyCreate.mockResolvedValue({ id: 'an-1' } as never);

      await checkFailedLoginSpike('203.0.113.10');

      expect(m.anomalyCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          alert_type: 'FAILED_LOGIN_SPIKE',
          entity_id: '203.0.113.10',
          severity: 'HIGH',
        }),
      });
    });

    it('does not create a duplicate open alert', async () => {
      m.auditCount.mockResolvedValue(25);
      m.anomalyFindFirst.mockResolvedValue({ id: 'an-1' } as never);

      await checkFailedLoginSpike('203.0.113.10');
      expect(m.anomalyCreate).not.toHaveBeenCalled();
    });

    it('does not create an alert below the threshold', async () => {
      m.auditCount.mockResolvedValue(2);
      await checkFailedLoginSpike('203.0.113.10');
      expect(m.anomalyCreate).not.toHaveBeenCalled();
    });

    it('creates a bulk-download spike alert when threshold is met', async () => {
      m.auditCount.mockResolvedValue(80);
      m.anomalyFindFirst.mockResolvedValue(null);
      m.anomalyCreate.mockResolvedValue({ id: 'an-2' } as never);

      await checkBulkDownloadSpike('u-1');

      expect(m.anomalyCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ alert_type: 'BULK_DOWNLOAD_SPIKE', entity_id: 'u-1' }),
      });
    });

    it('does not create a duplicate bulk-download alert', async () => {
      m.auditCount.mockResolvedValue(80);
      m.anomalyFindFirst.mockResolvedValue({ id: 'an-2' } as never);

      await checkBulkDownloadSpike('u-1');
      expect(m.anomalyCreate).not.toHaveBeenCalled();
    });

    it('does not create a bulk-download alert below the threshold', async () => {
      m.auditCount.mockResolvedValue(2);
      await checkBulkDownloadSpike('u-1');
      expect(m.anomalyCreate).not.toHaveBeenCalled();
    });
  });
});
