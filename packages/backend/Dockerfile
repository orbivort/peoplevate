# syntax=docker/dockerfile:1.7
#
# Peoplevate backend — Express 5 + Prisma 7 REST API.
#
# Multi-stage build:
#   stage base     : node 24.19.0 + pnpm 11.21.0
#   stage build    : installs all deps, generates Prisma client, compiles TS (tsc -> dist/)
#   stage runtime  : full node_modules (incl. prisma CLI for migrations) + compiled dist
#
# Note: the `prisma` CLI lives in devDependencies but is required at runtime for
# `prisma migrate deploy` / `prisma generate`. We therefore ship the full
# dependency tree from the build stage into the runtime image.
#
# The backend is a pnpm workspace member (@peoplevate/backend). Build context must be
# the monorepo root so `pnpm install --filter` can resolve the workspace.

# ---------------------------------------------------------------- base -------
FROM node:24.19.0-alpine AS base
# corepack enables pnpm without a global install (pin to the repo's packageManager).
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

# --------------------------------------------------------------- build -------
FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/config packages/config
COPY packages/backend/prisma packages/backend/prisma
COPY packages/backend/tsconfig.json packages/backend/tsconfig.json
COPY packages/backend/src packages/backend/src
RUN pnpm install --filter @peoplevate/backend --frozen-lockfile
# Generate the Prisma client into node_modules and compile TypeScript to dist/.
RUN pnpm --filter @peoplevate/backend exec prisma generate
RUN pnpm --filter @peoplevate/backend build

# ------------------------------------------------------------ runtime --------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /workspace

# Full dependency tree from the build stage. This includes the `prisma` CLI
# (a devDependency needed for `migrate deploy`) alongside the production deps.
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=build /workspace/packages/config ./packages/config

# The application source (run via `tsx`). The Prisma-generated client in
# src/generated is TypeScript source with extensionless relative imports, which
# Node's native ESM loader cannot resolve directly. `tsx` (the project's own
# runtime, per the backend `start` script) transpiles and resolves them.
COPY --from=build /workspace/packages/backend/src ./packages/backend/src
COPY --from=build /workspace/packages/backend/package.json ./packages/backend/package.json
# prisma.config.ts is required by the Prisma CLI (v7) to resolve DATABASE_URL.
COPY packages/backend/prisma.config.ts ./packages/backend/prisma.config.ts
COPY packages/backend/prisma ./packages/backend/prisma

WORKDIR /workspace/packages/backend

# Directory for uploaded documents. Keep it as a volume for persistence.
RUN mkdir -p uploads
VOLUME ["/workspace/packages/backend/uploads"]

EXPOSE 4000

# Non-root user for least privilege (security best practice).
RUN addgroup -S app && adduser -S app -G app \
  && chown -R app:app /workspace/packages/backend
USER app

# Run migrations, then start the API. The Prisma CLI and tsx binaries are
# invoked directly (not via `pnpm exec`) so pnpm's dependency-status check is
# skipped at startup.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx src/index.ts"]
