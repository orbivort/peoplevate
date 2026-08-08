import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '#prisma';
import { errorHandler } from './error-handler.js';
import { HttpError } from '../utils/http-error.js';
import { InvalidTransitionError } from '../utils/state-machine.js';
import { logger } from '../config/logger.js';

vi.mock('../config/logger.js', () => ({
  logger: { error: vi.fn() },
}));

const mockedLoggerError = vi.mocked(logger.error);

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

function buildReq(): Request {
  return {} as Request;
}

describe('errorHandler', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('logs the error message and stack on every call', () => {
    const res = buildRes();
    const err = new Error('boom');

    errorHandler(err, buildReq(), res, next);

    expect(mockedLoggerError).toHaveBeenCalledOnce();
    expect(mockedLoggerError).toHaveBeenCalledWith('boom', { stack: err.stack });
  });

  it('returns 400 with flattened field errors for a ZodError', () => {
    const res = buildRes();
    const zodErr = new ZodError([
      {
        code: 'custom',
        message: 'Required',
        path: ['email'],
      } as never,
    ]);

    errorHandler(zodErr, buildReq(), res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'Validation error',
      details: zodErr.flatten().fieldErrors,
    });
  });

  it('returns 400 for an InvalidTransitionError', () => {
    const res = buildRes();
    const err = new InvalidTransitionError('Recruitment', 'DRAFT', 'HIRED');

    errorHandler(err, buildReq(), res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: err.message });
  });

  it('returns 401 for an UnauthorizedError by name', () => {
    const res = buildRes();
    const err = Object.assign(new Error('No token'), { name: 'UnauthorizedError' });

    errorHandler(err, buildReq(), res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 409 for a Prisma P2002 unique constraint violation', () => {
    const res = buildRes();
    const err = new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002' });

    errorHandler(err, buildReq(), res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Resource already exists' });
  });

  it('returns 404 for a Prisma P2025 not found error', () => {
    const res = buildRes();
    const err = new Prisma.PrismaClientKnownRequestError('Missing', { code: 'P2025' });

    errorHandler(err, buildReq(), res, next);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Resource not found' });
  });

  it('returns the mapped status for another Prisma known request error', () => {
    const res = buildRes();
    const err = new Prisma.PrismaClientKnownRequestError('Other', { code: 'P2000' });

    errorHandler(err, buildReq(), res, next);

    // Falls through: Prisma error not P2002/P2025, not HttpError, no `.status`.
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('maps an HttpError status and message without a code', () => {
    const res = buildRes();
    const err = new HttpError(403, 'Forbidden');

    errorHandler(err, buildReq(), res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('includes the code on the response when HttpError carries one', () => {
    const res = buildRes();
    const err = new HttpError(422, 'Invalid input', 'VALIDATION_FAILED');

    errorHandler(err, buildReq(), res, next);

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({ error: 'Invalid input', code: 'VALIDATION_FAILED' });
  });

  it('returns 500 Internal server error for a plain error with no status', () => {
    const res = buildRes();
    const err = new Error('unexpected');

    errorHandler(err, buildReq(), res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('uses a custom status and message when the error defines `.status`', () => {
    const res = buildRes();
    const err = Object.assign(new Error('Bad gateway'), { status: 502 });

    errorHandler(err, buildReq(), res, next);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'Bad gateway' });
  });

  it('falls back to a generic message when a non-500 error lacks a message', () => {
    const res = buildRes();
    const err = Object.assign(new Error(''), { status: 400 }) as Error & { status: number };
    err.message = '';

    errorHandler(err, buildReq(), res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'An error occurred' });
  });
});
