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

| Resource            | Base Path                           | Primary Audience                   |
| ------------------- | ----------------------------------- | ---------------------------------- |
| Users               | `/api/users`                        | Admin                              |
| Departments         | `/api/departments`                  | Admin / HR Manager                 |
| Positions           | `/api/positions`                    | Admin / HR Manager                 |
| Employees           | `/api/employees`                    | All staff (create/edit restricted) |
| Employment changes  | `/api/employees` (change endpoints) | Admin / HR Manager / Manager       |
| Documents           | `/api/documents`                    | Admin / HR Manager                 |
| Audit log           | `/api/audit-log`                    | Admin / HR Manager                 |
| Alerts              | `/api/alerts`                       | All staff                          |
| Recruitment         | `/api/recruitment`                  | Admin / HR Manager / Manager       |
| Attendance          | `/api/attendance`                   | All staff (team views restricted)  |
| Performance         | `/api/performance`                  | All staff (reviews role-scoped)    |
| Offboarding         | `/api/offboarding`                  | Admin / HR Manager / staff         |
| Key management      | `/api/keys`                         | Admin / HR Manager                 |
| Retention           | `/api/retention`                    | Admin / HR Manager                 |
| Data subject rights | `/api/data-subject-rights`          | Admin / HR Manager                 |
| DSAR                | `/api/dsar`                         | Admin / HR Manager                 |
| Breach              | `/api/breach`                       | Admin / HR Manager                 |
| Anomalies           | `/api/anomalies`                    | Admin / HR Manager                 |
| Consent             | `/api/consent`                      | Admin / HR Manager                 |

> **Note:** Employment-change endpoints are served under `/api/employees` (for example
> recording a change against an employee). Refer to the route source for exact sub-paths.

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

| Status | Meaning                                           |
| ------ | ------------------------------------------------- |
| `400`  | Validation failure or malformed request body      |
| `401`  | Missing or invalid authentication                 |
| `403`  | Authenticated but insufficient permissions (RBAC) |
| `404`  | Resource not found                                |
| `429`  | Rate limit exceeded                               |
| `500`  | Server error                                      |

Typical error body: `{ "error": "<message>" }`.

---

## Security Considerations

- PII and salary fields are **encrypted at rest** and never returned in plaintext to
  unauthorized roles.
- Use HTTPS in production.
- Rotate `JWT_SECRET` and `FIELD_ENCRYPTION_KEY` carefully; see [Deployment](./deployment.md).
