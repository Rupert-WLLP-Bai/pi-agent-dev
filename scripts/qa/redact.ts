import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

/**
 * Output sanitization for QA-captured logs (report + fault scenarios).
 *
 * Two capture surfaces need the same guarantee: the layered QA report's
 * per-layer command output, and the fault-runner's scenario errors. Anything
 * that reaches either file is treated as an untrusted capture, because a tool
 * the runner invoked may have echoed more than intended.
 *
 * The filter is a narrow allowlist in spirit:
 *
 * - keys whose *name* marks them a credential get their value redacted, so an
 *   assignment like `S3_SECRET_KEY=...` never survives;
 * - connection URLs carrying embedded credentials have only the credential
 *   part removed — the host stays readable, which keeps a log actionable;
 * - the literal values of the managed demo environment (`.demo.env`, when the
 *   run created one) are redacted wherever they appear, since a generated
 *   password is unknowable to a name-based rule.
 *
 * Anything not matched is left readable: a log that redacts everything is as
 * useless as one that leaks.
 */

const SECRET_KEY_NAMES =
  /(?:PASSWORD|PASSWD|SECRET|SECRET_KEY|TOKEN|API_KEY|APIKEY|ACCESS_KEY|ACCESS_KEY_ID|PRIVATE_KEY|DATABASE_URL)$/u;

/** `KEY=value` assignments whose key name marks a secret. */
const ASSIGNMENT_PATTERN =
  /((?:PASSWORD|PASSWD|SECRET|SECRET_KEY|TOKEN|API_KEY|APIKEY|ACCESS_KEY|ACCESS_KEY_ID|PRIVATE_KEY|DATABASE_URL)[A-Z0-9_]*\s*=\s*)\S+/giu;

/** Credentials embedded in a URL: `scheme://user:pass@host` → host kept. */
const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu;

/** Redacts a `KEY=value` assignment by key name. */
const redactAssignments = (text: string): string =>
  text.replace(ASSIGNMENT_PATTERN, "$1[REDACTED]");

/** Redacts only the `user:pass@` part of a connection URL, keeping the host. */
const redactUrlCredentials = (text: string): string =>
  text.replace(URL_CREDENTIAL_PATTERN, "$1[REDACTED]@");

/** Literal values of the managed demo environment, when one exists. */
const managedEnvironmentValues = (): Record<string, string> => {
  const path = resolve(
    fileURLToPath(new URL("../../", import.meta.url)),
    process.env.DEMO_ENV_FILE ?? ".demo.env",
  );
  if (!existsSync(path)) return {};
  try {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8"))) as Array<
      [string, string]
    >) {
      if (value !== undefined && SECRET_KEY_NAMES.test(key) && value.length >= 4) {
        values[key] = value;
      }
    }
    return values;
  } catch {
    // An unreadable .demo.env must not crash a QA run; name- and URL-based
    // redaction still apply without it.
    return {};
  }
};

/**
 * Applies the full allowlist to one chunk of captured output. Managed-env
 * literals are replaced first, so a generated password disappears wherever it
 * appears, not only in its assignment form.
 */
export const sanitizeCapturedText = (text: string): string => {
  let sanitized = text;
  for (const value of Object.values(managedEnvironmentValues())) {
    sanitized = sanitized.replaceAll(value, "[REDACTED]");
  }
  sanitized = redactAssignments(sanitized);
  sanitized = redactUrlCredentials(sanitized);
  return sanitized;
};
