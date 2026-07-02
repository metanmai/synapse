// backend/test/api/events-batch-pure.test.ts
//
// BUGS.md 5a path (b): pure-helper coverage for the events-batch handler.
//
// These tests run without Supabase, without auth, without the Worker
// runtime — they target the pure functions extracted from the handler. The
// bug classes covered here used to be reachable only via integration tests
// that are `.skip`'d for lack of Supabase test secrets, which is precisely
// how the Cloudflare 1101 in P0 #1 escaped detection.
//
// Pattern: when extending the handler with new logic, extend the pure
// helpers first, test them here, then wire them into the handler. The
// handler should remain thin glue around DB calls.

import { describe, expect, it } from "vitest";
import {
  type BatchEvent,
  DEFAULT_CWD_HASH_PATTERN,
  DEFAULT_SKEW_LIMIT_MS,
  type RowMutable,
  applyIdMapping,
  extractCwdHashes,
  prepareEventRows,
  validateEventsBatchBody,
} from "../../src/api/events-batch-pure";

// Helper to build a BatchEvent — most tests only care about a subset of
// fields, so this gives sensible defaults that can be overridden.
function makeBatchEvent(over: Partial<BatchEvent> = {}): BatchEvent {
  return {
    event_id: "evt_1",
    project_id: "proj_1",
    session_id: "sess_1",
    actor: { user_id: "ignored", kind: "human", device_id: "dev_1", hostname: "h", client: "c" },
    attached_to: null,
    kind: "session_opened",
    occurred_at: "2026-05-30T12:00:00Z",
    payload: {},
    ...over,
  };
}

describe("validateEventsBatchBody — 400 gate", () => {
  it("rejects non-object body (e.g., null, string)", () => {
    // Bug class: handler crashes on a body that the daemon shouldn't send
    // but a misbehaving client (cURL, scripted attacker) might. The
    // validate gate must return { ok: false } rather than throw.
    expect(validateEventsBatchBody(null)).toEqual({ ok: false, reason: "events array required" });
    expect(validateEventsBatchBody("not-an-object")).toEqual({ ok: false, reason: "events array required" });
    expect(validateEventsBatchBody(42)).toEqual({ ok: false, reason: "events array required" });
  });

  it("rejects body missing `events` key", () => {
    expect(validateEventsBatchBody({})).toEqual({ ok: false, reason: "events array required" });
  });

  it("rejects body where `events` is not an array", () => {
    // Bug class: a typo from a daemon refactor sends { events: <single event object> }
    // The validate gate must catch the shape mismatch BEFORE the .map() call
    // attempts iteration on a non-iterable and produces a confusing crash.
    expect(validateEventsBatchBody({ events: null })).toEqual({ ok: false, reason: "events array required" });
    expect(validateEventsBatchBody({ events: { event_id: "e1" } })).toEqual({
      ok: false,
      reason: "events array required",
    });
  });

  it("rejects empty events array", () => {
    expect(validateEventsBatchBody({ events: [] })).toEqual({ ok: false, reason: "events array required" });
  });

  it("accepts a body with at least one event", () => {
    const result = validateEventsBatchBody({ events: [{ event_id: "e1" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events).toHaveLength(1);
  });
});

describe("prepareEventRows — skew adjustment", () => {
  const NOW_MS = new Date("2026-05-30T12:00:00Z").getTime();

  it("does NOT adjust past-skewed events (late delivery from offline device is legit)", () => {
    // Bug class: skew adjustment incorrectly stamps `now` on legitimately
    // late-arriving events, destroying the device's reported timestamp and
    // breaking the reducer's LWW ordering for any prior session state.
    const event = makeBatchEvent({
      event_id: "past_1",
      occurred_at: "2026-05-30T11:00:00Z", // 1h before NOW
    });
    const { rows, adjusted_event_ids } = prepareEventRows([event], "user_1", NOW_MS);
    expect(rows[0].occurred_at).toBe("2026-05-30T11:00:00Z");
    expect(adjusted_event_ids).toEqual([]);
  });

  it("does NOT adjust events within the skew window (forward but plausible)", () => {
    // Bug class: aggressive skew rejection clamps every slightly-forward
    // event, masking real device clock drift signals that ops would want
    // visible. The window is symmetric: under SKEW_LIMIT_MS forward = OK.
    const event = makeBatchEvent({
      event_id: "near_future_1",
      occurred_at: "2026-05-30T12:04:00Z", // 4min in future, under 5min cap
    });
    const { rows, adjusted_event_ids } = prepareEventRows([event], "user_1", NOW_MS);
    expect(rows[0].occurred_at).toBe("2026-05-30T12:04:00Z");
    expect(adjusted_event_ids).toEqual([]);
  });

  it("ADJUSTS events beyond the skew window and flags them in adjusted_event_ids", () => {
    // Bug class: someone forgets to flag the adjustment in the response
    // — the client never learns that its clock is broken and continues
    // sending bogus timestamps. The flag is the only feedback signal.
    const event = makeBatchEvent({
      event_id: "future_skewed_1",
      occurred_at: "2026-05-30T13:00:00Z", // 1h in future, way past cap
    });
    const { rows, adjusted_event_ids } = prepareEventRows([event], "user_1", NOW_MS);
    expect(rows[0].occurred_at).toBe(new Date(NOW_MS).toISOString());
    expect(adjusted_event_ids).toEqual(["future_skewed_1"]);
  });

  it("respects custom skewLimitMs (override for tests / future tuning)", () => {
    // Default is 5 min; here we tighten to 1 min so a 2-min-future event
    // gets caught. Ensures the parameter is wired, not hardcoded.
    const event = makeBatchEvent({
      event_id: "tight_skew",
      occurred_at: "2026-05-30T12:02:00Z", // 2min in future
    });
    const tightLimit = 60 * 1000;
    const { adjusted_event_ids } = prepareEventRows([event], "user_1", NOW_MS, tightLimit);
    expect(adjusted_event_ids).toEqual(["tight_skew"]);
  });

  it("DEFAULT_SKEW_LIMIT_MS exported as 5 min (pinned constant)", () => {
    // Bug class: someone changes the constant from 5min to 5sec by typo
    // (`5 * 60` not `5 * 60 * 1000`) and the response now flags everything.
    // Pin the value so the change is intentional.
    expect(DEFAULT_SKEW_LIMIT_MS).toBe(5 * 60 * 1000);
  });

  it("flattens actor.kind and actor.device_id into row columns; user_id is server-authoritative", () => {
    // Bug class: actor flattening drops a field. The reducer downstream
    // hard-codes the column names so a missing one would produce a row
    // with `undefined` values that downstream queries (countCliKeys etc.)
    // would silently skip.
    const event = makeBatchEvent({
      event_id: "flat_1",
      actor: { kind: "synapse-daemon", device_id: "dev_xyz" },
    });
    const { rows } = prepareEventRows([event], "auth_user_42", NOW_MS);
    expect(rows[0].actor_user_id).toBe("auth_user_42"); // SERVER auth wins over client claim
    expect(rows[0].actor_kind).toBe("synapse-daemon");
    expect(rows[0].actor_device_id).toBe("dev_xyz");
  });

  it("defaults attached_to to null, payload to {} when omitted", () => {
    // Bug class: optional fields land as `undefined` in the row, breaking
    // Postgres NOT NULL constraints or serializing as 'null' string.
    const event = makeBatchEvent({ attached_to: undefined, payload: undefined });
    const { rows } = prepareEventRows([event], "user_1", NOW_MS);
    expect(rows[0].attached_to).toBeNull();
    expect(rows[0].payload).toEqual({});
  });

  it("stamps received_at as ISO string from `now` argument (server clock)", () => {
    // Bug class: server uses client-provided timestamp for received_at,
    // breaking the dual-clock contract that lets the reducer detect skew
    // post-facto via the orderKey fallback.
    const event = makeBatchEvent();
    const { rows } = prepareEventRows([event], "user_1", NOW_MS);
    expect(rows[0].received_at).toBe(new Date(NOW_MS).toISOString());
  });

  it("processes a mixed batch of past + within-window + future-skewed events correctly", () => {
    // Bug class: per-event state leaks between iterations (e.g., adjusted
    // array reused across calls, or a flag set by event N corrupts event
    // N+1's adjustment). The mixed batch exposes any such interaction.
    const events = [
      makeBatchEvent({ event_id: "past", occurred_at: "2026-05-30T10:00:00Z" }),
      makeBatchEvent({ event_id: "ok", occurred_at: "2026-05-30T12:01:00Z" }),
      makeBatchEvent({ event_id: "future_1", occurred_at: "2026-05-30T14:00:00Z" }),
      makeBatchEvent({ event_id: "future_2", occurred_at: "2026-05-30T15:00:00Z" }),
    ];
    const { rows, adjusted_event_ids } = prepareEventRows(events, "user_1", NOW_MS);
    expect(rows).toHaveLength(4);
    expect(rows[0].occurred_at).toBe("2026-05-30T10:00:00Z"); // past untouched
    expect(rows[1].occurred_at).toBe("2026-05-30T12:01:00Z"); // ok untouched
    expect(rows[2].occurred_at).toBe(new Date(NOW_MS).toISOString()); // future clamped
    expect(rows[3].occurred_at).toBe(new Date(NOW_MS).toISOString()); // future clamped
    expect(adjusted_event_ids).toEqual(["future_1", "future_2"]);
  });
});

describe("extractCwdHashes — regex strictness", () => {
  function row(project_id: string): RowMutable {
    return {
      event_id: "e",
      project_id,
      session_id: "s",
      actor_user_id: "u",
      actor_kind: "human",
      actor_device_id: "d",
      attached_to: null,
      kind: "session_opened",
      occurred_at: "2026-05-30T12:00:00Z",
      received_at: "2026-05-30T12:00:00Z",
      payload: {},
    };
  }

  it("matches the canonical shape: cwd_<12 lowercase hex>", () => {
    expect(extractCwdHashes([row("cwd_abcdef123456")])).toEqual(["cwd_abcdef123456"]);
    expect(extractCwdHashes([row("cwd_000000000000")])).toEqual(["cwd_000000000000"]);
    expect(extractCwdHashes([row("cwd_fedcba987654")])).toEqual(["cwd_fedcba987654"]);
  });

  it("REJECTS too-short suffix (cwd_short)", () => {
    // Bug class: regex anchors are dropped, so any string starting with
    // `cwd_` triggers auto-create. A user with a real project named
    // `cwd_main` would spawn a phantom project on every batch.
    expect(extractCwdHashes([row("cwd_short")])).toEqual([]);
    expect(extractCwdHashes([row("cwd_abc")])).toEqual([]);
    expect(extractCwdHashes([row("cwd_")])).toEqual([]);
  });

  it("REJECTS extra trailing chars (cwd_aabbcc112233_extra)", () => {
    // Bug class: $ anchor dropped. A daemon sending `cwd_<hash>_<noise>`
    // by accident shouldn't trigger auto-create — that path is reserved
    // for the canonical 12-hex placeholder.
    expect(extractCwdHashes([row("cwd_aabbcc112233_extra")])).toEqual([]);
    expect(extractCwdHashes([row("cwd_aabbcc112233abc")])).toEqual([]);
  });

  it("REJECTS uppercase hex (cwd_AABBCC112233)", () => {
    // Bug class: regex relaxed to /i. Casing matters because the daemon
    // canonicalizes to lowercase before hashing — a mismatched-case id
    // means SOMETHING upstream produced a non-canonical placeholder.
    expect(extractCwdHashes([row("cwd_AABBCC112233")])).toEqual([]);
    expect(extractCwdHashes([row("cwd_AbCdEf123456")])).toEqual([]);
  });

  it("REJECTS non-hex chars (g-z, punctuation)", () => {
    expect(extractCwdHashes([row("cwd_xyz123456789")])).toEqual([]);
    expect(extractCwdHashes([row("cwd_abcdef!23456")])).toEqual([]);
  });

  it("deduplicates identical cwd_<hash> ids", () => {
    // Bug class: multiple events for the same cwd_<hash> create the
    // project multiple times (quota burn). Dedup must happen BEFORE the
    // create loop, not within it (a within-loop check would still cost
    // an extra DB roundtrip per duplicate).
    const rows = [row("cwd_abcdef123456"), row("cwd_abcdef123456"), row("cwd_abcdef123456")];
    expect(extractCwdHashes(rows)).toEqual(["cwd_abcdef123456"]);
  });

  it("returns multiple distinct cwd_<hash> values when present", () => {
    const rows = [row("cwd_abcdef123456"), row("cwd_fedcba987654"), row("cwd_abcdef123456")];
    expect(extractCwdHashes(rows).sort()).toEqual(["cwd_abcdef123456", "cwd_fedcba987654"]);
  });

  it("ignores non-cwd project_ids (uuids, names) entirely", () => {
    const rows = [row("c1234567-1234-1234-1234-123456789012"), row("project_main"), row("cwd_abcdef123456")];
    expect(extractCwdHashes(rows)).toEqual(["cwd_abcdef123456"]);
  });

  it("DEFAULT_CWD_HASH_PATTERN is the exact production regex (pin)", () => {
    // Bug class: someone "fixes" the pattern in one place but not another.
    // Pinning the source value here means changing it forces a test edit
    // and forces the change to be deliberate.
    expect(DEFAULT_CWD_HASH_PATTERN.source).toBe("^cwd_[a-f0-9]{12}$");
    expect(DEFAULT_CWD_HASH_PATTERN.flags).toBe("");
  });
});

describe("applyIdMapping — in-place remapping", () => {
  function row(project_id: string): RowMutable {
    return {
      event_id: "e",
      project_id,
      session_id: "s",
      actor_user_id: "u",
      actor_kind: "human",
      actor_device_id: "d",
      attached_to: null,
      kind: "session_opened",
      occurred_at: "2026-05-30T12:00:00Z",
      received_at: "2026-05-30T12:00:00Z",
      payload: {},
    };
  }

  it("rewrites a row's project_id when a mapping entry exists", () => {
    const rows = [row("cwd_abcdef123456")];
    const mapping = new Map([["cwd_abcdef123456", "proj_real_uuid"]]);
    applyIdMapping(rows, mapping);
    expect(rows[0].project_id).toBe("proj_real_uuid");
  });

  it("leaves rows untouched when their project_id is not in the mapping", () => {
    // Bug class: a stray remap defaults to '' or undefined, silently
    // breaking referential integrity on the next upsert.
    const rows = [row("real_project_uuid")];
    const mapping = new Map([["cwd_abcdef123456", "proj_real_uuid"]]);
    applyIdMapping(rows, mapping);
    expect(rows[0].project_id).toBe("real_project_uuid");
  });

  it("partial mapping: rewrites the matched rows only, leaves the rest alone", () => {
    // Bug class: a forEach that uses the WRONG row variable mutates all
    // rows to the same value. The mixed input pins that the rewrite is
    // per-row, not batch-wide.
    const rows = [row("cwd_abcdef123456"), row("real_project_uuid"), row("cwd_fedcba987654")];
    const mapping = new Map([
      ["cwd_abcdef123456", "proj_a"],
      ["cwd_fedcba987654", "proj_b"],
    ]);
    applyIdMapping(rows, mapping);
    expect(rows.map((r) => r.project_id)).toEqual(["proj_a", "real_project_uuid", "proj_b"]);
  });

  it("empty mapping is a no-op", () => {
    const rows = [row("cwd_abcdef123456"), row("real_project_uuid")];
    applyIdMapping(rows, new Map());
    expect(rows.map((r) => r.project_id)).toEqual(["cwd_abcdef123456", "real_project_uuid"]);
  });

  it("multiple rows with the SAME cwd_<hash> all get remapped (regression: don't stop at first match)", () => {
    // Bug class: implementer uses .find() instead of looping over all
    // rows, leaving the 2nd+ occurrences un-rewritten. The reducer would
    // then see two events for the same logical project under different
    // ids, breaking the project_id grouping.
    const rows = [row("cwd_abcdef123456"), row("cwd_abcdef123456"), row("cwd_abcdef123456")];
    const mapping = new Map([["cwd_abcdef123456", "proj_real"]]);
    applyIdMapping(rows, mapping);
    expect(rows.map((r) => r.project_id)).toEqual(["proj_real", "proj_real", "proj_real"]);
  });
});
