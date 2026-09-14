# Build the SPA with Bun, then serve the static output from nginx.
FROM oven/bun:1.4.0 AS build
WORKDIR /app

# Install dependencies (workspace-aware: the web build resolves the
# @contract-audit/* workspace packages from source).
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/audit/package.json ./packages/audit/
COPY packages/pi-agent/package.json ./packages/pi-agent/
RUN bun install --frozen-lockfile

# Copy source and build the client bundle into apps/web/dist.
COPY . .
RUN bun run --filter @contract-audit/web build

FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
