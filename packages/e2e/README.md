# @peoplevate/e2e — End-to-End Tests

Focused, real-browser E2E coverage for Peoplevate's **critical business journeys**.
Unlike the unit and integration suites, these tests close the seam that those
cannot see: the **browser → Vite proxy → real backend → seeded database** path,
including routing/RBAC gating, token refresh, and stateful cross-role workflows.

This is deliberately a **small smoke layer**, not a UI-coverage mirror. The
backend integration tests already verify the state machines and data correctness
against a real PostgreSQL; these specs verify the wiring and the journeys a user
actually clicks.

## Scope

| Spec                              | Journey                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `auth-rbac.spec.ts`               | Login, unauthenticated redirect, role-gated navigation, admin-only route guards   |
| `recruitment-requisition.spec.ts` | Requisition Draft → Pending → Approved → Published + auto job-posting side-effect |
| `attendance-leave.spec.ts`        | Employee submits leave → Manager approves (cross-role approval chain)             |
| `attendance-clock.spec.ts`        | Clock in / clock out → AttendanceRecord persisted                                 |
| `offboarding.spec.ts`             | Employee self-resignation → OffboardingRecord INITIATED                           |

## How it works

`scripts/run-e2e.mjs` orchestrates everything in one command:

1. Drops + recreates the **`peoplevate_e2e`** database (isolated from dev/CI data).
2. Applies Prisma migrations and runs the backend seed (demo accounts).
3. Boots the **real backend** (`DATABASE_URL` → E2E DB) and the **real frontend**
   (`VITE_USE_MOCK=false`).
4. Waits for `/health` + the frontend, then runs Playwright.
5. Tears both servers down.

## Prerequisites

- PostgreSQL running locally (default connection string below).
- `@playwright/test` browsers installed once:
  ```bash
  pnpm test:e2e:install
  ```
- Backend env secrets are reused from `packages/backend/.env` (the orchestration
  passes them through to the spawned backend).

## Run

```bash
# From repo root — boots servers, resets + seeds the DB, runs the suite.
pnpm test:e2e
```

### Configuration (`packages/e2e/.env`, all optional)

| Variable            | Default                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `E2E_BASE_URL`      | `http://localhost:5173`                                                    |
| `E2E_API_URL`       | `http://localhost:4000`                                                    |
| `E2E_DB_URL`        | `postgresql://postgres:liu123@localhost:5432/peoplevate_e2e?schema=public` |
| `E2E_SKIP_DB_RESET` | `false` (set `true` to keep existing E2E DB state)                         |

### Manual / debugging

```bash
# Run only Playwright against already-running servers:
pnpm --filter @peoplevate/e2e test
# or
pnpm --filter @peoplevate/e2e test:headed
```

## CI

E2E is a **release-stability check**, not part of the fast `pnpm ci` gate. Add a
separate CI job (e.g. `test:e2e`) that runs `pnpm test:e2e` once PostgreSQL is
available. It resets its own `peoplevate_e2e` database and never touches dev/CI
test data.
