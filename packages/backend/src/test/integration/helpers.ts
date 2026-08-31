/**
 * Shared helpers for the backend integration test suite.
 *
 * These helpers import the REAL app, Prisma client, and services (no mocking),
 * so tests exercise the full request → route → service → database stack.
 *
 * Note: modules imported here are only loaded after the per-worker setup has
 * set `DATABASE_URL`, so `src/config/env.ts` and `src/config/prisma.ts` connect
 * to the local `peoplevate_test` database.
 */
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { prisma } from '../../config/prisma.js';
import { hashPassword } from '../../utils/password.js';
import { bootstrapKeyVersions } from '../../services/key-management-service.js';
import type { UserRole, UserStatus } from '#prisma';

export { prisma };
export type { UserRole, UserStatus };

/** A real Express app with every route wired up, ready for supertest. */
export function createTestApp(): Express {
  return createApp();
}

/**
 * Creates an active user directly in the DB (bypassing the setup-token flow)
 * and returns a set of fields useful for driving authenticated requests.
 */
export async function createUser(overrides?: {
  email?: string;
  role?: UserRole;
  password?: string;
  employeeId?: string | null;
}): Promise<{
  id: string;
  email: string;
  role: string;
  password: string;
}> {
  const password = overrides?.password ?? 'Password123!';
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email: (overrides?.email ?? `user-${crypto.randomUUID()}@example.com`).toLowerCase(),
      password_hash: passwordHash,
      role: overrides?.role ?? 'EMPLOYEE',
      status: 'ACTIVE',
      ...(overrides?.employeeId !== undefined
        ? { employee: { connect: { id: overrides.employeeId } } }
        : {}),
    },
    select: { id: true, email: true, role: true },
  });

  return { id: user.id, email: user.email, role: user.role, password };
}

/**
 * Logs a user in through the real `/api/auth/login` route and returns the full
 * auth result. The refresh token is read from the httpOnly `Set-Cookie` header
 * (it is never present in the JSON body), so tests can replay it as a Cookie
 * header on subsequent refresh/logout calls.
 */
export async function loginForTokens(
  app: Express,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string; user: { id: string; role: string } }> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  const setCookie = res.headers['set-cookie'];
  const cookie = Array.isArray(setCookie) ? String(setCookie[0]) : String(setCookie ?? '');
  const match = /refresh_token=([^;]+)/.exec(cookie);
  if (!match) {
    throw new Error('Login response did not set the refresh_token cookie');
  }
  const body = res.body as {
    accessToken: string;
    user: { id: string; role: string };
  };
  return {
    accessToken: body.accessToken,
    refreshToken: match[1],
    user: body.user,
  };
}

/** Logs a user in and returns only the Bearer access token. */
export async function loginForToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const tokens = await loginForTokens(app, email, password);
  return tokens.accessToken;
}

/**
 * Resets every table so each test starts from a clean slate.
 *
 * Truncates all tables with CASCADE to respect foreign keys. Order is handled
 * by Postgres; the transaction guards against partial resets.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma_%';
  `;

  if (tables.length === 0) return;

  const names = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE;`);

  // Truncation wipes encryption key versions, so re-bootstrap them. Flows that
  // encrypt data at rest (e.g. document upload) depend on an ACTIVE key version
  // for DATA_ENCRYPTION; without this they fail with a 500.
  await bootstrapKeyVersions();
}

/** Disconnects the shared Prisma client (call in afterAll of a top-level suite). */
export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
