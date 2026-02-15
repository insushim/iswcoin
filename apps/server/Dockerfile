# ---- Stage 1: Builder ----
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files for all workspace packages
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/server/package.json ./apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
COPY apps/server ./apps/server

# Generate Prisma client
WORKDIR /app/apps/server
RUN npx prisma generate

# Build shared packages and server
WORKDIR /app
RUN pnpm --filter @cryptosentinel/shared build || true
RUN pnpm --filter @cryptosentinel/server build

# ---- Stage 2: Runner ----
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

# Install curl for healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Copy workspace config (needed for pnpm to resolve workspaces)
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./

# Copy built server
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules

# Copy Prisma schema and generated client
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma

# Copy shared package
COPY --from=builder /app/packages/shared ./packages/shared

# Copy root node_modules (for workspace resolution)
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1

WORKDIR /app/apps/server

CMD ["node", "dist/index.js"]
