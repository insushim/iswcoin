FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

# Generate Prisma client
WORKDIR /app/apps/server
RUN npx prisma generate

# Build
RUN pnpm build || true

EXPOSE 4000

CMD ["pnpm", "dev"]
