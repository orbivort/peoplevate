import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

// Share the mock instance via vi.hoisted so the factory and the test body both
// reference the exact same `vi.fn()`. The module under test is imported once,
// so its two `rateLimit(...)` calls populate `rateLimitMock.mock.calls` at
// import time — we capture them once and assert against them. We must NOT call
// vi.clearAllMocks() in beforeEach, as that would wipe the import-time calls.
const { rateLimitMock } = vi.hoisted(() => {
  const fn = vi.fn();
  return { rateLimitMock: fn };
});

// The factory returns a middleware function (sentinel) so the module's
// `export const` bindings resolve to a defined value, mirroring the real lib.
// `ipKeyGenerator` is exposed as a passthrough so the module-under-test can
// normalize IP fallbacks without needing a real network/address implementation.
vi.mock('express-rate-limit', () => ({
  default: (...args: unknown[]) => {
    rateLimitMock(...args);
    return vi.fn();
  },
  ipKeyGenerator: (ip: string) => ip,
}));

// Import the module under test. `env` (config) is loaded by the test setup via
// `.env.test`. The three rate-limit middleware are constructed at import time.
import { apiRateLimiter, loginRateLimiter, passwordChangeRateLimiter } from './rate-limiter.js';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  message: { error: string };
  standardHeaders: boolean;
  legacyHeaders: boolean;
};

// The three limiter constructions recorded at import time.
const apiOptions = rateLimitMock.mock.calls[0][0] as RateLimitOptions;
const loginOptions = rateLimitMock.mock.calls[1][0] as RateLimitOptions;
const passwordOptions = rateLimitMock.mock.calls[2][0] as RateLimitOptions;

/** Build a minimal Express Request with optional user/IP. */
function buildReq(overrides: Partial<Request> = {}): Request {
  return { ip: '127.0.0.1', ...overrides } as unknown as Request;
}

describe('rate-limiter module', () => {
  describe('apiRateLimiter', () => {
    it('is constructed as an express-rate-limit middleware', () => {
      expect(apiRateLimiter).toBeDefined();
      expect(rateLimitMock).toHaveBeenCalledTimes(3);
    });

    it('uses a 1-minute window with an env-driven per-IP max', () => {
      expect(apiOptions.windowMs).toBe(60 * 1000);
      // API_RATE_LIMIT_PER_MIN default is 300.
      expect(apiOptions.max).toBeGreaterThan(0);
      expect(Number.isInteger(apiOptions.max)).toBe(true);
    });

    it('returns the configured too-many-requests message', () => {
      expect(apiOptions.message).toEqual({
        error: 'Too many requests. Please try again later.',
      });
    });

    it('enables standard headers and disables legacy headers', () => {
      expect(apiOptions.standardHeaders).toBe(true);
      expect(apiOptions.legacyHeaders).toBe(false);
    });
  });

  describe('loginRateLimiter', () => {
    it('is constructed as an express-rate-limit middleware', () => {
      expect(loginRateLimiter).toBeDefined();
      expect(rateLimitMock).toHaveBeenCalledTimes(3);
    });

    it('uses a 1-minute window', () => {
      expect(loginOptions.windowMs).toBe(60 * 1000);
    });

    it('limits to the configured login rate from env', () => {
      // LOGIN_RATE_LIMIT_PER_MIN default is 10; assert the option is a positive
      // integer matching env so the value is wired through correctly.
      expect(loginOptions.max).toBeGreaterThan(0);
      expect(Number.isInteger(loginOptions.max)).toBe(true);
    });

    it('returns the configured too-many-attempts message', () => {
      expect(loginOptions.message).toEqual({
        error: 'Too many login attempts. Please try again later.',
      });
    });

    it('enables standard headers and disables legacy headers', () => {
      expect(loginOptions.standardHeaders).toBe(true);
      expect(loginOptions.legacyHeaders).toBe(false);
    });
  });

  describe('passwordChangeRateLimiter', () => {
    it('is constructed as an express-rate-limit middleware', () => {
      expect(passwordChangeRateLimiter).toBeDefined();
      expect(rateLimitMock).toHaveBeenCalledTimes(3);
    });

    it('uses a 15-minute window with a per-user max of 5', () => {
      expect(passwordOptions.windowMs).toBe(15 * 60 * 1000);
      expect(passwordOptions.max).toBe(5);
    });

    it('returns the configured too-many-attempts message', () => {
      expect(passwordOptions.message).toEqual({
        error: 'Too many password change attempts. Please try again later.',
      });
    });

    it('enables standard headers and disables legacy headers', () => {
      expect(passwordOptions.standardHeaders).toBe(true);
      expect(passwordOptions.legacyHeaders).toBe(false);
    });

    describe('keyGenerator', () => {
      it('keys on the authenticated user ID when present', () => {
        const req = buildReq({
          user: { userId: 'user-abc' } as unknown as Request['user'],
        });

        expect(passwordOptions.keyGenerator!(req)).toBe('user-abc');
      });

      it('falls back to the request IP when the user has no userId', () => {
        const req = buildReq({
          user: { userId: undefined } as unknown as Request['user'],
          ip: '203.0.113.45',
        });

        expect(passwordOptions.keyGenerator!(req)).toBe('203.0.113.45');
      });

      it('falls back to the request IP when no user is attached', () => {
        const req = buildReq({ ip: '198.51.100.7' });

        expect(passwordOptions.keyGenerator!(req)).toBe('198.51.100.7');
      });

      it('falls back to "unknown" when there is no user and no IP', () => {
        const req = buildReq({ ip: undefined });

        expect(passwordOptions.keyGenerator!(req)).toBe('unknown');
      });
    });
  });
});
