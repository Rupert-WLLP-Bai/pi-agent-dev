import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export interface ManagedDemoEnvironment {
  path: string;
  values: Record<string, string>;
  apiOrigin: string;
  webOrigin: string;
  compose: string[];
}

const generatedValues = (): Record<string, string> => {
  const password = randomBytes(32).toString("hex");
  return {
    APP_ENV: "demo",
    COMPOSE_PROJECT_NAME: "contract-audit-demo",
    POSTGRES_USER: "contract_audit",
    POSTGRES_PASSWORD: password,
    POSTGRES_DB: "contract_audit_demo",
    POSTGRES_BIND: "127.0.0.1",
    POSTGRES_PORT: "15434",
    REDIS_BIND: "127.0.0.1",
    REDIS_PORT: "16380",
    S3_BIND: "127.0.0.1",
    S3_PORT: "19002",
    S3_CONSOLE_BIND: "127.0.0.1",
    S3_CONSOLE_PORT: "19003",
    API_BIND: "127.0.0.1",
    API_PORT: "13002",
    WEB_BIND: "127.0.0.1",
    WEB_PORT: "18080",
    DATABASE_URL: `postgresql://contract_audit:${password}@127.0.0.1:15434/contract_audit_demo`,
    REDIS_URL: "redis://127.0.0.1:16380",
    S3_ENDPOINT: "http://127.0.0.1:19002",
    S3_ACCESS_KEY: randomBytes(10).toString("hex"),
    S3_SECRET_KEY: randomBytes(32).toString("hex"),
    S3_BUCKET: "contract-audit-demo-originals",
    S3_REGION: "us-east-1",
    S3_STRICT: "true",
    S3_TIMEOUT_MS: "10000",
    LLM_KEY_ENCRYPTION_SECRET: randomBytes(32).toString("hex"),
    WEB_ORIGIN: "http://127.0.0.1:18080",
    API_BASE_URL: "http://127.0.0.1:13002",
    AUDIT_AGENT_MODE: "fake",
    SUBJECT_VERIFICATION_MODE: "fixture",
    LLM_INTERNAL_DATA_ORIGINS: "",
    XYG_ENDPOINT: "",
    XYG_API_KEY: "",
    XYG_MODEL: "",
    QCC_TOKEN: "",
    DECISION_MODE: "off",
    DECISION_PROVIDER: "disabled",
    DEMO_ENVIRONMENT_ID: "contract-audit-local-demo",
    DEMO_DATABASE_NAME: "contract_audit_demo",
    DEMO_RESET_CONFIRMATION: "contract_audit_demo",
    DEMO_FILLER_COUNT: "24",
    DEMO_RNG_SEED: "20261015",
    MAX_UPLOAD_BYTES: "10485760",
  };
};

/** This tool owns .demo.env; it never rewrites the developer's root .env. */
export async function loadManagedDemoEnvironment(create = false): Promise<ManagedDemoEnvironment> {
  const path = resolve(projectRoot, process.env.DEMO_ENV_FILE ?? ".demo.env");
  if (path === resolve(projectRoot, ".env"))
    throw new Error("DEMO_ENV_FILE_MUST_BE_SEPARATE_FROM_ROOT_ENV");
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink())
      throw new Error("DEMO_ENV_FILE_MUST_BE_A_REGULAR_FILE");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT" || !create)
      throw error;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const values = generatedValues();
    const text = [
      "# Private generated local demo settings. Never commit or print this file.",
      ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
      "",
    ].join("\n");
    await writeFile(path, text, { flag: "wx", mode: 0o600 });
  }
  await chmod(path, 0o600);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseEnv(await readFile(path, "utf8")))) {
    if (value !== undefined) values[key] = value;
  }
  if (values.APP_ENV !== "demo" && values.APP_ENV !== "test")
    throw new Error("DEMO_APP_ENV_REQUIRED");
  const projectName = values.COMPOSE_PROJECT_NAME;
  if (!projectName || !/^contract-audit-demo(?:-[a-z0-9_-]+)?$/u.test(projectName))
    throw new Error("DEMO_COMPOSE_PROJECT_INVALID");
  if (!/^contract_audit_demo(?:_[a-z0-9_]+)?$/u.test(values.POSTGRES_DB ?? ""))
    throw new Error("DEMO_DATABASE_NAME_INVALID");
  if (
    values.DEMO_DATABASE_NAME !== values.POSTGRES_DB ||
    values.DEMO_RESET_CONFIRMATION !== values.POSTGRES_DB ||
    !values.DEMO_ENVIRONMENT_ID
  )
    throw new Error("DEMO_DATABASE_CONFIRMATION_INVALID");
  const ports = new Set<number>();
  for (const service of ["POSTGRES", "REDIS", "S3", "S3_CONSOLE", "API", "WEB"]) {
    if (values[`${service}_BIND`] !== "127.0.0.1") throw new Error("DEMO_LOOPBACK_BIND_REQUIRED");
    const port = Number(values[`${service}_PORT`]);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || ports.has(port))
      throw new Error("DEMO_DISTINCT_PORTS_REQUIRED");
    ports.add(port);
  }
  for (const key of ["POSTGRES_PASSWORD", "S3_SECRET_KEY", "LLM_KEY_ENCRYPTION_SECRET"]) {
    if ((values[key]?.length ?? 0) < 32 || /\s/u.test(values[key] ?? ""))
      throw new Error("DEMO_SECRET_REQUIRED_MINIMUM_32_CHARACTERS");
  }
  let database: URL;
  try {
    database = new URL(values.DATABASE_URL ?? "");
  } catch {
    throw new Error("DEMO_DATABASE_CONNECTION_MISMATCH");
  }
  if (
    !/^(postgres|postgresql):$/u.test(database.protocol) ||
    database.hostname !== "127.0.0.1" ||
    database.port !== values.POSTGRES_PORT ||
    database.pathname !== `/${values.POSTGRES_DB}` ||
    database.username !== values.POSTGRES_USER ||
    decodeURIComponent(database.password) !== values.POSTGRES_PASSWORD ||
    database.search ||
    database.hash
  )
    throw new Error("DEMO_DATABASE_CONNECTION_MISMATCH");
  const apiOrigin = `http://127.0.0.1:${values.API_PORT}`;
  const webOrigin = `http://127.0.0.1:${values.WEB_PORT}`;
  if (
    values.API_BASE_URL !== apiOrigin ||
    values.WEB_ORIGIN !== webOrigin ||
    values.S3_ENDPOINT !== `http://127.0.0.1:${values.S3_PORT}` ||
    values.REDIS_URL !== `redis://127.0.0.1:${values.REDIS_PORT}`
  )
    throw new Error("DEMO_SERVICE_ORIGIN_MISMATCH");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(values.S3_BUCKET ?? ""))
    throw new Error("DEMO_BUCKET_INVALID");
  const compose = [
    "docker",
    "compose",
    "--file",
    resolve(projectRoot, "compose.yaml"),
    "--project-directory",
    projectRoot,
    "--env-file",
    path,
    "--project-name",
    projectName,
  ];
  return { path, values, apiOrigin, webOrigin, compose };
}

/** Sanitize command output before it reaches either terminal or persisted logs. */
export function redactDemoOutput(text: string, values: Record<string, string>): string {
  let sanitized = text;
  for (const [key, value] of Object.entries(values)) {
    if (
      /(?:PASSWORD|SECRET|SECRET_KEY|TOKEN|API_KEY|ACCESS_KEY|DATABASE_URL)$/u.test(key) &&
      value.length >= 4
    )
      sanitized = sanitized.replaceAll(value, "[REDACTED]");
  }
  return sanitized.replace(/(postgres(?:ql)?:\/\/)[^\s/@]+:[^\s/@]+@/gu, "$1[REDACTED]@");
}
