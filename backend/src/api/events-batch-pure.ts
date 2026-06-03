// Pure helpers for the events-batch handler. Extracted from events-batch.ts
// so the logic can be unit-tested without standing up a Supabase test
// instance (BUGS.md 5a path b).
//
// The handler in events-batch.ts becomes thin glue around these helpers
// plus the inherently impure DB operations (upsert handoff_events,
// recomputeProjectStatus). The bug classes covered here — skew adjustment,
// cwd_<hash> regex, id remapping, body validation — were previously
// reachable only through the `.skip`'d integration tests, which means a
// regression in any of them would only show up in production traffic
// (the same failure mode that produced the Cloudflare 1101 in P0 #1).

// Skew limit: events claiming to have occurred more than this far in the
// FUTURE relative to receiver-now get their occurred_at clamped to now and
// their event_id reported in the `adjusted` response array. Past-skewed
// events are intentionally NOT adjusted — late deliveries from offline
// devices are legitimate and the reducer's orderKey already handles them.
export const DEFAULT_SKEW_LIMIT_MS = 5 * 60 * 1000;

// cwd_<hash> project_id format used as a placeholder when the daemon
// dispatches events for a directory not yet known to a project-map. The
// auto-create path replaces these with real project UUIDs. The pattern is
// deliberately strict (lowercase hex, exactly 12 chars) so casually-named
// project_ids like "cwd_main" or "cwd_AABBCC" CANNOT accidentally collide
// with the auto-create path and trigger a spurious project insertion.
export const DEFAULT_CWD_HASH_PATTERN = /^cwd_[a-f0-9]{12}$/;

// Shape of the incoming events from the daemon's POST body. All fields are
// `unknown` because the caller hasn't been validated yet — runtime checks
// happen in prepareEventRows where we coerce + reject invalid shapes.
export interface BatchEvent {
  event_id: unknown;
  project_id: unknown;
  session_id: unknown;
  actor: unknown;
  attached_to?: unknown;
  kind: unknown;
  occurred_at: unknown;
  payload?: unknown;
}

// The DB row shape after coercion + actor flattening. `project_id` is
// MUTABLE because applyIdMapping rewrites cwd_<hash> placeholders in-place
// once the auto-create path resolves them to real UUIDs.
export interface RowMutable {
  event_id: string;
  project_id: string;
  session_id: string;
  actor_user_id: string;
  actor_kind: string;
  actor_device_id: string;
  attached_to: unknown;
  kind: string;
  occurred_at: string;
  received_at: string;
  payload: unknown;
}

export type ValidateResult = { ok: true; events: BatchEvent[] } | { ok: false; reason: string };

// Body-shape gate before any handler work. Currently checks two things:
// (a) `events` is an array (rejects { events: null } or missing key),
// (b) it's non-empty (rejects the no-op batch). Both produce the same
// "events array required" reason that the live handler returns as 400.
// Adding new validation (e.g. max size cap) lands here, kept pure so the
// guard can be tested without invoking the handler.
export function validateEventsBatchBody(body: unknown): ValidateResult {
  if (!body || typeof body !== "object") return { ok: false, reason: "events array required" };
  const b = body as { events?: unknown };
  if (!Array.isArray(b.events) || b.events.length === 0) {
    return { ok: false, reason: "events array required" };
  }
  return { ok: true, events: b.events as BatchEvent[] };
}

export interface PreparedRows {
  rows: RowMutable[];
  adjusted_event_ids: string[];
}

// Coerce inbound BatchEvents into mutable DB rows + flag the ones whose
// occurred_at was clamped due to forward clock skew. `userId` is the
// authenticated user — events trust the actor.kind/device_id field but the
// user_id is server-side authoritative (clients can't impersonate). `now`
// is millisecond epoch (Date.now()); injected so tests are deterministic.
export function prepareEventRows(
  events: BatchEvent[],
  userId: string,
  now: number,
  skewLimitMs: number = DEFAULT_SKEW_LIMIT_MS,
): PreparedRows {
  const adjusted_event_ids: string[] = [];
  const rows: RowMutable[] = events.map((e) => {
    const eventId = String(e.event_id);
    const occMs = new Date(String(e.occurred_at)).getTime();
    let occurred_at = String(e.occurred_at);
    if (occMs - now > skewLimitMs) {
      adjusted_event_ids.push(eventId);
      occurred_at = new Date(now).toISOString();
    }
    const actor = e.actor as { kind: string; device_id: string };
    return {
      event_id: eventId,
      project_id: String(e.project_id),
      session_id: String(e.session_id),
      actor_user_id: userId,
      actor_kind: actor.kind,
      actor_device_id: actor.device_id,
      attached_to: e.attached_to ?? null,
      kind: String(e.kind),
      occurred_at,
      received_at: new Date(now).toISOString(),
      payload: e.payload ?? {},
    };
  });
  return { rows, adjusted_event_ids };
}

// De-duplicated list of cwd_<hash> placeholder project_ids in the batch.
// The handler uses this to drive the auto-create loop. Pattern is injected
// for tests; production callers use the default. Empty result is fine —
// it just means none of the events need auto-create resolution.
export function extractCwdHashes(rows: RowMutable[], pattern: RegExp = DEFAULT_CWD_HASH_PATTERN): string[] {
  return [...new Set(rows.filter((r) => pattern.test(r.project_id)).map((r) => r.project_id))];
}

// Mutate each row's project_id IN PLACE if the auto-create loop produced a
// mapping for it. In-place is intentional — RowMutable is a write-buffer
// for the upsert, and mutating preserves the existing surface contract
// (callers expect `rows` to have canonical ids when they go to upsert).
export function applyIdMapping(rows: RowMutable[], idMapping: Map<string, string>): void {
  for (const r of rows) {
    const remapped = idMapping.get(r.project_id);
    if (remapped) r.project_id = remapped;
  }
}
