import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertSeverity, DocumentType, EmploymentStatus } from '#prisma';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    document: {
      findMany: vi.fn(),
    },
    expiryAlert: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./email-service.js', () => ({
  sendEmail: vi.fn(),
}));

import { prisma } from '../config/prisma.js';
import { sendEmail } from './email-service.js';
import { acknowledgeAlert, getAlerts, runExpiryCheck } from './alert-service.js';

const mocked = {
  documentFindMany: vi.mocked(prisma.document.findMany),
  expiryAlertFindFirst: vi.mocked(prisma.expiryAlert.findFirst),
  expiryAlertCreate: vi.mocked(prisma.expiryAlert.create),
  expiryAlertFindMany: vi.mocked(prisma.expiryAlert.findMany),
  expiryAlertUpdate: vi.mocked(prisma.expiryAlert.update),
  sendEmail: vi.mocked(sendEmail),
};

describe('alert-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runExpiryCheck', () => {
    const soonDoc = {
      id: 'doc-1',
      type: DocumentType.PASSPORT,
      expiry_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      employee: {
        id: 'emp-1',
        first_name: 'Jane',
        last_name: 'Doe',
        status: EmploymentStatus.ACTIVE,
        email: 'jane@example.com',
      },
    };

    it('creates an alert and sends an email for an expiring document', async () => {
      mocked.documentFindMany.mockResolvedValue([soonDoc] as never);
      mocked.expiryAlertFindFirst.mockResolvedValue(null);
      mocked.expiryAlertCreate.mockResolvedValue({} as never);

      await runExpiryCheck();

      expect(mocked.expiryAlertCreate).toHaveBeenCalledWith({
        data: {
          document_id: 'doc-1',
          employee_id: 'emp-1',
          employee_name: 'Jane Doe',
          document_type: DocumentType.PASSPORT,
          expiry_date: soonDoc.expiry_date,
          days_until_expiry: expect.any(Number),
          severity: AlertSeverity.SOON,
          acknowledged: false,
        },
      });
      expect(mocked.sendEmail).toHaveBeenCalledWith(
        'jane@example.com',
        expect.stringContaining('Expiring Soon'),
        expect.stringContaining('Jane Doe'),
      );
    });

    it('skips creating an alert when one already exists today for the document', async () => {
      mocked.documentFindMany.mockResolvedValue([soonDoc] as never);
      mocked.expiryAlertFindFirst.mockResolvedValue({ id: 'alert-existing' } as never);

      await runExpiryCheck();

      expect(mocked.expiryAlertCreate).not.toHaveBeenCalled();
      expect(mocked.sendEmail).not.toHaveBeenCalled();
    });

    it('does not send an email for terminated employees', async () => {
      const terminatedDoc = {
        ...soonDoc,
        employee: { ...soonDoc.employee, status: EmploymentStatus.TERMINATED },
      };
      mocked.documentFindMany.mockResolvedValue([terminatedDoc] as never);
      mocked.expiryAlertFindFirst.mockResolvedValue(null);
      mocked.expiryAlertCreate.mockResolvedValue({} as never);

      await runExpiryCheck();

      expect(mocked.expiryAlertCreate).toHaveBeenCalled();
      expect(mocked.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('getAlerts', () => {
    it('returns all alerts when no filter is provided', async () => {
      const alerts = [{ id: 'a1', acknowledged: false }] as never;
      mocked.expiryAlertFindMany.mockResolvedValue(alerts);

      const result = await getAlerts({});

      expect(result).toEqual(alerts);
      expect(mocked.expiryAlertFindMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ severity: 'asc' }, { days_until_expiry: 'asc' }],
      });
    });

    it('filters by acknowledged flag when provided', async () => {
      mocked.expiryAlertFindMany.mockResolvedValue([] as never);

      await getAlerts({ acknowledged: true });

      expect(mocked.expiryAlertFindMany).toHaveBeenCalledWith({
        where: { acknowledged: true },
        orderBy: [{ severity: 'asc' }, { days_until_expiry: 'asc' }],
      });
    });
  });

  describe('acknowledgeAlert', () => {
    it('marks the alert as acknowledged', async () => {
      mocked.expiryAlertUpdate.mockResolvedValue({} as never);

      await acknowledgeAlert('alert-1');

      expect(mocked.expiryAlertUpdate).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: { acknowledged: true },
      });
    });
  });
});
