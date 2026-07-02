/**
 * Daemon loopback ingest route for browser-captured AI sessions (Phase 3).
 *
 * Security boundaries, in order:
 *   1. loopback-only  — reject any non-127.0.0.1/::1 caller (403).
 *   2. shared secret  — require X-Synapse-Ingest-Token == the wizard-minted
 *                       token (401). Loopback binding alone does not stop other
 *                       local processes or a webpage POSTing to 127.0.0.1.
 *   3. origin guard   — reject any request carrying a web `Origin` that isn't a
 *                       browser-extension origin (403).
 *   4. allowlist schema — accept ONLY `{ host ∈ CAPTURE_HOSTS,
 *                       messages:[{role,content,ts}] }`. Every other key
 *                       (headers, cookies, anything else) is never read, so it
 *                       cannot survive. Security by construction, not blocklist.
 *   5. value scrub    — run scrubSecretValues over each `content` (defense-in-depth).
 *
 * `sync` is injected so unit tests touch no network.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { type CaptureHost, HOST_TOOL, isCaptureHost } from "@synapse/shared/capture-hosts.js";
import type { CapturedSession, SessionMessage } from "../types.js";
import { scrubSecretValues } from "./redact.js";

export interface IngestContext {
  remoteAddress: string | undefined;
  token: string | undefined;
  expectedToken: string;
  origin: string | undefined;
  sync: (session: CapturedSession) => Promise<boolean>;
}

export interface IngestResult {
  ok: boolean;
  status?: number;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopback(addr: string | undefined): boolean {
  return addr !== undefined && LOOPBACK.has(addr);
}

export function isExtensionOrigin(origin: string): boolean {
  return (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("moz-extension://") ||
    origin.startsWith("safari-web-extension://")
  );
}

function tokensMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Shared transport guards for every ingest endpoint:
 * loopback(403) → shared-secret(401) → extension-Origin(403).
 * Returns a rejection status, or null to proceed.
 */
function checkGuards(ctx: Omit<IngestContext, "sync">): number | null {
  if (!isLoopback(ctx.remoteAddress)) return 403;
  if (!ctx.token || !tokensMatch(ctx.token, ctx.expectedToken)) return 401;
  if (ctx.origin && !isExtensionOrigin(ctx.origin)) return 403;
  return null;
}

/** Stable id from host + first message, so continuations of one conversation collapse. */
function sessionIdFromContent(host: string, messages: SessionMessage[]): string {
  const seed = `${host}:${messages[0]?.role ?? ""}:${messages[0]?.content ?? ""}`;
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  return `ses_${hash}`;
}

interface IngestBody {
  host?: unknown;
  messages?: unknown;
}
interface RawTurn {
  role?: unknown;
  content?: unknown;
  ts?: unknown;
}

export async function handleIngest(body: unknown, ctx: IngestContext): Promise<IngestResult> {
  // 1-3. loopback + shared-secret + origin guards
  const rejected = checkGuards(ctx);
  if (rejected !== null) return { ok: false, status: rejected };

  // 4. allowlist schema — read ONLY host + messages, nothing else
  const b = (body ?? {}) as IngestBody;
  if (typeof b.host !== "string" || !isCaptureHost(b.host)) return { ok: false, status: 400 };
  const host: CaptureHost = b.host;

  const rawTurns: RawTurn[] = Array.isArray(b.messages) ? (b.messages as RawTurn[]) : [];
  const messages: SessionMessage[] = [];
  for (const t of rawTurns) {
    const content = scrubSecretValues(String(t.content ?? ""));
    if (!content) continue;
    messages.push({
      role: t.role === "assistant" ? "assistant" : "user",
      content, // 5. value scrub already applied
      timestamp: typeof t.ts === "string" ? t.ts : new Date().toISOString(),
    });
  }
  if (messages.length === 0) return { ok: false, status: 400 };

  const session: CapturedSession = {
    id: sessionIdFromContent(host, messages),
    tool: HOST_TOOL[host] as CapturedSession["tool"],
    projectPath: `synapse://browser/${host}`,
    startedAt: messages[0].timestamp,
    updatedAt: messages[messages.length - 1].timestamp,
    messages,
  };

  await ctx.sync(session);
  return { ok: true };
}

export interface HeartbeatResult {
  ok: boolean;
  status?: number;
  host?: CaptureHost;
}

/**
 * Page-visit heartbeat (R2 / P1). Same transport guards as ingest, but no
 * messages — just records that a CAPTURE_HOST tab was active so a silently-
 * broken adapter (zero captures despite an active tab) is detectable.
 */
export function handleHeartbeat(body: unknown, ctx: Omit<IngestContext, "sync">): HeartbeatResult {
  const rejected = checkGuards(ctx);
  if (rejected !== null) return { ok: false, status: rejected };
  const host = (body as { host?: unknown }).host;
  if (typeof host !== "string" || !isCaptureHost(host)) return { ok: false, status: 400 };
  return { ok: true, host };
}

export interface DriftResult {
  ok: boolean;
  status?: number;
  host?: CaptureHost;
  eventNames?: string[];
  byteLength?: number;
  sampleHash?: string;
}

/**
 * Wire-format drift signal (Layer 1). Same transport guards as ingest. Allowlist
 * schema: host + structural shape only (eventNames, byteLength, sampleHash). No
 * message content is ever read or echoed — that is the privacy contract.
 */
export function handleDrift(body: unknown, ctx: Omit<IngestContext, "sync">): DriftResult {
  const rejected = checkGuards(ctx);
  if (rejected !== null) return { ok: false, status: rejected };
  const b = (body ?? {}) as { host?: unknown; eventNames?: unknown; byteLength?: unknown; sampleHash?: unknown };
  if (typeof b.host !== "string" || !isCaptureHost(b.host)) return { ok: false, status: 400 };
  const eventNames = Array.isArray(b.eventNames)
    ? b.eventNames.filter((n): n is string => typeof n === "string").slice(0, 20)
    : [];
  return {
    ok: true,
    host: b.host,
    eventNames,
    byteLength: typeof b.byteLength === "number" ? b.byteLength : 0,
    sampleHash: typeof b.sampleHash === "string" ? b.sampleHash : "",
  };
}
