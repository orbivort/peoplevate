import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { UserRole, ConsentMechanism, ConsentStatus } from '#prisma';

// Mock the service layer so route tests stay isolated from Prisma.
vi.mock('../services/consent-service.js', () => ({
  recordConsent: vi.fn(),
  withdrawConsent: vi.fn(),
  listConsents: vi.fn(),
  getConsent: vi.fn(),
}));

// Mock auth so we can inject any role/user without a real JWT.
vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
    // Default admin user; overridden per-test via the exported mock.
    req.user = {
      userId: 'u-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      employeeId: 'emp-1',
    };
    next();
  }),
  getAuthUser: vi.fn((req: { user?: unknown }) => req.user),
}));

import * as consentService from '../services/consent-service.js';
import { authenticate, getAuthUser } from '../middleware/auth.js';
import { consentRoutes } from './consent-routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const mocked = {
  authenticate: vi.mocked(authenticate),
  getAuthUser: vi.mocked(getAuthUser),
  recordConsent: vi.mocked(consentService.recordConsent),
  withdrawConsent: vi.mocked(consentService.withdrawConsent),
  listConsents: vi.mocked(consentService.listConsents),
  getConsent: vi.mocked(consentService.getConsent),
};

/** Sets the authenticated user used by getAuthUser in the next request. */
function setAuthUser(user: {
  userId: string;
  email: string;
  role: string;
  employeeId?: string | null;
}) {
  mocked.getAuthUser.mockImplementation((req: { user?: unknown }) => {
    if (!req.user) req.user = user;
    return req.user as never;
  });
  // authenticate also needs to set req.user so getAuthUser in routes finds it.
  mocked.authenticate.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = user;
      next();
    },
  );
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/consent', consentRoutes);
  app.use(errorHandler);
  return app;
}

const sampleConsent = {
  id: 'c-1',
  data_subject_user_id: 'u-1',
  data_subject_email: 'user@example.com',
  processing_purpose: 'newsletter',
  consent_text: 'I agree to receive the newsletter.',
  notice_version: '1.0',
  mechanism: ConsentMechanism.CHECKBOX,
  ip_address_truncated: null,
  status: ConsentStatus.GIVEN,
  withdraws_consent_id: null,
  recorded_at: '2026-08-07T10:00:00.000Z',
};

describe('consent-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to admin for most tests; individual tests override.
    setAuthUser({
      userId: 'u-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      employeeId: 'emp-1',
    });
    mocked.listConsents.mockResolvedValue([sampleConsent]);
    mocked.getConsent.mockResolvedValue(sampleConsent as never);
    mocked.recordConsent.mockResolvedValue(sampleConsent as never);
    mocked.withdrawConsent.mockResolvedValue({
      ...sampleConsent,
      id: 'c-2',
      status: ConsentStatus.WITHDRAWN,
      withdraws_consent_id: 'c-1',
    } as never);
  });

  describe('middleware', () => {
    it('applies the authenticate middleware on the router', () => {
      buildApp();
      expect(mocked.authenticate).toBeDefined();
    });
  });

  describe('GET /api/consent', () => {
    it('lists a subject consent for an admin using dataSubjectUserId query', async () => {
      const res = await request(buildApp()).get('/api/consent?dataSubjectUserId=u-9');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ consents: [sampleConsent] });
      expect(mocked.listConsents).toHaveBeenCalledWith('u-9', undefined);
    });

    it('lists by dataSubjectEmail query when admin supplies it', async () => {
      await request(buildApp()).get('/api/consent?dataSubjectEmail=someone@example.com');

      expect(mocked.listConsents).toHaveBeenCalledWith(undefined, 'someone@example.com');
    });

    it('lists by both userId and email for admin', async () => {
      await request(buildApp()).get(
        '/api/consent?dataSubjectUserId=u-9&dataSubjectEmail=someone@example.com',
      );

      expect(mocked.listConsents).toHaveBeenCalledWith('u-9', 'someone@example.com');
    });

    it('restricts non-admin/HR to only their own consents (ignores query params)', async () => {
      setAuthUser({
        userId: 'u-2',
        email: 'emp@example.com',
        role: UserRole.EMPLOYEE,
        employeeId: null,
      });

      const res = await request(buildApp()).get('/api/consent?dataSubjectUserId=u-9');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ consents: [sampleConsent] });
      expect(mocked.listConsents).toHaveBeenCalledWith('u-2');
    });

    it('restricts a MANAGER to only their own consents', async () => {
      setAuthUser({
        userId: 'u-3',
        email: 'mgr@example.com',
        role: UserRole.MANAGER,
        employeeId: 'emp-3',
      });

      await request(buildApp()).get('/api/consent?dataSubjectUserId=u-9');

      expect(mocked.listConsents).toHaveBeenCalledWith('u-3');
    });

    it('forwards service errors to the error handler', async () => {
      mocked.listConsents.mockRejectedValue(Object.assign(new Error('db down'), { status: 503 }));

      const res = await request(buildApp()).get('/api/consent');

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('db down');
    });
  });

  describe('GET /api/consent/:id', () => {
    it('returns a single consent for an admin', async () => {
      const res = await request(buildApp()).get('/api/consent/c-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ consent: sampleConsent });
      expect(mocked.getConsent).toHaveBeenCalledWith('c-1');
    });

    it('returns a consent the user owns (non-admin/HR)', async () => {
      setAuthUser({
        userId: 'u-1',
        email: 'user@example.com',
        role: UserRole.EMPLOYEE,
        employeeId: null,
      });
      // sampleConsent.data_subject_user_id is 'u-1' which matches the auth user.
      const res = await request(buildApp()).get('/api/consent/c-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ consent: sampleConsent });
    });

    it('returns 403 when a non-admin/HR accesses another subject consent', async () => {
      setAuthUser({
        userId: 'u-other',
        email: 'other@example.com',
        role: UserRole.EMPLOYEE,
        employeeId: null,
      });

      const res = await request(buildApp()).get('/api/consent/c-1');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Access denied' });
    });

    it('allows HR_MANAGER to access any subject consent', async () => {
      setAuthUser({
        userId: 'u-hr',
        email: 'hr@example.com',
        role: UserRole.HR_MANAGER,
        employeeId: null,
      });

      const res = await request(buildApp()).get('/api/consent/c-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ consent: sampleConsent });
    });

    it('forwards a not-found error from getConsent', async () => {
      const { HttpError } = await import('../utils/http-error.js');
      mocked.getConsent.mockRejectedValue(new HttpError(404, 'Consent record not found'));

      const res = await request(buildApp()).get('/api/consent/missing');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Consent record not found');
    });

    it('forwards generic service errors to the error handler', async () => {
      mocked.getConsent.mockRejectedValue(Object.assign(new Error('boom'), { status: 503 }));

      const res = await request(buildApp()).get('/api/consent/c-1');

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('boom');
    });
  });

  describe('POST /api/consent', () => {
    const payload = {
      dataSubjectEmail: 'user@example.com',
      processingPurpose: 'newsletter',
      consentText: 'I agree to receive the newsletter.',
      noticeVersion: '1.0',
      mechanism: ConsentMechanism.CHECKBOX,
    };

    it('records a consent and returns 201', async () => {
      const res = await request(buildApp()).post('/api/consent').send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ consent: sampleConsent });
      expect(mocked.recordConsent).toHaveBeenCalledWith({
        dataSubjectUserId: 'u-1',
        dataSubjectEmail: 'user@example.com',
        processingPurpose: 'newsletter',
        consentText: 'I agree to receive the newsletter.',
        noticeVersion: '1.0',
        mechanism: ConsentMechanism.CHECKBOX,
        actorId: 'u-1',
        actorName: 'admin@example.com',
      });
    });

    it('uses the authenticated user as the data subject and actor', async () => {
      setAuthUser({
        userId: 'u-5',
        email: 'e5@example.com',
        role: UserRole.EMPLOYEE,
        employeeId: null,
      });

      await request(buildApp()).post('/api/consent').send(payload);

      const call = mocked.recordConsent.mock.calls[0][0] as Record<string, unknown>;
      expect(call.dataSubjectUserId).toBe('u-5');
      expect(call.actorId).toBe('u-5');
      expect(call.actorName).toBe('e5@example.com');
    });

    it('forwards validation/business errors (HttpError) from the service', async () => {
      const { HttpError } = await import('../utils/http-error.js');
      mocked.recordConsent.mockRejectedValue(
        new HttpError(
          422,
          'Explicit consent (EXPLICIT mechanism) is required to process special-category data.',
        ),
      );

      const res = await request(buildApp())
        .post('/api/consent')
        .send({
          ...payload,
          processingPurpose: 'national-id',
          mechanism: ConsentMechanism.CHECKBOX,
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toContain('Explicit consent');
    });

    it('forwards generic service errors to the error handler', async () => {
      mocked.recordConsent.mockRejectedValue(
        Object.assign(new Error('store failed'), { status: 503 }),
      );

      const res = await request(buildApp()).post('/api/consent').send(payload);

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('store failed');
    });
  });

  describe('POST /api/consent/withdraw', () => {
    const payload = { originalConsentId: 'c-1' };

    it('withdraws consent and returns 201 for an admin', async () => {
      const res = await request(buildApp()).post('/api/consent/withdraw').send(payload);

      expect(res.status).toBe(201);
      expect(res.body.withdrawal.status).toBe(ConsentStatus.WITHDRAWN);
      expect(mocked.getConsent).toHaveBeenCalledWith('c-1');
      expect(mocked.withdrawConsent).toHaveBeenCalledWith(
        expect.objectContaining({
          originalConsentId: 'c-1',
          dataSubjectUserId: 'u-1',
          dataSubjectEmail: 'user@example.com',
          actorId: 'u-1',
          actorName: 'admin@example.com',
        }),
      );
    });

    it('includes lawfulBasisOverride when supplied', async () => {
      await request(buildApp())
        .post('/api/consent/withdraw')
        .send({ ...payload, lawfulBasisOverride: 'legitimate-interest' });

      const call = mocked.withdrawConsent.mock.calls[0][0] as Record<string, unknown>;
      expect(call.lawfulBasisOverride).toBe('legitimate-interest');
    });

    it('omits lawfulBasisOverride when not supplied', async () => {
      await request(buildApp()).post('/api/consent/withdraw').send(payload);

      const call = mocked.withdrawConsent.mock.calls[0][0] as Record<string, unknown>;
      expect(call.lawfulBasisOverride).toBeUndefined();
    });

    it('allows the owning non-admin/HR user to withdraw their own consent', async () => {
      setAuthUser({
        userId: 'u-1',
        email: 'user@example.com',
        role: UserRole.EMPLOYEE,
        employeeId: null,
      });

      const res = await request(buildApp()).post('/api/consent/withdraw').send(payload);

      expect(res.status).toBe(201);
      expect(mocked.withdrawConsent).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when a non-admin/HR user withdraws another subject consent', async () => {
      setAuthUser({
        userId: 'u-other',
        email: 'other@example.com',
        role: UserRole.EMPLOYEE,
        employeeId: null,
      });

      const res = await request(buildApp()).post('/api/consent/withdraw').send(payload);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Access denied' });
      expect(mocked.withdrawConsent).not.toHaveBeenCalled();
    });

    it('omits dataSubjectUserId in the call when the original has no linked user', async () => {
      mocked.getConsent.mockResolvedValue({
        ...sampleConsent,
        data_subject_user_id: null,
      } as never);

      await request(buildApp()).post('/api/consent/withdraw').send(payload);

      const call = mocked.withdrawConsent.mock.calls[0][0] as Record<string, unknown>;
      expect(call.dataSubjectUserId).toBeUndefined();
    });

    it('forwards a not-found error from getConsent', async () => {
      const { HttpError } = await import('../utils/http-error.js');
      mocked.getConsent.mockRejectedValue(new HttpError(404, 'Consent record not found'));

      const res = await request(buildApp()).post('/api/consent/withdraw').send(payload);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Consent record not found');
      expect(mocked.withdrawConsent).not.toHaveBeenCalled();
    });

    it('forwards withdrawal service errors to the error handler', async () => {
      mocked.withdrawConsent.mockRejectedValue(
        Object.assign(new Error('withdraw failed'), { status: 503 }),
      );

      const res = await request(buildApp()).post('/api/consent/withdraw').send(payload);

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('withdraw failed');
    });
  });
});
