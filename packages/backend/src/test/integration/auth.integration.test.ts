import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { hashToken } from '../../utils/token.js';
import { hashPassword } from '../../utils/password.js';
import {
  createTestApp,
  createUser,
  loginForTokens,
  resetDatabase,
  disconnectDb,
  prisma,
} from './helpers.js';

describe('auth integration', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDb();
  });

  describe('POST /api/auth/login', () => {
    it('returns a token pair and user for valid credentials', async () => {
      await createUser({ email: 'john@example.com', password: 'Password123!' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@example.com', password: 'Password123!' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTypeOf('string');
      expect(res.body.refreshToken).toBeTypeOf('string');
      expect(res.body.user).toMatchObject({
        email: 'john@example.com',
        role: 'EMPLOYEE',
      });

      // The login is recorded in the audit log via the real service + DB.
      const audit = await prisma.auditLog.findFirst({ where: { action: 'LOGIN' } });
      expect(audit).not.toBeNull();
    });

    it('rejects a wrong password', async () => {
      await createUser({ email: 'john@example.com', password: 'Password123!' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@example.com', password: 'WrongPassword1!' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('rejects an unknown email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ghost@example.com', password: 'Password123!' });

      expect(res.status).toBe(401);
    });

    it('rejects an empty password (validation)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@example.com', password: '' });

      expect(res.status).toBe(400);
    });

    it('locks the account after repeated failures and rejects while locked', async () => {
      const user = await createUser({ email: 'lock@example.com', password: 'Password123!' });

      // Attempt threshold failures (default 5).
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'lock@example.com', password: 'WrongPassword1!' });
      }

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored?.failed_login_count).toBe(5);
      expect(stored?.locked_until).not.toBeNull();

      // Even with the correct password, the locked account is rejected.
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'lock@example.com', password: 'Password123!' });
      expect(res.status).toBe(423);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates the token family and returns a new pair', async () => {
      await createUser({ email: 'refresh@example.com', password: 'Password123!' });
      const { refreshToken } = await loginForTokens(app, 'refresh@example.com', 'Password123!');

      const res = await request(app).post('/api/auth/refresh').send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTypeOf('string');
      expect(res.body.refreshToken).toBeTypeOf('string');

      // The old token hash is marked revoked.
      const revoked = await prisma.refreshToken.findFirst({
        where: { token_hash: hashToken(refreshToken) },
      });
      expect(revoked?.revoked).toBe(true);
    });

    it('rejects an invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'not-a-valid-jwt' });

      expect(res.status).toBe(401);
    });

    it('rejects a revoked refresh token', async () => {
      await createUser({ email: 'revoked@example.com', password: 'Password123!' });
      const { refreshToken } = await loginForTokens(app, 'revoked@example.com', 'Password123!');

      // Use it once to rotate and revoke the original.
      await request(app).post('/api/auth/refresh').send({ refreshToken });

      // Reusing the same (now-revoked) token must fail.
      const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
      expect(res.status).toBe(401);
    });

    it('rejects when the refresh token is missing', async () => {
      const res = await request(app).post('/api/auth/refresh').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the refresh token and returns confirmation', async () => {
      await createUser({ email: 'logout@example.com', password: 'Password123!' });
      const { refreshToken } = await loginForTokens(app, 'logout@example.com', 'Password123!');

      const res = await request(app).post('/api/auth/logout').send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Logged out' });

      const stored = await prisma.refreshToken.findFirst({
        where: { token_hash: hashToken(refreshToken) },
      });
      expect(stored?.revoked).toBe(true);
    });

    it('still succeeds when no refresh token is provided', async () => {
      const res = await request(app).post('/api/auth/logout').send({});
      expect(res.status).toBe(200);
    });
  });

  describe('full setup → login → refresh → logout lifecycle', () => {
    it('activates a pending account and completes the auth lifecycle', async () => {
      // Create a PENDING_SETUP user directly (as inviteUser would, minus the email).
      const rawToken = 'setup-raw-token';
      const passwordHash = await hashPassword('Password123!');
      const user = await prisma.user.create({
        data: {
          email: 'newhire@example.com',
          password_hash: passwordHash,
          role: 'EMPLOYEE',
          status: 'PENDING_SETUP',
          setup_token: hashToken(rawToken),
          setup_token_expires: new Date(Date.now() + 3_600_000),
        },
      });

      // Activate the account.
      const setupRes = await request(app)
        .post('/api/auth/setup')
        .send({ token: rawToken, password: 'NewPassword123!' });
      expect(setupRes.status).toBe(200);
      expect(setupRes.body).toEqual({ message: 'Account activated successfully' });

      const activated = await prisma.user.findUnique({ where: { id: user.id } });
      expect(activated?.status).toBe('ACTIVE');
      expect(activated?.setup_token).toBeNull();

      // Login with the new password.
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'newhire@example.com', password: 'NewPassword123!' });
      expect(loginRes.status).toBe(200);
      const refreshToken = loginRes.body.refreshToken as string;

      // Refresh using the issued refresh token.
      const refreshRes = await request(app).post('/api/auth/refresh').send({ refreshToken });
      expect(refreshRes.status).toBe(200);

      // Logout.
      const logoutRes = await request(app).post('/api/auth/logout').send({ refreshToken });
      expect(logoutRes.status).toBe(200);
    });

    it('rejects setup with an expired token', async () => {
      await prisma.user.create({
        data: {
          email: 'expired@example.com',
          role: 'EMPLOYEE',
          status: 'PENDING_SETUP',
          setup_token: hashToken('expired-token'),
          setup_token_expires: new Date(Date.now() - 1000),
        },
      });

      const res = await request(app)
        .post('/api/auth/setup')
        .send({ token: 'expired-token', password: 'NewPassword123!' });

      expect(res.status).toBe(400);
    });
  });
});
