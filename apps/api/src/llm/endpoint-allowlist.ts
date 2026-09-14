import { isIP } from "node:net";

/** Hostnames allowed when `LLM_ENDPOINT_ALLOWLIST` is set (comma-separated). */
export function allowedLlmHosts(): Set<string> | null {
  const raw = process.env.LLM_ENDPOINT_ALLOWLIST?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );
}

const isPrivateHost = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  if (lower === "localhost") return true;
  if (isIP(hostname) === 4) {
    const parts = hostname.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }
  if (isIP(hostname) === 6 && lower.startsWith("fe80:")) return true;
  return false;
};

/**
 * Rejects provider endpoints that would SSRF internal networks unless explicitly
 * allowlisted. Public https hosts pass when no allowlist is configured.
 */
export function assertAllowedLlmEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("LLM_ENDPOINT_INVALID");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LLM_ENDPOINT_INVALID");
  }
  const host = url.hostname.toLowerCase();
  const allowlist = allowedLlmHosts();
  if (allowlist) {
    if (!allowlist.has(host)) throw new Error("LLM_ENDPOINT_NOT_ALLOWED");
    return;
  }
  if (isPrivateHost(host)) throw new Error("LLM_ENDPOINT_NOT_ALLOWED");
}
