import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { logAuditEvent } from './audit-service.js';
import { ConsentMechanism, ConsentStatus } from '#prisma';

/**
 * Consent Management Service
 *
 * Captures demonstrable consent evidence and manages consent withdrawal.
 */

/**
 * Purposes that process special-category (sensitive) data and therefore require
 * explicit consent under GDPR Art. 9 (e.g. health, national ID, biometrics).
 * Any new purpose that touches special-category data MUST be added here so the
 * backend refuses to record a non-explicit consent for it.
 */
const SPECIAL_CATEGORY_PURPOSES = new Set(['medical-records', 'national-id']);

/** Record a new consent with full evidence. */
export async function recordConsent(params: {
  dataSubjectUserId?: string;
  dataSubjectEmail: string;
  processingPurpose: string;
  consentText: string;
  noticeVersion: string;
  mechanism: ConsentMechanism;
  ipAddressTruncated?: string;
  actorId: string;
  actorName: string;
}) {
  // Defense-in-depth: special-category data requires EXPLICIT consent (GDPR Art. 9).
  if (
    SPECIAL_CATEGORY_PURPOSES.has(params.processingPurpose) &&
    params.mechanism !== ConsentMechanism.EXPLICIT
  ) {
    throw new HttpError(
      422,
      'Explicit consent (EXPLICIT mechanism) is required to process special-category data.',
    );
  }
  const consent = await prisma.consentRecord.create({
    data: {
      data_subject_user_id: params.dataSubjectUserId ?? null,
      data_subject_email: params.dataSubjectEmail,
      processing_purpose: params.processingPurpose,
      consent_text: params.consentText,
      notice_version: params.noticeVersion,
      mechanism: params.mechanism,
      ip_address_truncated: params.ipAddressTruncated ?? null,
      status: ConsentStatus.GIVEN,
    },
  });

  await logAuditEvent({
    actorId: params.actorId,
    actorName: params.actorName,
    action: 'CONSENT' as never,
    entity: 'CONSENT' as never,
    entityId: consent.id,
    newValue: { purpose: params.processingPurpose, status: 'GIVEN' },
  });

  return consent;
}

/** Withdraw consent: creates a new record referencing the original. */
export async function withdrawConsent(params: {
  originalConsentId: string;
  dataSubjectUserId?: string;
  dataSubjectEmail: string;
  lawfulBasisOverride?: string;
  actorId: string;
  actorName: string;
}) {
  const original = await prisma.consentRecord.findUnique({
    where: { id: params.originalConsentId },
  });
  if (!original) {
    throw new HttpError(404, 'Original consent record not found');
  }

  // Mark the original as withdrawn
  await prisma.consentRecord.update({
    where: { id: params.originalConsentId },
    data: { status: ConsentStatus.WITHDRAWN },
  });

  // Create a withdrawal record referencing the original
  const withdrawal = await prisma.consentRecord.create({
    data: {
      data_subject_user_id: params.dataSubjectUserId ?? null,
      data_subject_email: params.dataSubjectEmail,
      processing_purpose: original.processing_purpose,
      consent_text: original.consent_text,
      notice_version: original.notice_version,
      mechanism: original.mechanism,
      status: ConsentStatus.WITHDRAWN,
      withdraws_consent_id: params.originalConsentId,
      lawful_basis_override: params.lawfulBasisOverride ?? null,
    },
  });

  await logAuditEvent({
    actorId: params.actorId,
    actorName: params.actorName,
    action: 'CONSENT' as never,
    entity: 'CONSENT' as never,
    entityId: withdrawal.id,
    newValue: {
      purpose: original.processing_purpose,
      status: 'WITHDRAWN',
      originalConsentId: params.originalConsentId,
    },
  });

  return withdrawal;
}

/** List consent records for a data subject. */
export async function listConsents(dataSubjectUserId?: string, dataSubjectEmail?: string) {
  const where: Record<string, unknown> = {};
  if (dataSubjectUserId) {
    where.data_subject_user_id = dataSubjectUserId;
  } else if (dataSubjectEmail) {
    where.data_subject_email = dataSubjectEmail;
  }
  // Exclude linked withdrawal records (withdraws_consent_id set) — the original
  // record already carries the WITHDRAWN status, so showing both would duplicate
  // rows for the same subject/purpose. The withdrawal evidence stays linked to
  // the original for the audit trail.
  where.withdraws_consent_id = null;
  return prisma.consentRecord.findMany({
    where,
    orderBy: { recorded_at: 'desc' },
  });
}

/** Get a single consent record. */
export async function getConsent(consentId: string) {
  const consent = await prisma.consentRecord.findUnique({
    where: { id: consentId },
    include: { withdraws_consent: true },
  });
  if (!consent) {
    throw new HttpError(404, 'Consent record not found');
  }
  return consent;
}
