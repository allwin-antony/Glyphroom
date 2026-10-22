# syntax=docker/dockerfile:1.4
# Enterprise Blogger 2.0 — Collaboration Engine Dockerfile
# Multi-stage build for pnpm monorepo (minimal Debian-slim, non-root user, dumb-init signal forwarding)

FROM node:22-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/collab/package.json ./apps/collab/
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY tests/package.json ./tests/

RUN pnpm install --frozen-lockfile

FROM dependencies AS builder

COPY packages/shared ./packages/shared
COPY apps/collab ./apps/collab

RUN pnpm --filter @enterprise-blogger/shared run build
RUN pnpm --filter @enterprise-blogger/collab run build
RUN pnpm --filter @enterprise-blogger/collab --prod deploy /app/deployed

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

WORKDIR /app

RUN groupadd -g 10001 blogger && \
    useradd -u 10001 -g blogger -s /bin/sh -d /app blogger && \
    mkdir -p /app/logs /app/attachments && \
    chown -R blogger:blogger /app

COPY --from=builder --chown=blogger:blogger /app/deployed /app
COPY --from=builder --chown=blogger:blogger /app/packages/shared/dist /app/node_modules/@enterprise-blogger/shared/dist

EXPOSE 4000

USER blogger

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
