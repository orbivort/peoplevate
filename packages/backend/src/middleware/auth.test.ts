import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../utils/token.js', () => ({ verifyJwt: vi.fn() }));

vi.mock('../config/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { verifyJwt } from '../utils/token.js';
import { prisma } from '../config/prisma.js';
import { authenticate, getAuthUser, type AuthenticatedRequest } from './auth.js';

const mockedVerifyJwt = vi.mocked(verifyJwt);
const mockedFindUnique = vi.mocked(prisma.user.findUnique);

function buildRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['json'];
  return res;
}

function buildReq(authorization?: string): Request {
  return { headers: authorization ? { authorization } : {} } as unknown as Request;
}

describe('authenticate middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('rejects a request with no authorization header', async () => {
    const res = buildRes();

    await authenticate(buildReq(), res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an authorization header that is not a Bearer token', async () => {
    const res = buildRes();

    await authenticate(buildReq('Basic abc123'), res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token', async () => {
    mockedVerifyJwt.mockReturnValue(null as never);
    const res = buildRes();

    await authenticate(buildReq('Bearer bad-token'), res, next);

    expect(mockedVerifyJwt).toHaveBeenCalledWith('bad-token');
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists', async () => {
    mockedVerifyJwt.mockReturnValue({ userId: 'u1' } as never);
    mockedFindUnique.mockResolvedValue(null as never);
    const res = buildRes();

    await authenticate(buildReq('Bearer good-token'), res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Account is not active' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when the user account is not ACTIVE', async () => {
    mockedVerifyJwt.mockReturnValue({ userId: 'u1' } as never);
    mockedFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@example.com',
      role: 'EMPLOYEE',
      status: 'SUSPENDED',
      employee: { id: 'e1' },
    } as never);
    const res = buildRes();

    await authenticate(buildReq('Bearer good-token'), res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches the user and calls next for an active account', async () => {
    mockedVerifyJwt.mockReturnValue({ userId: 'u1' } as never);
    mockedFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@example.com',
      role: 'HR_MANAGER',
      status: 'ACTIVE',
      employee: { id: 'e1' },
    } as never);
    const req = buildReq('Bearer good-token');
    const res = buildRes();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as AuthenticatedRequest).user).toEqual({
      userId: 'u1',
      role: 'HR_MANAGER',
      email: 'a@example.com',
      employeeId: 'e1',
    });
  });

  it('sets employeeId to null when the user has no linked employee', async () => {
    mockedVerifyJwt.mockReturnValue({ userId: 'u2' } as never);
    mockedFindUnique.mockResolvedValue({
      id: 'u2',
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      employee: null,
    } as never);
    const req = buildReq('Bearer good-token');
    const res = buildRes();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as AuthenticatedRequest).user?.employeeId).toBeNull();
  });
});

describe('getAuthUser', () => {
  it('returns the attached user', () => {
    const req = { user: { userId: 'u1', role: 'ADMIN', email: 'a@example.com' } } as AuthenticatedRequest;

    expect(getAuthUser(req)).toEqual({ userId: 'u1', role: 'ADMIN', email: 'a@example.com' });
  });

  it('throws when no user is attached', () => {
    expect(() => getAuthUser({} as Request)).toThrow(
      'Authenticated user not found. Ensure the authenticate middleware is applied.',
    );
  });
});
