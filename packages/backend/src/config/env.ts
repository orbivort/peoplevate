import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // When true, the backend is being driven by the end-to-end suite. The E2E
  // orchestrator runs many logins from a single machine (localhost), which would
  // otherwise trip the per-IP login rate limit and surface a misleading
  // "Too many login attempts" error. In E2E mode the login limiter is effectively
  // disabled so the suite can exercise real auth/RBAC flows without being throttled.
  E2E_MODE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  ARGON2_MEMORY_COST: z.coerce.number().default(19456),
  ARGON2_TIME_COST: z.coerce.number().default(2),
  ARGON2_PARALLELISM: z.coerce.number().default(1),

  PASSWORD_MIN_LENGTH: z.coerce.number().default(8),
  ACCOUNT_LOCKOUT_THRESHOLD: z.coerce.number().default(5),
  ACCOUNT_LOCKOUT_DURATION_MIN: z.coerce.number().default(15),

  LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().default(10),

  // Baseline per-IP request budget for all /api routes (see apiRateLimiter).
  API_RATE_LIMIT_PER_MIN: z.coerce.number().default(300),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_FILE_SIZE_MB: z.coerce.number().default(25),

  // Directory where the backend writes log files (e.g. email.log). Resolved
  // relative to the backend working directory; the folder is created on startup
  // and is git-ignored.
  LOG_DIR: z.string().default('./logs'),

  PASSWORD_RESET_TOKEN_EXPIRY_HOURS: z.coerce.number().default(1),
  SETUP_TOKEN_EXPIRY_HOURS: z.coerce.number().default(24),

  // Email delivery strategy.
  //   real — deliver via SMTP using the SMTP_* variables below (production).
  //   mock — deliver to an in-process mailbox with zero network I/O (dev/test).
  EMAIL_MODE: z.enum(['real', 'mock']).default('real'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@peoplevate.local'),

  EXPIRY_CHECK_CRON_EXPRESSION: z.string().default('0 8 * * *'),

  TERMINATED_RECORD_RETENTION_YEARS: z.coerce.number().default(7),

  FIELD_ENCRYPTION_KEY: z.string().min(32),

  // Phase 2 — Workflow config
  ATTENDANCE_GRACE_MINUTES: z.coerce.number().default(5),
  ATTENDANCE_END_OF_BUSINESS: z.string().default('18:00'),
  NOTICE_PERIOD_MIN_DAYS: z.coerce.number().default(30),
  LEAVE_ACCRUAL_CRON_EXPRESSION: z.string().default('0 2 * * *'),
  DEACTIVATION_CHECK_CRON_EXPRESSION: z.string().default('0 3 * * *'),

  // Phase 2 — Performance: Probation cycle config
  PROBATION_DEFAULT_MONTHS: z.coerce.number().default(3),
  PROBATION_CYCLE_CRON_EXPRESSION: z.string().default('0 5 * * *'),
  PROBATION_AHEAD_DAYS: z.coerce.number().default(14),

  // GDPR Compliance - Data Subject Rights
  DSAR_SLA_DAYS: z.coerce.number().default(30),
  DSAR_REMINDER_DAYS: z.coerce.number().default(25),
  DPO_CONTACT_EMAIL: z.string().default('dpo@peoplevate.local'),

  // GDPR Compliance - Data Minimization
  IP_RETENTION_DAYS: z.coerce.number().default(90),

  // GDPR Compliance - Anomaly Detection
  ANOMALY_FAILED_LOGIN_THRESHOLD: z.coerce.number().default(20),
  ANOMALY_FAILED_LOGIN_WINDOW_MINUTES: z.coerce.number().default(15),
  ANOMALY_BULK_DOWNLOAD_THRESHOLD: z.coerce.number().default(50),
  ANOMALY_BULK_DOWNLOAD_WINDOW_MINUTES: z.coerce.number().default(60),

  // GDPR Compliance - Cron expressions
  RETENTION_PURGE_CRON_EXPRESSION: z.string().default('0 4 * * *'),
  DSAR_SLA_CRON_EXPRESSION: z.string().default('0 6 * * *'),
  BREACH_ESCALATION_CRON_EXPRESSION: z.string().default('0 * * * *'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
