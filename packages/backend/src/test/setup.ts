/**
 * Backend test setup.
 *
 * Primary test environment is provided by `packages/backend/.env.test`, which
 * Vitest loads via the `envFile` option in `vitest.config.ts`. The fallbacks
 * below are defensive only: they ensure `src/config/env.ts` never exits the
 * worker even if the env file is missing, and they keep argon2/password tests
 * fast. Any value a test relies on should still be asserted explicitly.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??=
  'postgresql://peoplevate:peoplevate@localhost:5432/peoplevate_test?schema=public';
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long!';
process.env.FIELD_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Keep argon2 memory/time costs low so password tests run fast in CI.
process.env.ARGON2_MEMORY_COST ??= '2048';
process.env.ARGON2_TIME_COST ??= '1';
process.env.ARGON2_PARALLELISM ??= '1';
process.env.PASSWORD_MIN_LENGTH ??= '8';
