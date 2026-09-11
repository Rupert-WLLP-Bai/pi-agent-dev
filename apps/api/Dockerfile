FROM oven/bun:1.3.14 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/audit/package.json ./packages/audit/
COPY packages/pi-agent/package.json ./packages/pi-agent/
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Generate migration (if needed at build time — skip, migrations are run separately)

# Expose API port
EXPOSE 3000

# Start the API
CMD ["bun", "run", "apps/api/src/app.ts"]
