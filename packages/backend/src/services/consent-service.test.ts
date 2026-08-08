import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { logAuditEvent } from './audit-service.js';
import { getConsent, listConsents, recordConsent, withdrawConsent } from './consent-service.js';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    consentRecord: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('./audit-service.js', () => ({
  logAuditEvent: vi.fn(),
}));

const mocked = {
  create: vi.mocked(prisma.consentRecord.create),
  update: vi.mocked(prisma.consentRecord.update),
  findUnique: vi.mocked(prisma.consentRecord.findUnique),
  findMany: vi.mocked(prisma.consentRecord.findMany),
  logAuditEvent: vi.mocked(logAuditEvent),
};

const actor = { actorId: 'u-1', actorName: 'Jane' };

describe('consent-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordConsent', () => {
    it('captures full evidence and writes a GIVEN record', async () => {
      mocked.create.mockResolvedValue({ id: 'c-1' } as never);

      const result = await recordConsent({
        dataSubjectEmail: 'jane@example.com',
        processingPurpose: 'payroll',
        consentText: 'I consent to payroll processing.',
        noticeVersion: 'v1',
        mechanism: 'CHECKBOX',
        ipAddressTruncated: '203.0.113.0',
        ...actor,
      });

      expect(mocked.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          data_subject_email: 'jane@example.com',
          processing_purpose: 'payroll',
          consent_text: 'I consent to payroll processing.',
          notice_version: 'v1',
          mechanism: 'CHECKBOX',
          ip_address_truncated: '203.0.113.0',
          status: 'GIVEN',
        }),
      });
      expect(mocked.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CONSENT',
          entity: 'CONSENT',
          newValue: { purpose: 'payroll', status: 'GIVEN' },
        }),
      );
      expect(result.id).toBe('c-1');
    });

    it('omits null user id and IP when absent', async () => {
      mocked.create.mockResolvedValue({ id: 'c-2' } as never);

      await recordConsent({
        dataSubjectEmail: 'x@example.com',
        processingPurpose: 'candidate-recruitment',
        consentText: 'consent',
        noticeVersion: 'v1',
        mechanism: 'SIGNATURE',
        ...actor,
      });

      expect(mocked.create.mock.calls[0][0].data.data_subject_user_id).toBeNull();
      expect(mocked.create.mock.calls[0][0].data.ip_address_truncated).toBeNull();
    });

    it('rejects non-explicit consent for special-category data (GDPR Art. 9)', async () => {
      await expect(
        recordConsent({
          dataSubjectEmail: 'jane@example.com',
          processingPurpose: 'national-id',
          consentText: 'consent to process national ID',
          noticeVersion: 'v1',
          mechanism: 'CHECKBOX',
          ...actor,
        }),
      ).rejects.toBeInstanceOf(HttpError);
      expect(mocked.create).not.toHaveBeenCalled();
    });

    it('accepts EXPLICIT consent for special-category data', async () => {
      mocked.create.mockResolvedValue({ id: 'c-3' } as never);

      await recordConsent({
        dataSubjectEmail: 'jane@example.com',
        processingPurpose: 'medical-records',
        consentText: 'consent to process health records',
        noticeVersion: 'v1',
        mechanism: 'EXPLICIT',
        ...actor,
      });

      expect(mocked.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          processing_purpose: 'medical-records',
          mechanism: 'EXPLICIT',
        }),
      });
    });
  });

  describe('withdrawConsent', () => {
    it('throws 404 when the original consent does not exist', async () => {
      mocked.findUnique.mockResolvedValue(null);

      await expect(
        withdrawConsent({
          originalConsentId: 'missing',
          dataSubjectEmail: 'jane@example.com',
          ...actor,
        }),
      ).rejects.toBeInstanceOf(HttpError);
    });

    it('marks the original as withdrawn and creates a linked withdrawal record', async () => {
      mocked.findUnique.mockResolvedValue({
        id: 'c-1',
        processing_purpose: 'payroll',
        consent_text: 'consent text',
        notice_version: 'v1',
        mechanism: 'CHECKBOX',
      } as never);
      mocked.update.mockResolvedValue({} as never);
      mocked.create.mockResolvedValue({ id: 'c-withdrawn' } as never);

      const result = await withdrawConsent({
        originalConsentId: 'c-1',
        dataSubjectEmail: 'jane@example.com',
        lawfulBasisOverride: 'Retained under legal obligation',
        ...actor,
      });

      expect(mocked.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { status: 'WITHDRAWN' },
      });
      expect(mocked.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'WITHDRAWN',
          withdraws_consent_id: 'c-1',
          lawful_basis_override: 'Retained under legal obligation',
          processing_purpose: 'payroll',
        }),
      });
      expect(result.id).toBe('c-withdrawn');
    });
  });

  describe('listConsents', () => {
    it('filters by user id when provided and excludes withdrawal records', async () => {
      mocked.findMany.mockResolvedValue([] as never);
      await listConsents('u-1');
      expect(mocked.findMany).toHaveBeenCalledWith({
        where: { data_subject_user_id: 'u-1', withdraws_consent_id: null },
        orderBy: { recorded_at: 'desc' },
      });
    });

    it('filters by email when user id is absent', async () => {
      mocked.findMany.mockResolvedValue([] as never);
      await listConsents(undefined, 'jane@example.com');
      expect(mocked.findMany).toHaveBeenCalledWith({
        where: { data_subject_email: 'jane@example.com', withdraws_consent_id: null },
        orderBy: { recorded_at: 'desc' },
      });
    });
  });

  describe('getConsent', () => {
    it('throws 404 when not found', async () => {
      mocked.findUnique.mockResolvedValue(null);
      await expect(getConsent('nope')).rejects.toBeInstanceOf(HttpError);
    });
  });
});
