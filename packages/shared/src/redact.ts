/**
 * Defense-in-depth credential scrub — the SINGLE source of truth, shared by
 * BOTH ingest paths:
 *   - the daemon's loopback ingest (mcp/src/capture/ingest/ingest-route.ts), and
 *   - the backend's direct browser-capture endpoint (POST /api/capture/browser).
 *
 * A security scrub MUST NOT drift between the two paths, so it lives in
 * @synapse/shared rather than being duplicated. It scrubs token-shaped VALUES
 * inside conversation `content` strings — an `sk-…`, a `Bearer …`, a JWT, or a
 * cookie/token=value pair a user or model happened to paste into a message.
 * It runs over conversation text, not arbitrary structured payloads.
 *
 * This is the second privacy layer; the first is the allowlist schema that
 * drops every key except `{host, messages:[{role,content,ts}]}`.
 */

const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // provider API keys (sk-…, sk-live-…, sk-ant-…)
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, // bearer tokens
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWTs
  /\b[A-Za-z0-9_-]*(?:session|cookie|token|secret)[A-Za-z0-9_-]*=\s*[A-Za-z0-9._-]{8,}/gi, // cookie/token=value pairs
];

export function scrubSecretValues(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}
