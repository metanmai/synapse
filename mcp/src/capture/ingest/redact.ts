/**
 * Defense-in-depth credential scrub (R3 / P3).
 *
 * This is the SECOND privacy layer. The first is the ingest route's
 * allowlist schema (ingest-route.ts), which drops every key except
 * `{host, messages:[{role,content,ts}]}`. This function then scrubs
 * token-shaped VALUES inside the surviving `content` strings — an
 * `sk-…`, a `Bearer …`, a JWT, or a cookie-shaped pair that a user (or
 * model) happened to paste into a message. It runs over conversation
 * text, not over arbitrary structured payloads.
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
