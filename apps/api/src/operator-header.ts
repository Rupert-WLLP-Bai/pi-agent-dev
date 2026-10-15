/**
 * Resolves the acting operator named by the `X-Operator` request header.
 *
 * Header values are byte strings, so a client cannot put a non-ASCII name
 * (the web client's default operator is "我") on the wire verbatim — browsers
 * and Bun both reject it. The client percent-encodes, and the value is decoded
 * here. A value with no escape sequence passes through unchanged. A malformed
 * escape is a client bug, so the header is reported as absent — the body actor
 * (or the default) still applies rather than a corrupted name being recorded.
 */
export function operatorFrom(headers: Record<string, string | undefined>): string | undefined {
  const raw = headers["x-operator"];
  if (raw === undefined) return undefined;
  try {
    const decoded = decodeURIComponent(raw);
    const name = decoded.trim();
    if (!name || name.length > 128 || /\p{Cc}/u.test(decoded)) return undefined;
    return name;
  } catch {
    return undefined;
  }
}
