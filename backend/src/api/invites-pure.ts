// Pure helpers for the invites handler. BUGS.md 5a path-(b) round 2.
//
// These functions handle token generation, body validation, and date math —
// the parts of the invites flow that don't need a database. The handler's
// DB-bound parts (member-check, project lookup, tier enforcement, the
// insert + update) stay in invites.ts.
//
// Why these specific helpers matter:
// - `generateInviteToken` is security-critical: a weak token (low entropy,
//   wrong charset) becomes a guessing-attack surface. Pinned tests catch
//   accidental crypto downgrades.
// - `parseInviteRequestBody` is the only validation between an attacker
//   and the insert. Sloppy whitespace handling or JSON-parse exceptions
//   bubbling as 500s are the bug class.
// - `isInviteExpired` / `isInviteAccepted` carry the redemption gate's
//   state machine. Off-by-one date math or "accepted_at exists" semantics
//   wrong = re-redeemable tokens (security incident).

// 7-day default TTL for invite tokens. Exported as a constant so tests can
// pin the value and the handler imports rather than re-deriving.
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Public base URL the join URL is constructed against. Centralized here
// (rather than scattered through the handler) so a deployment-env switch
// (staging vs prod) lands in one place.
export const JOIN_URL_BASE = "https://synapsesync.app/invite";

export interface InviteState {
  accepted_at: string | null;
  expires_at: string;
}

// Generate a cryptographically random invite token.
//
// Format: 32-char base64url string derived from 24 random bytes (24 * 8 =
// 192 bits of entropy — well above the 128-bit floor for "infeasible to
// guess at any practical scale"). The base64url substitution (`+` → `-`,
// `/` → `_`, strip `=`) keeps the token URL-safe so it can appear in the
// `/invite/<token>` path without percent-encoding.
//
// Uses `crypto.getRandomValues` because it's available in the Cloudflare
// Workers runtime (no Node `crypto` import needed) and is a CSPRNG.
// Math.random() is NOT cryptographically secure — explicitly avoid.
export function generateInviteToken(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type ParseInviteBodyResult = { ok: true; email: string } | { ok: false; status: 400; reason: string };

// Validate the POST /api/projects/:id/invites body. Two rejection paths:
// (a) JSON parse failure (caller passed malformed bytes) → "invalid JSON body"
// (b) email missing / not a string / whitespace-only → "email required"
//
// Both produce 400 with the existing error shape; extracted so tests can
// exercise the malformed-JSON case (which is hard to trigger via Hono's
// c.req.json() typed parsing) and the whitespace-only case (which the
// original `body.email.trim()` line covered but no test asserted).
//
// The function accepts a STRING (the raw POST body) rather than the
// parsed object, to expose the try/catch boundary as part of the
// testable contract.
export function parseInviteRequestBody(rawBody: string): ParseInviteBodyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, reason: "invalid JSON body" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, status: 400, reason: "email required" };
  }
  const email =
    typeof (parsed as { email?: unknown }).email === "string" ? (parsed as { email: string }).email.trim() : "";
  if (!email) return { ok: false, status: 400, reason: "email required" };
  return { ok: true, email };
}

// Is the invite past its expires_at? The redemption handler uses this to
// return 410 Gone.
//
// Comparison: `expires_at_ms < now`. Strictly less-than means an invite at
// the EXACT moment `now === expires_at_ms` is still valid (one millisecond
// of grace). This matches the existing inline behavior — pinned so a
// future refactor doesn't flip the inequality and accidentally invalidate
// in-flight redemptions.
export function isInviteExpired(invite: InviteState, now: number): boolean {
  return new Date(invite.expires_at).getTime() < now;
}

// Is this invite already redeemed? Bug class: someone changes the column
// or interprets `null` as "valid for accept_at lookup."
export function isInviteAccepted(invite: InviteState): boolean {
  return invite.accepted_at !== null && invite.accepted_at !== undefined;
}

// Compute the ISO-string expires_at for a new invite. Extracted (rather
// than left inline) so the TTL is testably wired through, not hardcoded
// at the call site where a typo would silently halve or double it.
export function computeInviteExpiresAt(now: number, ttlMs: number = INVITE_TTL_MS): string {
  return new Date(now + ttlMs).toISOString();
}

// Compose the join URL the inviter shares manually (email delivery is
// post-v1.1). Centralized here so JOIN_URL_BASE swaps land in one place.
export function buildJoinUrl(token: string): string {
  return `${JOIN_URL_BASE}/${token}`;
}
