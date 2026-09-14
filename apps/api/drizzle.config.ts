import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

// A host `bun run migrate` starts with no DATABASE_URL, so it used to fall
// through to the default below — port 5432, which on a developer machine is
// Homebrew PostgreSQL rather than this project's database, and the migration
// then either failed or hit the wrong server. Read the same repository .env
// that the `dev` script passes explicitly. A container or CI already exports
// DATABASE_URL (and the image ships no .env), so neither path is affected.
if (process.env.DATABASE_URL === undefined) {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
  if (existsSync(envPath)) {
    const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync(envPath, "utf8"));
    if (match) process.env.DATABASE_URL = match[1].trim();
  }
}

// Never guess a database. Guessing is what pointed a migration at the wrong
// server while the health endpoint reported a different one.
if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === "") {
  throw new Error(
    "DATABASE_URL is not set. Run `bun run migrate` from apps/api (it reads ../../.env), or export DATABASE_URL explicitly.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
