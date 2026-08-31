import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Global API rate limiter applied to every /api route as a baseline defense
 * against brute-force and resource-exhaustion abuse of authenticated business
 * endpoints. Stricter per-endpoint limiters (login, password change) remain in
 * place and run in addition to this baseline. Disabled in E2E mode (and tests)
 * for the same reason as the login limiter: the suites issue many requests
 * from a single host and would otherwise trip the per-IP budget.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: env.E2E_MODE || env.NODE_ENV === 'test' ? Number.MAX_SAFE_INTEGER : env.API_RATE_LIMIT_PER_MIN,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  // In E2E mode the suite logs in as several seeded accounts from a single
  // machine (localhost); the per-IP budget would be exhausted immediately and
  // surface a misleading "Too many login attempts" error. Disable the limit in
  // that context only.
  max: env.E2E_MODE ? Number.MAX_SAFE_INTEGER : env.LOGIN_RATE_LIMIT_PER_MIN,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Per-user rate limiter for the password change endpoint.
 * Limits to 5 requests per 15 minutes, keyed on the authenticated user ID
 * to prevent brute-forcing the current password field.
 */
export const passwordChangeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  keyGenerator: (req) => {
    // Use the authenticated user ID; fall back to the normalized IP for
    // unauthenticated requests (though the authenticate middleware should block
    // those first). ipKeyGenerator is required so IPv6 clients are correctly
    // keyed and don't bypass the limit (see ERR_ERL_KEY_GEN_IPV6).
    const user = (req as { user?: { userId?: string } }).user;
    return user?.userId ?? (req.ip ? ipKeyGenerator(req.ip) : 'unknown');
  },
  message: { error: 'Too many password change attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
