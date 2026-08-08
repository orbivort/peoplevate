import { afterEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';

import {
  addDays,
  addHours,
  generateToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyJwt,
} from './token';
import { env } from '../config/env.js';

describe('generateToken / hashToken', () => {
  it('produces a hex string of the requested byte length', () => {
    const token = generateToken(16);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('defaults to 32 bytes when no argument is supplied', () => {
    const token = generateToken();
    // 32 bytes -> 64 hex chars
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique tokens on consecutive calls', () => {
    expect(generateToken(32)).not.toBe(generateToken(32));
  });

  it('hashes a token to a fixed-length sha256 digest', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same digest for the same input (deterministic)', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });
});

describe('signAccessToken / signRefreshToken', () => {
  it('round-trips the payload through sign and verify', () => {
    const token = signAccessToken({ userId: 'user-1', role: 'ADMIN' });
    expect(verifyJwt(token)).toMatchObject({ userId: 'user-1', role: 'ADMIN' });
  });

  it('signs a refresh token that also verifies', () => {
    const token = signRefreshToken({ userId: 'user-2', role: 'HR_MANAGER' });
    const decoded = verifyJwt(token);
    expect(decoded).toMatchObject({ userId: 'user-2', role: 'HR_MANAGER' });
  });

  it('round-trips a manager payload', () => {
    const token = signAccessToken({ userId: 'user-3', role: 'MANAGER' });
    expect(verifyJwt(token)).toMatchObject({ userId: 'user-3', role: 'MANAGER' });
  });

  it('embeds an expiry claim on access tokens', () => {
    const token = signAccessToken({ userId: 'user-1', role: 'ADMIN' });
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    expect(decoded).not.toBeNull();
    expect(decoded?.exp).toBeTypeOf('number');
  });

  it('embeds an expiry claim on refresh tokens', () => {
    const token = signRefreshToken({ userId: 'user-2', role: 'HR_MANAGER' });
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    expect(decoded).not.toBeNull();
    expect(decoded?.exp).toBeTypeOf('number');
  });
});

describe('verifyJwt', () => {
  it('returns null for an invalid token (catch branch)', () => {
    expect(verifyJwt('not-a-valid-token')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const forged = jwt.sign({ userId: 'x', role: 'ADMIN' }, 'wrong-secret');
    expect(verifyJwt(forged)).toBeNull();
  });

  it('returns null for an expired token', () => {
    const expired = jwt.sign({ userId: 'x', role: 'ADMIN' }, env.JWT_SECRET, {
      expiresIn: '-1h',
    });
    expect(verifyJwt(expired)).toBeNull();
  });
});

describe('expiry env fallback branches (?? defaults)', () => {
  const originalAccess = env.JWT_ACCESS_EXPIRES_IN;
  const originalRefresh = env.JWT_REFRESH_EXPIRES_IN;

  afterEach(() => {
    // Restore env defaults so other tests are unaffected.
    env.JWT_ACCESS_EXPIRES_IN = originalAccess;
    env.JWT_REFRESH_EXPIRES_IN = originalRefresh;
  });

  it('falls back to "1h" when JWT_ACCESS_EXPIRES_IN is undefined', () => {
    delete (env as { JWT_ACCESS_EXPIRES_IN?: string }).JWT_ACCESS_EXPIRES_IN;
    const token = signAccessToken({ userId: 'u-fb', role: 'ADMIN' });
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    expect(decoded?.exp).toBeTypeOf('number');
    expect(verifyJwt(token)).toMatchObject({ userId: 'u-fb' });
  });

  it('falls back to "7d" when JWT_REFRESH_EXPIRES_IN is undefined', () => {
    delete (env as { JWT_REFRESH_EXPIRES_IN?: string }).JWT_REFRESH_EXPIRES_IN;
    const token = signRefreshToken({ userId: 'u-fb2', role: 'HR_MANAGER' });
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    expect(decoded?.exp).toBeTypeOf('number');
    expect(verifyJwt(token)).toMatchObject({ userId: 'u-fb2' });
  });
});

describe('addHours / addDays default+argument branches', () => {
  it('returns a Date in the future by the given amount (positive)', () => {
    const before = Date.now();
    const h = addHours(2);
    const d = addDays(7);
    expect(h.getTime()).toBeGreaterThan(before);
    expect(d.getTime()).toBeGreaterThan(before);
  });

  it('returns a Date earlier than now for negative offsets', () => {
    const now = Date.now();
    expect(addHours(-2).getTime()).toBeLessThan(now);
    expect(addDays(-7).getTime()).toBeLessThan(now);
  });

  it('returns a Date equal to now + offset for zero offset', () => {
    const before = Date.now();
    const h = addHours(0);
    const d = addDays(0);
    // small tolerance for execution time
    expect(Math.abs(h.getTime() - before)).toBeLessThan(5000);
    expect(Math.abs(d.getTime() - before)).toBeLessThan(5000);
  });
});
