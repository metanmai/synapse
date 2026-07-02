/**
 * Single source of truth for the browser hosts Synapse captures AI sessions from.
 *
 * Consumed by: the extension manifest `matches`, the daemon ingest route's
 * allowlist, and the per-host adapter registry. Anti-drift tests assert these
 * three stay in agreement so adding a host can't silently mis-tag or leak.
 */

export const CAPTURE_HOSTS = ["claude.ai", "chatgpt.com"] as const;

export type CaptureHost = (typeof CAPTURE_HOSTS)[number];

/** Exact-host match — rejects subdomain/suffix lookalikes (e.g. `claude.ai.evil.com`). */
export function isCaptureHost(host: string): host is CaptureHost {
  return (CAPTURE_HOSTS as readonly string[]).includes(host);
}

/**
 * Host → Synapse tool tag. Keyed by `CaptureHost` so the type system forces a
 * mapping for every capture host — no host-string-slicing hacks (P6).
 */
export const HOST_TOOL: Record<CaptureHost, string> = {
  "claude.ai": "claude-ai",
  "chatgpt.com": "chatgpt",
};
