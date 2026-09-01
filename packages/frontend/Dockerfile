# syntax=docker/dockerfile:1.7
#
# Peoplevate frontend — React 19 + Vite SPA.
#
# Multi-stage build:
#   stage deps  : installs frontend dependencies (pnpm workspace member)
#   stage build : compiles TS + bundles static assets with Vite (dist/)
#   stage web   : minimal Nginx image serving the static build and proxying /api
#
# Build context must be the monorepo root so pnpm can resolve the workspace.

# ----------------------------------------------------------------- deps ------
FROM node:24.19.0-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/config packages/config
RUN pnpm install --filter @peoplevate/frontend --frozen-lockfile

# ---------------------------------------------------------------- build ------
FROM deps AS build
WORKDIR /workspace
COPY packages/frontend/tsconfig.json packages/frontend/tsconfig.json
COPY packages/frontend/index.html packages/frontend/index.html
COPY packages/frontend/vite.config.ts packages/frontend/vite.config.ts
COPY packages/frontend/public packages/frontend/public
COPY packages/frontend/src packages/frontend/src

# Real API mode: the SPA must talk to the backend at the same origin. Because
# Nginx proxies /api to the backend service, VITE_API_BASE stays empty (same
# origin). Source maps are disabled in production unless explicitly requested.
ARG VITE_USE_MOCK=false
ENV VITE_USE_MOCK=${VITE_USE_MOCK}

RUN pnpm --filter @peoplevate/frontend build

# ----------------------------------------------------------------- web -------
FROM nginx:1.27-alpine AS web
# Default conf served by nginx:1.27-alpine; remove the demo page.
RUN rm -f /etc/nginx/conf.d/default.conf
# Build context is the monorepo root, so the nginx.conf path is fully qualified.
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/packages/frontend/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
