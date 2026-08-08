/**
 * Per-worker setup for the backend integration test suite.
 *
 * Runs in every test worker before any test file (and therefore before any app
 * module such as `src/config/env.ts` or `src/config/prisma.ts`) is imported. It
 * resolves the local test database connection string and injects the env vars
 * the app expects at import time.
 *
 * Because each worker gets its own copy of process.env, the DATABASE_URL must be
 * set here rather than relying on global setup state.
 */
import { readPublishedConnection } from './global-setup.js';

function resolveDatabaseUrl(): string {
  // 1. Explicit override for CI/custom setups.
  if (process.env.INTEGRATION_DATABASE_URL) {
    return process.env.INTEGRATION_DATABASE_URL;
  }

  // 2. Connection string published by the global setup.
  const connection = readPublishedConnection();
  if (connection?.connectionString) {
    return connection.connectionString;
  }

  // 3. Already-present DATABASE_URL (e.g. when running workers standalone).
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  throw new Error(
    'Could not resolve an integration test database URL. The global setup must run before ' +
      'tests (configured via globalSetup in vitest.integration.config.ts), or set ' +
      'INTEGRATION_DATABASE_URL / DATABASE_URL explicitly.',
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = resolveDatabaseUrl();

// Same low-cost / test-only values used by the unit suite.
process.env.JWT_SECRET ??= 'integration-secret-that-is-at-least-32-characters-long!';
process.env.FIELD_ENCRYPTION_KEY ??=
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
process.env.ARGON2_MEMORY_COST ??= '2048';
process.env.ARGON2_TIME_COST ??= '1';
process.env.ARGON2_PARALLELISM ??= '1';
process.env.PASSWORD_MIN_LENGTH ??= '8';

// Integration tests focus on the DB/service/route contract, not rate limiting
// (that is covered by unit tests), so lift the login limiter ceiling to avoid
// flaky failures when several auth tests login in quick succession.
process.env.LOGIN_RATE_LIMIT_PER_MIN ??= '1000';

// Keep logs quiet unless DEBUG is explicitly requested.
process.env.NODE_ENV = 'test';
