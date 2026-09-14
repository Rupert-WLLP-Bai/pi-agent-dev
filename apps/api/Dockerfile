FROM oven/bun:1.4.0 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/audit/package.json ./packages/audit/
COPY packages/pi-agent/package.json ./packages/pi-agent/
RUN bun install --frozen-lockfile

# Copy source. `apps/api/drizzle` is deliberately NOT ignored: the container
# needs the generated migrations to bring the database up to date at boot.
COPY . .

# Expose API port
EXPOSE 3000

# Apply migrations first, then boot. The shell form chains with `&&` so a
# failed migration aborts the boot instead of serving an API against a stale
# schema. Rule and validation-case seeding happens inside src/app.ts.
CMD ["sh", "-c", "bun run --filter @contract-audit/api migrate && bun run apps/api/src/app.ts"]
