# Peoplevate Deployment Guide

This guide explains how to build, configure, and operate **Peoplevate** in a production
environment. It is aimed at operators, DevOps engineers, and administrators.

---

## Prerequisites

- **Node.js** `^24`
- **pnpm** `^11` (the repo pins `pnpm@11.19.0` via `packageManager`)
- **PostgreSQL** (>= 18 recommended)

---

## 1. Obtain the Code & Install Dependencies

```bash
git clone <repository-url> peoplevate
cd peoplevate
pnpm install
```

---

## 2. Configure Environment Variables

### Backend

Copy the example file and populate every required value:

```bash
cp packages/backend/.env.example packages/backend/.env
```

Required variables (validated by zod at startup — the server exits on invalid values):

| Variable | Description |
| -------- | ----------- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | **At least 32 characters.** Used to sign access/refresh tokens. |
| `FIELD_ENCRYPTION_KEY` | **At least 32 characters.** AES key that encrypts PII and salary at rest. |

Important production variables (see `packages/backend/src/config/env.ts` for all options):

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `NODE_ENV` | `development` | Set to `production` for production runs. |
| `PORT` | `4000` | Backend listen port. |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin. Set to your frontend URL. |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Access token lifetime. |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token lifetime. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | localhost defaults | Outbound email for invitations, password resets, and notifications. |
| `DPO_CONTACT_EMAIL` | `dpo@peoplevate.local` | Data protection officer contact used by GDPR workflows. |
| `TERMINATED_RECORD_RETENTION_YEARS` | `7` | Retention period for terminated records before purge. |

### Frontend

```bash
cp packages/frontend/.env.example packages/frontend/.env.local
```

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `VITE_USE_MOCK` | `true` | Set to `false` to use the real API instead of bundled mock data. |
| `VITE_API_BASE` | — | Optional override for the API base URL. |

### Secrets & Security

- Generate strong random secrets for `JWT_SECRET` and `FIELD_ENCRYPTION_KEY` (>= 32 chars).
- **Never commit** `.env` files or secrets to version control.
- The frontend `/api` proxy is intended for development; configure a reverse proxy (see below)
  for production.

---

## 3. Set Up the Database

```bash
# Generate the Prisma client from the schema
pnpm db:generate

# Apply the schema (migrations recommended for production)
pnpm db:migrate
```

For existing databases you may use `pnpm db:push`, but prefer migrations in production.

Optional seed data:

```bash
pnpm db:seed
```

---

## 4. Build the Applications

```bash
pnpm build
```

This builds the backend (`packages/backend/dist`) and the frontend static assets
(`packages/frontend/dist`).

---

## 5. Run in Production

### Backend

Run the compiled server with `NODE_ENV=production`:

```bash
cd packages/backend
NODE_ENV=production node dist/index.js
```

Use a process manager (e.g. systemd, PM2) to keep the process alive and restart on failure.

### Frontend

Serve the static files from `packages/frontend/dist` with a web server such as Nginx or
serve the SPA with a Node static server. The SPA uses client-side routing, so configure
fallback to `index.html` for unknown paths (so routes like `/app/employees/1` work on
refresh).

---

## 6. Reverse Proxy (Recommended)

Terminate TLS at a reverse proxy (Nginx, Caddy, or a load balancer) and forward requests
to the backend. Example Nginx configuration outline:

```nginx
# Frontend SPA
server {
  listen 443 ssl;
  server_name peoplevate.example.com;

  # TLS certificates ...

  # Static frontend
  root /var/www/peoplevate/frontend/dist;
  try_files $uri /index.html;

  # API reverse proxy
  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Health check (no auth)
  location = /health {
    proxy_pass http://127.0.0.1:4000/health;
  }
}
```

Set `CORS_ORIGIN` to the public frontend origin when serving from a separate host.

---

## 7. Scheduled Jobs

Peoplevate uses **node-cron** for automated maintenance jobs that run inside the backend
process:

- Document expiry checks
- Leave accrual
- Probation review creation
- Account deactivation checks
- Retention data purge
- DSAR SLA reminders
- Breach escalation

These run automatically when the backend is running. Ensure the backend stays up (process
manager with restart) so scheduled jobs continue to fire.

---

## 8. Health Checks & Monitoring

- **Health endpoint:** `GET /health` returns `{ "status": "ok", "timestamp": ... }`.
- Configure your load balancer or monitoring system to poll `/health`.
- Monitor application logs (winston) and the immutable audit log for security events.

---

## 9. Operational Checklist

- [ ] `NODE_ENV=production`, `CORS_ORIGIN` set to the real frontend origin.
- [ ] Strong `JWT_SECRET` and `FIELD_ENCRYPTION_KEY` (>= 32 chars), stored securely.
- [ ] SMTP configured so invitations and notifications are delivered.
- [ ] TLS terminated at a reverse proxy; plain HTTP not exposed.
- [ ] Database backed up regularly and migrations versioned.
- [ ] Backend kept running so scheduled cron jobs fire.
- [ ] Data retention and DSAR policies configured to meet your compliance obligations.

---

## 10. Docker Deployment

Docker is the recommended way to self-host Peoplevate on a single host. It bundles the
backend, frontend, and database into isolated, reproducible containers.

### Why Docker is essential for self-hosting

| Criterion | Benefit |
| --------- | ------- |
| **Dependency isolation** | The backend needs Node 24 + pnpm 11 + Prisma 7 and the `argon2` native module; the frontend needs Node 24 at build time and Nginx at runtime; PostgreSQL 18 is required. Containers pin all of these, so a host OS with different runtimes (or none) can still run Peoplevate without conflicts. |
| **Environment consistency** | The same image builds identically on a laptop and a server. Because the backend runs ESM with `#prisma` subpath imports and a Prisma-generated client, "works on my machine" issues are eliminated — the container is the machine. |
| **Ease of scaling** | The API is stateless (JWT auth, PostgreSQL for persistence), so scaling to a cluster later only requires running more backend replicas behind a load balancer. The Compose topology already separates concerns into independent services. |
| **Simplified updates** | Upgrades are a rebuild-and-recreate (`docker compose up -d --build`). `prisma migrate deploy` runs on every start so the schema upgrades in lockstep with the code, and named volumes preserve data across recreation. |
| **Reproducible rollback** | Old images can be tagged and re-pinned, enabling fast rollback to a previous version. |
| **Operational tooling** | Built-in health checks, restart policies, and log capture (`docker compose logs`) reduce the operational burden for a single-admin deployment. |

### Requirements

- Docker Engine 24+ with Docker Compose v2 (`docker compose`).
- A server with enough RAM for PostgreSQL + Node 24 (24.18.1, recommend 2 GB+).

### 1. Configure environment

```bash
cp .env.docker.example .env
# edit .env — set POSTGRES_PASSWORD, JWT_SECRET, FIELD_ENCRYPTION_KEY (>= 32 chars)
```

### 2. Build and start

```bash
docker compose up -d --build
```

This starts three services on an isolated bridge network:

| Service   | Image base            | Purpose                                      |
| --------- | --------------------- | -------------------------------------------- |
| `db`      | `postgres:18-alpine`  | Persistent PostgreSQL data store             |
| `backend` | `node:24.18.1-alpine` | Express 5 + Prisma 7 REST API                |
| `frontend`| `nginx:1.27-alpine`   | Serves the React SPA and proxies `/api`      |

The app is then reachable at `http://<server-host>` (port `${APP_PORT}`, default `80`).

### 3. Verify

```bash
docker compose ps            # all services should show "healthy"
docker compose logs -f backend
curl http://localhost/healthz   # nginx liveness
curl http://localhost/api/health  # backend health (proxied)
```

### 4. Persistent data & volumes

| Volume | Backs |
| ------ | ----- |
| `peoplevate-db-data` | PostgreSQL database files |
| `peoplevate-uploads` | Uploaded documents (`UPLOAD_DIR`) |

Named volumes survive `docker compose down` and container recreation, so data is preserved
across updates.

### 5. Backups

Back up both volumes. The database is the critical one:

```bash
docker compose exec db pg_dump -U peoplevate peoplevate > backup_$(date +%F).sql
```

Restore (database must be empty):

```bash
docker compose exec -T db psql -U peoplevate peoplevate < backup.sql
```

For the `uploads` volume, back up its mount path:

```bash
docker run --rm -v peoplevate-uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads.tar.gz -C /data .
```

### 6. Upgrading

```bash
git pull                      # or point the build at the new tag
docker compose up -d --build  # rebuilds images and recreates containers
```

Migrations run automatically (`prisma migrate deploy`) on backend start. Always back up the
database before upgrading.

### 7. Tearing down

```bash
docker compose down       # stop containers, keep data volumes
docker compose down -v    # ALSO destroy data volumes (irreversible)
```

### 8. Production hardening

- Put a TLS-terminating reverse proxy (Nginx/Caddy) or `docker compose` port + TLS in front of
  the `frontend` service; never expose plain HTTP publicly.
- Set `CORS_ORIGIN` to your public origin.
- Rotate `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, and `POSTGRES_PASSWORD` after first install.
- Restrict the published DB/backend ports (they bind to `127.0.0.1` by default) or remove them.

---

## Related Documentation

- [Usage Guide](./usage-guide.md) — how users interact with the system.
- [Roles & Permissions](./roles-permissions.md) — access control.
- [API Overview](./api-overview.md) — REST API endpoints.
- [Security policy](../SECURITY.md) — reporting vulnerabilities.
- [Contributing](../CONTRIBUTING.md) — development setup.
