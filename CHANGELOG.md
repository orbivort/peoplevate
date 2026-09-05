# Changelog

All notable changes to the **Peoplevate** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.2] - 2026-09-05

### Security

- Remediate **high**-severity transitive dependency vulnerabilities:  
  - `mysql2` 3.15.3 → 3.24.3 — fixes an auth-plugin downgrade to `mysql_clear_password`
    that leaks plaintext credentials
    ([GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr)) and an
    unbounded zlib-inflate decompression-bomb DoS in the compressed protocol handler
    ([GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3)). It is pulled
    by the Prisma CLI, which pins the vulnerable version exactly
  - `fast-uri` 3.1.5 → 3.1.7 — fixes SSRF / host confusion via malformed IPv6,
    percent-decoding, and IDN normalization
    ([GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8),
    [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc),
    [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf),
    [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp)). It is pulled by
    `ajv` through the Prisma CLI and stylelint toolchains
  - `qs` 6.15.3 → 6.16.0 — fixes an array-limit bypass via bracket-key comma parsing
    ([GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx)) and a DoS via
    an attacker-controlled `isBuffer`
    ([GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)). It is pulled
    by Express, body-parser, and superagent  

- Upgrade engine to Node.js `^24.19.0` and pnpm `^11.21.0`

## [1.0.1] - 2026-09-01

### Security

- Remediate **high**-severity transitive dependency vulnerability: 
  - `deepmerge-ts` 1.2.0 → 1.2.1 — fixes a stack exhaustion DoS via recursive object graphs
  exhaustion when merging recursive object graphs
  ([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) /
  [CVE-2026-40345](https://nvd.nist.gov/vuln/detail/CVE-2026-40345)). It is pulled by Prisma CLI via @prisma/config
- Enhance API rate limiting and harden document file paths
- Enhance store refresh token in httpOnly cookie

## [1.0.0] - 2026-08-08

### Summary

Peoplevate v1.0 is the **initial release** of the self-hosted Employee
Lifecycle Management System (ELMS). This milestone delivers a complete, spec-driven
platform covering the entire employee journey — from recruitment and onboarding through
attendance & leave, performance management, and offboarding — backed by a hardened
security model and full GDPR compliance.

Key achievements of this release:

- **Full lifecycle coverage** — Recruitment, onboarding, attendance & leave, performance
  evaluation, and offboarding are delivered as end-to-end, workflow-enabled modules.
- **Enterprise-grade security** — argon2id password hashing, JWT with refresh-token
  rotation, account lockout, AES-256-GCM field-level encryption, and versioned key
  management are built in from day one.
- **GDPR-ready by default** — Data subject rights, retention policies, breach notification,
  consent evidence, anomaly detection, and audit logging satisfy the compliance gaps
  identified in the v1.0 Deployment Readiness Assessment.
- **Four-tier RBAC** — A capability-based permission matrix is enforced consistently on
  both the API and the frontend, scoping admin, HR, manager, and employee access.
- **Modern, accessible UI** — A React 19 + Tailwind v4 interface built on Radix UI with a
  responsive, role-aware navigation and a comprehensive self-service area.
- **Monorepo tooling** — pnpm workspaces, shared ESLint/Vitest configs, a strict
  TypeScript baseline, and a full test suite (unit + integration) as a quality gate.
- **Docker deployment** — a full `docker compose` stack (PostgreSQL + backend + frontend
  via Nginx) for one-command self-hosting, with persistent volumes, health checks, and
  automatic migrations on startup.

### Added

#### Core Platform & Auth
- New Express 5 + Prisma 7 backend with a layered `routes → services → config` architecture
  and ESM/TypeScript strict mode.
- Monorepo scaffolding with backend, frontend, and shared config workspaces via pnpm.
- Developer tooling baseline: ESLint flat config, Prettier, Vitest, and CI workflow.
- JSON Web Token authentication with 15-minute access tokens and 7-day rotating refresh
  tokens, including reuse detection via token families.
- Refresh tokens hashed at rest and rotated on every refresh.
- Account lockout after 5 failed attempts (15-minute cooldown) with login rate limiting.
- Password lifecycle: secure login, logout, forgot-password, reset-password, first-time
  setup, and change-password flows.
- Zod-validated environment configuration that fails fast on invalid settings.
- Graceful server shutdown and `node-cron` scheduled job lifecycle management.

#### Organization & Employee Data
- Hierarchical department structure and per-department position management.
- Employee master data with unique employee numbers, encrypted PII, and salary storage.
- Employment change tracking (promotion, transfer, manager change, salary adjustment,
  status change) with before/after value history.
- Employment type and lifecycle status support (new hire, probation, active, on leave,
  terminated) with soft-delete via `deleted_at`.

#### Recruitment & Onboarding
- Job requisition workflow (draft → pending approval → approved → published → closed).
- Candidate pipeline tracking (applied → screening → interview → offer → hired/rejected).
- Interview scheduling and offer letter generation.
- Onboarding task management (document submission, equipment assignment, orientation,
  system access setup).

#### Attendance & Leave
- Attendance clock in/out records with IP capture and configurable grace minutes.
- Leave types, entitlements, policy groups, and annual balance accrual.
- Multi-step leave approval workflow (manager → HR → approved) with balance validation.
- Public holiday calendar management.

#### Performance Management
- Evaluation cycles (probation, mid-year, end-year) with automated probation setup.
- Multi-phase review workflow (self → manager → HR → completed) with optional rebuttal.

#### Offboarding
- Offboarding records for resignation, dismissal, and end of contract.
- Clearance checklist with category-based items.
- Exit interview capture and final settlement management.

#### Documents
- Typed document management (contract, national ID, passport, etc.) with expiry tracking.
- AES-256-GCM encryption at rest for files and sensitive fields, with versioned key support
  and legacy SHA-256 decryption fallback.
- Automated expiry alerts with severity classification.

#### Security, RBAC & Audit
- Four-role capability matrix (admin, HR manager, manager, employee) enforced via middleware
  and protected frontend routes.
- Comprehensive audit logging for every mutation plus sensitive reads, downloads, and exports.
- Helmet security headers (CSP/HSTS), CORS, and request body limits.
- Anomaly detection for failed-login and bulk-download spikes.

#### GDPR & Compliance
- Data subject access rights (access, erasure, portability, rectification) with a queue and
  SLA tracking.
- Retention policies across eight data categories with hard-delete and anonymize actions,
  plus legal hold support.
- Breach notification workflow with 72-hour supervisory authority deadline tracking.
- Consent management with evidence records and withdrawal links.
- IP data minimization (truncation) and configurable retention.
- Scheduled jobs for retention purge, IP minimization, DSAR SLA checks, and breach
  escalation.

#### Frontend & UI
- New React 19 + Vite SPA with Tailwind v4 and Radix UI primitives.
- Role-aware routing with lazy-loaded pages, error boundaries, and Suspense.
- Pages for dashboard, organization, employees, recruitment, attendance & leave,
  performance, offboarding, audit log, and compliance management.
- Self-service profile, my-data (GDPR), and account settings pages.
- Automatic token refresh on 401 with a centralized session-expired handler.
- Mock mode with visible banner and MSW-based network interception for development.

#### Docker Deployment
- `docker-compose.yml` for a single-host self-hosted stack (PostgreSQL 18, backend, frontend
  served by Nginx with `/api` reverse proxy).
- Multi-stage `Dockerfile`s for both apps (non-root runtime user, minimal Alpine/Nginx images).
- `.env.docker.example` template with all required secrets (JWT, field encryption, DB password).
- Automatic `prisma migrate deploy` on backend start, persistent named volumes for the database
  and uploaded documents, and health checks for every service.
- Full operating guide (configure, build, verify, back up, upgrade, harden) in
  [`docs/deployment.md`](./docs/deployment.md).

### Security
- Plaintext passwords, salaries, and national IDs are never logged or stored.
- JWT secrets and encryption keys are environment-only and enforced to be ≥ 32 characters.
- No source maps shipped in production unless explicitly enabled via `VITE_SOURCEMAP`.

---

[1.0.0]: https://github.com/orbivort/peoplevate/releases/tag/v1.0.0
[1.0.1]: https://github.com/orbivort/peoplevate/compare/v1.0.0...v1.0.1
[1.0.2]: https://github.com/orbivort/peoplevate/compare/v1.0.1...v1.0.2
