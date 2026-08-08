/**
 * Peoplevate E2E orchestration.
 *
 * Boots a REAL backend + REAL frontend against a dedicated, freshly-reset and
 * seeded E2E database, then runs the Playwright suite against them.
 *
 * Responsibilities:
 *   1. Resolve E2E env (packages/e2e/.env or process env, with local defaults).
 *   2. Drop + recreate the E2E database for a clean slate.
 *   3. Apply Prisma migrations, then run the backend seed (demo accounts).
 *   4. Start the backend (DATABASE_URL = E2E DB) and the frontend (no mock).
 *   5. Wait for the backend /health and the frontend to be reachable.
 *   6. Run `playwright test`, then tear down both servers.
 *
 * The script intentionally mirrors the existing integration-test DB handling
 * (which runs against `peoplevate_test`) but uses its own `peoplevate_e2e`
 * database so E2E never clobbers developer or CI data.
 *
 * Usage (from repo root):
 *   pnpm test:e2e
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const e2eRoot = resolve(__dirname, '..');
const repoRoot = resolve(e2eRoot, '../..');
const backendRoot = resolve(repoRoot, 'packages/backend');
const frontendRoot = resolve(repoRoot, 'packages/frontend');

// Load packages/e2e/.env if present (dotenv never overrides real env vars).
loadDotEnv({ path: resolve(e2eRoot, '.env') });

const FRONTEND_URL = process.env.E2E_BASE_URL;
const BACKEND_URL = process.env.E2E_API_URL;
const FRONTEND_PORT = new URL(FRONTEND_URL).port;
const BACKEND_PORT = new URL(BACKEND_URL).port;
const DB_URL = process.env.E2E_DB_URL;

/** Wait for an HTTP endpoint to respond with 2xx, with a timeout. */
async function waitForHttp(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${url} to become healthy`);
}

/** Drops and recreates the E2E database so every run starts clean. */
async function resetDatabase() {
  const url = new URL(DB_URL);
  const dbName = url.pathname.replace(/^\//, '').split('?')[0] || 'peoplevate_test';
  const maintenance = new URL(DB_URL);
  maintenance.pathname = '/postgres';
  maintenance.search = '';

  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    // Terminate lingering connections so DROP DATABASE succeeds. Retry a few
    // times: a backend that is still winding down can keep the DB from being
    // dropped, which would otherwise leave a stale (partially-seeded / locked)
    // database for the run and break login.
    for (let attempt = 1; attempt <= 5; attempt++) {
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      try {
        await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        break;
      } catch (dropErr) {
        if (attempt === 5) throw dropErr;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    await client.query(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    throw new Error(
      `Could not reset the E2E database "${dbName}". Is PostgreSQL running and is the ` +
        `role in ${DB_URL} able to create databases?\nOriginal error: ${err.message ?? err}`,
      { cause: err },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Runs a command and waits for it to exit successfully, streaming output. */
function run(cmd, args, opts) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, ...opts?.env },
      cwd: opts?.cwd,
      shell: process.platform === 'win32',
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

/** Applies migrations + runs the seed against the E2E database. */
async function provisionDatabase() {
  // prisma.config.ts resolves .env
  // and injecting DATABASE_URL ensures the CLI targets the E2E database.
  const env = { ...process.env, DATABASE_URL: DB_URL };

  await run('pnpm', ['db:migrate'], { cwd: backendRoot, env });
  // The seed reads the same env; run it via the backend package script.
  await run('pnpm', ['db:seed'], { cwd: backendRoot, env });
}

/** Spawns the backend, returns the child. */
function startBackend() {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    E2E_MODE: 'true',
    // Deliver emails to the in-process mock mailbox so the E2E run never tries
    // to reach an SMTP server (avoids ECONNREFUSED noise on 127.0.0.1:587).
    EMAIL_MODE: 'mock',
    PORT: BACKEND_PORT,
    DATABASE_URL: DB_URL,
    CORS_ORIGIN: FRONTEND_URL,
  };
  return spawn('pnpm', ['--filter', '@peoplevate/backend', 'dev'], {
    stdio: 'inherit',
    cwd: repoRoot,
    env,
    shell: process.platform === 'win32',
  });
}

/** Spawns the frontend dev server (real API, no mock), returns the child. */
function startFrontend() {
  const env = {
    ...process.env,
    VITE_USE_MOCK: 'false',
    VITE_API_PROXY_TARGET: BACKEND_URL,
    // Bind Vite to the same port the orchestrator probes (FRONTEND_URL) and that
    // Playwright navigates to. Without this, vite.config.ts falls back to 5173 and
    // the server comes up on the wrong port while E2E_BASE_URL points elsewhere.
    VITE_DEV_PORT: FRONTEND_PORT,
  };
  return spawn('pnpm', ['--filter', '@peoplevate/frontend', 'dev'], {
    stdio: 'inherit',
    cwd: repoRoot,
    env,
    shell: process.platform === 'win32',
  });
}

async function main() {
  console.log('\n=== Peoplevate E2E ===\n');

  if (process.env.E2E_SKIP_DB_RESET !== 'true') {
    console.log(`Resetting E2E database...`);
    await resetDatabase();
    console.log(`Provisioning schema + seed...`);
    await provisionDatabase();
  } else {
    console.log('Skipping DB reset (E2E_SKIP_DB_RESET=true). Assuming DB is ready.');
  }

  const backend = startBackend();
  const frontend = startFrontend();

  let backendHealthy = false;
  let frontendHealthy = false;
  try {
    await waitForHttp(`${BACKEND_URL}/health`);
    backendHealthy = true;
    await waitForHttp(FRONTEND_URL);
    frontendHealthy = true;

    console.log('\nBackend and frontend are up. Running Playwright...\n');
    await run(
      'pnpm',
      ['--filter', '@peoplevate/e2e', 'test'],
      { cwd: repoRoot },
    );
  } finally {
    console.log('\nTearing down E2E servers...');
    backend.kill();
    frontend.kill();
    if (!backendHealthy) console.warn('Backend never became healthy.');
    if (!frontendHealthy) console.warn('Frontend never became healthy.');
  }
}

main().catch((err) => {
  console.error('\nE2E failed:', err.message ?? err);
  process.exit(1);
});
