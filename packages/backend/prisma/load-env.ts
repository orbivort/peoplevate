import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load the backend package .env into process.env. This module's side effect
// runs at import time and must be imported before any module that reads
// process.env (env.ts validates variables on load). Resolving relative to this
// file keeps it cwd-independent.
//
// When NODE_ENV is 'test', `.env.test` is loaded FIRST (as a base), then
// `.env` (only for non-conflicting keys) so the seed/E2E-provisioning runs
// with test-appropriate values while falling back to sensible defaults.
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.NODE_ENV === 'test') {
  config({ path: resolve(pkgDir, '.env.test') });
}
config({ path: resolve(pkgDir, '.env') });
