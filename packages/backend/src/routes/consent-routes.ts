import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { UserRole, ConsentMechanism } from '#prisma';
import {
  recordConsent,
  withdrawConsent,
  listConsents,
  getConsent,
} from '../services/consent-service.js';

export const consentRoutes: Router = Router();

consentRoutes.use(authenticate);

// GET /api/consent - list consent records (self or Admin/HR for any subject)
consentRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const { dataSubjectUserId, dataSubjectEmail } = req.query as {
      dataSubjectUserId?: string;
      dataSubjectEmail?: string;
    };

    // Non-admin/HR can only see their own consents
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HR_MANAGER) {
      const consents = await listConsents(user.userId);
      res.json({ consents });
      return;
    }

    const consents = await listConsents(dataSubjectUserId, dataSubjectEmail);
    res.json({ consents });
  } catch (err) {
    next(err);
  }
});

// GET /api/consent/:id - get a single consent record
consentRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const consent = await getConsent(String(req.params.id));
    const user = getAuthUser(req)!;
    if (
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.HR_MANAGER &&
      consent.data_subject_user_id !== user.userId
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    res.json({ consent });
  } catch (err) {
    next(err);
  }
});

// POST /api/consent - record a new consent
consentRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const { dataSubjectEmail, processingPurpose, consentText, noticeVersion, mechanism } =
      req.body as {
        dataSubjectEmail: string;
        processingPurpose: string;
        consentText: string;
        noticeVersion: string;
        mechanism: ConsentMechanism;
      };
    const consent = await recordConsent({
      dataSubjectUserId: user.userId,
      dataSubjectEmail,
      processingPurpose,
      consentText,
      noticeVersion,
      mechanism,
      actorId: user.userId,
      actorName: user.email,
    });
    res.status(201).json({ consent });
  } catch (err) {
    next(err);
  }
});

// POST /api/consent/withdraw - withdraw consent
consentRoutes.post('/withdraw', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuthUser(req)!;
    const { originalConsentId, lawfulBasisOverride } = req.body as {
      originalConsentId: string;
      lawfulBasisOverride?: string;
    };

    // Verify the user owns the consent (unless Admin/HR)
    const original = await getConsent(originalConsentId);
    if (
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.HR_MANAGER &&
      original.data_subject_user_id !== user.userId
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const withdrawal = await withdrawConsent({
      originalConsentId,
      ...(original.data_subject_user_id
        ? { dataSubjectUserId: original.data_subject_user_id }
        : {}),
      dataSubjectEmail: original.data_subject_email,
      ...(lawfulBasisOverride ? { lawfulBasisOverride } : {}),
      actorId: user.userId,
      actorName: user.email,
    });
    res.status(201).json({ withdrawal });
  } catch (err) {
    next(err);
  }
});
