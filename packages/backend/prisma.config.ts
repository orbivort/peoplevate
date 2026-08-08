import { defineConfig, env } from 'prisma/config';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Prisma v7 does not load environment variables automatically. Load them here
// so the CLI (migrate, db push, generate, seed) can resolve datasource URLs.
// Pick the env file that matches NODE_ENV (e.g. .env.test) so each environment
// resolves the correct DATABASE_URL. Resolution is cwd-independent.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
config({ path: resolve(__dirname, envFile) });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
