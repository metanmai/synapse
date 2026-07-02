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

function isExtensionOrigin(origin: string): boolean {
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
  // 1. loopback only
  if (!isLoopback(ctx.remoteAddress)) return { ok: false, status: 403 };

  // 2. shared secret (constant-time)
  if (!ctx.token || !tokensMatch(ctx.token, ctx.expectedToken)) return { ok: false, status: 401 };

  // 3. reject web origins (absent is fine — some extension transports omit Origin)
  if (ctx.origin && !isExtensionOrigin(ctx.origin)) return { ok: false, status: 403 };

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
