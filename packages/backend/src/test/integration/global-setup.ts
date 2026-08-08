/**
 * Global setup for the backend integration test suite.
 *
 * Runs against a single local PostgreSQL database named `peoplevate_test`
 * (as declared in `packages/backend/.env.test`), applying the Prisma migrations
 * before the suite starts. No Docker containers are used.
 *
 * The connection string is resolved in this order:
 *   1. `INTEGRATION_DATABASE_URL` — explicit override, if set.
 *   2. `DATABASE_URL` from `packages/backend/.env.test` (the default local DB).
 *
 * The resolved URL is written to a JSON file that the per-worker setup
 * (`setup.ts`) reads so `src/config/env.ts` can resolve `DATABASE_URL` before
 * any app module is imported. This file-based handoff is needed because
 * Vitest's globalSetup runs in a separate process from the test workers, so env
 * vars set here do not propagate automatically.
 *
 * If the target database does not exist yet it is created automatically (when
 * the connecting role has CREATEDB). The returned teardown is a no-op — the
 * local database is shared and intentionally left in place.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config as loadDotEnv } from 'dotenv';
import pg from 'pg';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '../../../');

// Load the backend `.env.test` so its defaults (DATABASE_URL, secrets) are
// available to the global setup process without hard-coding them twice. dotenv
// does not override already-set env vars, so an explicit
// INTEGRATION_DATABASE_URL still wins.
loadDotEnv({ path: resolve(backendRoot, '.env.test') });

/** Where the resolved connection string is published for the test workers. */
export const CONNECTION_FILE = resolve(__dirname, '.integration-connection.json');

/** Published shape read by the per-worker setup. */
export interface ConnectionInfo {
  connectionString: string;
}

function publishConnection(info: ConnectionInfo): void {
  writeFileSync(CONNECTION_FILE, JSON.stringify(info, null, 2));
}

function removeConnectionFile(): void {
  if (existsSync(CONNECTION_FILE)) rmSync(CONNECTION_FILE, { force: true });
}

/**
 * Resolves the local test database connection string.
 *
 * Precedence:
 *   1. `INTEGRATION_DATABASE_URL` (explicit override for CI/custom setups).
 *   2. `DATABASE_URL` loaded from `packages/backend/.env.test`.
 */
export function resolveLocalDatabaseUrl(): string {
  const override = process.env.INTEGRATION_DATABASE_URL;
  const url = override || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Could not resolve an integration test database URL. Set INTEGRATION_DATABASE_URL ' +
        'or DATABASE_URL in packages/backend/.env.test.',
    );
  }
  return url;
}

/**
 * Ensures the target database exists, creating it if necessary.
 *
 * Parses the connection string, connects to the `postgres` maintenance database
 * with the same credentials, and issues `CREATE DATABASE` when the database is
 * missing. Fails fast with a clear message if the local server is unreachable or
 * the role lacks CREATEDB.
 */
async function ensureDatabaseExists(connectionString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Invalid URL — let `prisma migrate deploy` surface a more specific error.
    return;
  }

  const dbName = url.pathname.replace(/^\//, '').split('?')[0];
  if (!dbName || dbName === 'postgres') return;

  // Connect to the maintenance DB to check/create the target database.
  const maintenance = new URL(connectionString);
  maintenance.pathname = '/postgres';
  maintenance.search = '';

  const client = new pg.Client({ connectionString: maintenance.toString() });
  try {
    await client.connect();
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } catch (err) {
    const e = err as { message?: string };
    throw new Error(
      `Could not reach the local PostgreSQL server for integration tests. Make sure it is ` +
        `running and that the database and role in the connection string exist.\n` +
        `Connection: ${maintenance.toString()}\n` +
        `Original error: ${e.message ?? String(err)}`,
      { cause: err },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Applies the Prisma migrations to the local test database.
 *
 * Runs the local Prisma CLI as a subprocess with the resolved connection string
 * injected, mirroring how migrations are applied in other environments.
 */
async function applyMigrations(connectionString: string): Promise<void> {
  // Invoke the Prisma CLI through `node` directly instead of its .bin shim so
  // the same code works on POSIX and Windows without shelling out (avoids the
  // `shell: true` deprecation/security warning). The `prisma` symlink in the
  // backend's node_modules resolves to the real package regardless of platform.
  const prismaCli = resolve(backendRoot, 'node_modules/prisma/build/index.js');

  try {
    await execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: backendRoot,
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
      },
    });
  } catch (err) {
    // Best-effort diagnostics: surface the CLI output so a broken migration is
    // debuggable instead of swallowed.
    const e = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `Failed to apply Prisma migrations to the integration database.\n` +
        `stdout:\n${e.stdout ?? ''}\nstderr:\n${e.stderr ?? ''}\n${e.message ?? ''}`,
      { cause: err },
    );
  }
}

/** Vitest globalSetup entry point. */
export default async function setup(): Promise<() => Promise<void>> {
  // A stale connection file from an interrupted run must not be reused.
  removeConnectionFile();

  const connectionString = resolveLocalDatabaseUrl();
  await ensureDatabaseExists(connectionString);
  await applyMigrations(connectionString);
  publishConnection({ connectionString });

  // Local database is shared and persistent; nothing to tear down.
  return async () => {
    removeConnectionFile();
  };
}

// Expose a helper so callers can read back the published connection without
// importing the container library (used by the per-worker setup).
export function readPublishedConnection(): ConnectionInfo | null {
  if (!existsSync(CONNECTION_FILE)) return null;
  return JSON.parse(readFileSync(CONNECTION_FILE, 'utf8')) as ConnectionInfo;
}
