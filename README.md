<div align="center">

# Peoplevate

**An open-source Employee Lifecycle Management System**

Recruitment & onboarding · Attendance & leave · Performance · Offboarding · Documents · RBAC · Audit logging

[![License](https://img.shields.io/github/license/orbivort/peoplevate?style=flat-square)](./LICENSE)

[![CI](https://img.shields.io/github/actions/workflow/status/orbivort/peoplevate/ci.yml?branch=main&label=CI&logo=github&style=flat-square)](https://github.com/orbivort/peoplevate/actions/workflows/ci.yml)
[![codecov](https://codecov.io/github/orbivort/peoplevate/graph/badge.svg?token=9EBHXY249G)](https://codecov.io/github/orbivort/peoplevate)
[![Release](https://img.shields.io/github/v/release/orbivort/peoplevate?include_prereleases&sort=semver&style=flat-square)](https://github.com/orbivort/peoplevate/releases)
[![Open Issues](https://img.shields.io/github/issues/orbivort/peoplevate?style=flat-square)](https://github.com/orbivort/peoplevate/issues)

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white&style=flat-square)](./package.json)
[![Node.js](https://img.shields.io/badge/Node.js-%5E24-339933?logo=nodedotjs&logoColor=white&style=flat-square)](./package.json)
[![Docker](https://img.shields.io/badge/Docker-%5E24-2496ED?logo=docker&logoColor=white&style=flat-square)](./package.json)

</div>

---

## About

Peoplevate is a self-hosted Employee Lifecycle Management System that walks an employee through their entire journey at a company — from a job requisition and offer, through onboarding, day-to-day attendance, leave, and performance reviews, to a structured offboarding and settlement.

It is built with a clean layered architecture, strong security (encrypted PII at rest, JWT + refresh token rotation, RBAC enforced on both frontend and backend), and comprehensive audit logging of every mutation.

## Features

- **Recruitment** — job requisitions, postings, candidates (APPLIED → SCREENING → INTERVIEW → OFFER → HIRED), interviews, offer letters
- **Onboarding** — tasks for document submission, equipment assignment, orientation, and system access setup
- **Attendance & Leave** — attendance records, leave types & policies, entitlements & balances, multi-step leave approvals, holidays
- **Performance** — evaluation cycles (probation / mid-year / end-year), self → manager → HR review workflow, optional rebuttals
- **Offboarding** — clearance items, exit interviews, settlements, and a full offboarding state machine
- **Organization** — hierarchical departments, positions, employees, and managers
- **Documents** — typed documents with AES-encrypted PII and expiry alerts
- **Security & Compliance** — JWT authentication, account lockout, argon2 password hashing, RBAC, full audit logging, GDPR-oriented data minimization and retention
- **Automated jobs** — document expiry, leave accrual, probation and deactivation cron jobs

## Tech Stack

### Backend (`packages/backend`)

- **Node.js 24** · **Express 5** · **TypeScript** (strict, ESM)
- **Prisma 7** with PostgreSQL
- JWT (15-min access / 7-day refresh, hashed refresh tokens), **argon2**, **zod**, helmet, CORS, rate limiting, multer, nodemailer, **winston** logging, **node-cron**
- Testing: **Vitest** + **supertest** (unit + integration)

### Frontend (`packages/frontend`)

- **React 19** · **TypeScript** · **Vite 8** · **Tailwind CSS v4**
- **Radix UI** primitives, **framer-motion**, **Formik**, **React Router 8**
- Testing: **Vitest** + **Testing Library**; **MSW** for API mocking

### Shared configs (`packages/config`)

- `@peoplevate/eslint-config` — shared ESLint flat config
- `@peoplevate/vitest-config` — shared Vitest base config

## Repository Layout

```
packages/
  backend/   @peoplevate/backend  — Express 5 + Prisma 7 API (ESM)
  frontend/  @peoplevate/frontend — React 19 + Vite SPA
  config/    shared eslint-config + vitest-config
docs/        engineering & compliance documentation
```

## Prerequisites

- **Docker Engine 24+** with Docker Compose v2 — recommended for self-hosting (see below)
- **Node.js** `^24` (local development)
- **pnpm** `^11` (local development; the repo pins `pnpm@11.19.0` via `packageManager`)
- **PostgreSQL** (>= 18 recommended) — only required for a non-Docker manual setup

## Quick Start (Docker — recommended)

Peoplevate ships a complete `docker-compose.yml` that bundles the database, backend, and
frontend into a single self-hosted stack. See [`docs/deployment.md`](./docs/deployment.md)
for the full guide.

```bash
# 1. Configure environment (secrets are REQUIRED — >= 32 chars)
cp .env.docker.example .env
#    edit .env: set POSTGRES_PASSWORD, JWT_SECRET, FIELD_ENCRYPTION_KEY

# 2. Build and start all three services
docker compose up -d --build

# 3. Verify
docker compose ps            # all services should be "healthy"
curl http://localhost/healthz
```

Open the app at <http://localhost>. The backend API is proxied at `/api` and its health
check lives at `/health`.

> **Note:** Data lives in named volumes (`peoplevate-db-data`, `peoplevate-uploads`) and
> survives `docker compose down`. Migrations run automatically on backend start.

## Getting Started (local development)

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
# Backend: copy .env.example -> .env (and .env.test)
#   Required: DATABASE_URL, JWT_SECRET (>= 32 chars), FIELD_ENCRYPTION_KEY (>= 32 chars)
# Frontend: copy .env.example -> .env.local
#   VITE_USE_MOCK=false enables the real API

# 3. Generate the Prisma client and create the schema
pnpm db:generate
pnpm db:migrate     # or: pnpm db:push

# 4. (Optional) Seed sample data
pnpm db:seed

# 5. Run the development servers (backend :4000, frontend :5173)
pnpm dev
```

Open the frontend at <http://localhost:5173>. The backend API lives at <http://localhost:4000/api> with a health check at `/health`.

> **Note:** `pnpm dev:frontend` / `pnpm dev:backend` run each app individually. The frontend dev server proxies `/api` to `:4000`.

## Common Scripts

All scripts run from the repository root via pnpm.

| Command                                   | Description                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                                | Run backend and frontend in watch mode                                          |
| `pnpm build`                              | Build both apps                                                                 |
| `pnpm typecheck`                          | Type-check both apps                                                            |
| `pnpm lint` / `pnpm lint:css`             | Lint TS/TSX and CSS                                                             |
| `pnpm format:check` / `pnpm format:write` | Check / apply Prettier formatting                                               |
| `pnpm test`                               | Run frontend + backend unit tests                                               |
| `pnpm test:coverage`                      | Run unit tests with coverage                                                    |
| `pnpm test:integration`                   | Run backend integration tests against a local Postgres                          |
| `pnpm db:*`                               | Prisma generate / migrate / push / seed / studio                                |
| `pnpm audit`                              | Audit dependencies via the npm registry                                         |
| `pnpm ci`                                 | Full CI pass: typecheck, test typecheck, lint, CSS lint, format check, coverage |

## Environment Variables

Required backend vars (validated by zod at startup):

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — at least 32 characters
- `FIELD_ENCRYPTION_KEY` — at least 32 characters (AES-256 for PII/salary)

Frontend:

- `VITE_USE_MOCK` — set to `false` to use the real API instead of `data/mock-data.ts`
- `VITE_API_BASE` — optional API base URL override

## Documentation

- **`docs/`** — engineering, deployment, and GDPR compliance documentation

## Security

- PII and salary are **encrypted at rest** (AES) using `FIELD_ENCRYPTION_KEY`. Plaintext passwords, salaries, and national IDs are never logged or stored.
- JWT and encryption secrets are environment-only and never committed.
- RBAC is enforced on both frontend routes and backend middleware.
- To report a vulnerability, see our [SECURITY.md](./SECURITY.md) policy.

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](./LICENSE) file for details.
