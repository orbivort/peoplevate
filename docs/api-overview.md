# Peoplevate API Overview

Peoplevate exposes a REST API under the base path `/api/<resource>`. All endpoints,
except public authentication and health-check routes, require a valid **Bearer** access
token.

This document is an overview and endpoint index.

---

## Base Information

- **Base URL (dev):** `http://localhost:4000/api`
- **Health check:** `GET /health` (no auth)
- **Authentication:** `Authorization: Bearer <accessToken>`
- **Refresh:** access tokens expire (default 15 min); use the refresh endpoint to obtain a
  new access token. The refresh token is delivered as an `httpOnly`, `SameSite=Strict`
  cookie scoped to `/api/auth` and is never present in JSON response bodies.
- **Rate limiting:** login and password-change endpoints are rate-limited.
- **Audit:** every mutation records an immutable audit log entry.

---

## Authentication (`/api/auth`)

| Method | Path                        | Description                                                                                    | Auth |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------- | ---- |
| `POST` | `/api/auth/login`           | Sign in with email/password; returns `{ accessToken, user }` and sets the refresh-token cookie | No   |
| `POST` | `/api/auth/refresh`         | Exchange the refresh-token cookie for a new access token (rotates the cookie)                  | No   |
| `POST` | `/api/auth/logout`          | Revoke the refresh-token cookie server-side and clear the cookie                               | No   |
| `POST` | `/api/auth/forgot-password` | Request a password reset email                                                                 | No   |
| `POST` | `/api/auth/reset-password`  | Reset a password with a token                                                                  | No   |
| `POST` | `/api/auth/setup`           | Activate an invited account with a setup token                                                 | No   |
| `POST` | `/api/auth/change-password` | Change the current user's password                                                             | Yes  |

---

## Resources

The following resource groups are mounted in the application. Individual methods
(GET/POST/PATCH/DELETE) follow REST conventions for listing, reading, creating, updating,
and deleting (or soft-deleting) records.

| Resource            | Base Path                           | Primary Audience                             |
| ------------------- | ----------------------------------- | -------------------------------------------- |
| Users               | `/api/users`                        | Admin                                        |
| Departments         | `/api/departments`                  | Admin / HR Manager                           |
| Positions           | `/api/positions`                    | Admin / HR Manager                           |
| Employees           | `/api/employees`                    | All staff (create/edit restricted)           |
| Employment changes  | `/api/employees` (change endpoints) | Admin / HR Manager / Manager                 |
| Documents           | `/api/documents`                    | Admin / HR Manager                           |
| Audit log           | `/api/audit-log`                    | Admin / HR Manager                           |
| Alerts              | `/api/alerts`                       | All staff                                    |
| Recruitment         | `/api/recruitment`                  | Admin / HR Manager / Manager                 |
| Attendance          | `/api/attendance`                   | All staff (team views restricted)            |
| Performance         | `/api/performance`                  | All staff (reviews role-scoped)              |
| Offboarding         | `/api/offboarding`                  | Admin / HR Manager / staff                   |
| Key management      | `/api/keys`                         | Admin / HR Manager                           |
| Retention           | `/api/retention`                    | Admin / HR Manager                           |
| Data subject rights | `/api/data-subject-rights`          | Admin / HR Manager                           |
| DSAR                | `/api/dsar`                         | Admin / HR Manager                           |
| Breach              | `/api/breach`                       | Admin / HR Manager                           |
| Anomalies           | `/api/anomalies`                    | Admin / HR Manager                           |
| Consent             | `/api/consent`                      | Admin / HR Manager                           |
| Timesheets          | `/api/timesheets`                   | All staff (own); Manager+ (approvals)        |
| Timesheet entries   | `/api/timesheet-entries`            | All staff (own entries)                      |
| Projects & tasks    | `/api/projects`                     | All staff (read); Admin / HR Manager (write) |
| Timesheet reports   | `/api/reports/timesheets`           | Manager / HR Manager / Admin                 |

> **Note:** Employment-change endpoints are served under `/api/employees` (for example
> recording a change against an employee). Refer to the route source for exact sub-paths.

---

## Timesheets

Timesheet endpoints use **camelCase** DTOs and a date-only `entryDate` (`YYYY-MM-DD`). Access
is role-scoped (`requireHRorManager` for approvals and reports, `requireHR` for the catalog)
with per-record ownership checks in the service layer. A timesheet covers one **Monday–Sunday**
week (Monday 00:00 – Sunday 23:59:59.999, computed in UTC on the server), and entries are
accepted only for the **current or previous week**.

### Timesheets (`/api/timesheets`)

| Method | Path                          | Purpose                                                                                                               |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/timesheets`             | List your own timesheets. Query: `status`, `periodStart`, `page`, `pageSize`.                                         |
| `GET`  | `/api/timesheets/current`     | Get-or-create the week's timesheet. Query: `date` (defaults to today; must fall within the current or previous week). |
| `GET`  | `/api/timesheets/pending`     | Approval queue of `SUBMITTED` weeks (Manager: direct reports; HR/Admin: all).                                         |
| `GET`  | `/api/timesheets/:id`         | Full detail — entries, approval history, and computed totals.                                                         |
| `POST` | `/api/timesheets/:id/submit`  | `DRAFT`/`REJECTED` → `SUBMITTED`; requires ≥ 1 entry and an assigned manager.                                         |
| `POST` | `/api/timesheets/:id/approve` | `SUBMITTED` → `APPROVED`; optional `comment` (≤ 500 chars).                                                           |
| `POST` | `/api/timesheets/:id/reject`  | `SUBMITTED` → `REJECTED`; `comment` required (1–500 chars); unlocks the week.                                         |

Status lifecycle:

```text
DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED
                     │
                     └──reject──▶ REJECTED ──(edit + submit)──▶ SUBMITTED
```

Approvals may only be made by the employee's manager (resolved live), an HR Manager, or an
Admin; **self-approval is blocked**.

### Timesheet entries (`/api/timesheet-entries`)

| Method   | Path                         | Purpose                                                                              |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `POST`   | `/api/timesheet-entries`     | Create an entry. Body: `entryDate`, `projectId`, `taskId?`, `hours`, `description?`. |
| `PATCH`  | `/api/timesheet-entries/:id` | Update an entry (owner only, unlocked week). All fields optional.                    |
| `DELETE` | `/api/timesheet-entries/:id` | Soft-delete an entry (owner only, unlocked week).                                    |

Entry mutations return the owning timesheet with recomputed totals
(`{ "timesheet": <TimesheetDetail> }`). The target week is derived from `entryDate`;
`timesheetId` is accepted for compatibility but ignored.

Server-enforced validation:

- `hours` > 0, ≤ 24 per entry, and a multiple of `0.25`.
- `entryDate` within the current or previous week.
- `description` ≤ 500 characters.
- `projectId` must be an active project; `taskId` (if given) must be an active task belonging
  to that project.
- The total for one employee and one day must stay ≤ 24 hours.
- One entry per employee + date + project + task (duplicates are rejected).

### Projects & tasks (`/api/projects`)

| Method   | Path                              | Purpose                                                                |
| -------- | --------------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/api/projects`                   | List projects (active only; `includeInactive=true` requires Admin/HR). |
| `GET`    | `/api/projects/admin-stats`       | Projects with entry and task counts (Admin / HR Manager).              |
| `POST`   | `/api/projects`                   | Create a project (Admin / HR Manager).                                 |
| `PATCH`  | `/api/projects/:id`               | Update a project (Admin / HR Manager).                                 |
| `DELETE` | `/api/projects/:id`               | Soft-delete; `409` when timesheet entries reference the project.       |
| `GET`    | `/api/projects/:id/tasks`         | List a project's tasks (active only by default).                       |
| `POST`   | `/api/projects/:id/tasks`         | Create a task (name unique within the project).                        |
| `PATCH`  | `/api/projects/:id/tasks/:taskId` | Update a task (`name`, `isActive`).                                    |
| `DELETE` | `/api/projects/:id/tasks/:taskId` | Soft-delete; `409` when timesheet entries reference the task.          |

Create and update operations return the created/updated `Project` or `ProjectTask`; the list
endpoints return them wrapped as `{ "projects": [...] }` and `{ "tasks": [...] }`.

### Reports (`/api/reports/timesheets`)

Manager and above only. Managers are scoped to their direct reports; HR Manager and Admin see
everyone. Reports include **approved** hours only unless `includeAllStatuses=true`.

| Method | Path                              | Purpose                                                                                                                                                                |
| ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/reports/timesheets/summary` | Aggregated hours. `groupBy` = `employee` \| `project` \| `department`; required `from`/`to`; optional `employeeId`, `departmentId`, `projectId`, `includeAllStatuses`. |
| `GET`  | `/api/reports/timesheets/details` | Paged entry listing with the same filters (`page`, `pageSize`).                                                                                                        |
| `GET`  | `/api/reports/timesheets/export`  | CSV download with the same filters; every export is audit-logged.                                                                                                      |

CSV columns:
`employee_no,employee_name,date,project_code,project_name,task_name,hours,description,timesheet_status`.

---

## Authentication Flow

```text
POST /api/auth/login        -> { accessToken, user } + Set-Cookie: refresh_token (httpOnly)
POST /api/auth/refresh      -> { accessToken, user }  (cookie: refresh_token; rotates it)
GET  /api/<resource>        (Authorization: Bearer <accessToken>)
```

The refresh token lives exclusively in an `httpOnly`, `SameSite=Strict` cookie (path
`/api/auth`, `Secure` in production) so client-side JavaScript — including any XSS
payload — cannot read it. The frontend keeps the access token in memory only and
performs automatic token refresh on `401` responses (and on page load via the cookie),
invoking a session expiry handler when refresh fails.

---

## Errors

Errors are returned with an appropriate HTTP status code and a JSON body. Common cases:

| Status | Meaning                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------- |
| `400`  | Validation failure or malformed request body                                                   |
| `401`  | Missing or invalid authentication                                                              |
| `403`  | Authenticated but insufficient permissions (RBAC)                                              |
| `404`  | Resource not found                                                                             |
| `409`  | Business conflict (locked timesheet, duplicate entry, daily hour cap, referenced project/task) |
| `429`  | Rate limit exceeded                                                                            |
| `500`  | Server error                                                                                   |

Typical error body: `{ "error": "<message>" }`.

---

## Security Considerations

- PII and salary fields are **encrypted at rest** and never returned in plaintext to
  unauthorized roles.
- Use HTTPS in production.
- Rotate `JWT_SECRET` and `FIELD_ENCRYPTION_KEY` carefully; see [Deployment](./deployment.md).
