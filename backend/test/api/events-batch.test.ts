// POST /api/events/batch — auth + body-validation + accept/duplicate contracts.
//
// Three data-path contracts (in addition to the auth gate):
//   - 400 when `events` array is missing
//   - 400 when `events` array is empty
//   - 200 with `{ accepted, duplicates, adjusted, canonical_project_ids }` counts
//
// Implemented as real route invocations against a mocked Supabase client
// (see test/helpers/supabase-mock.ts). The pure helpers (validateEventsBatchBody,
// prepareEventRows, etc.) are exhaustively unit-tested in events-batch-pure.test.ts.

import { vi } from "vitest";
import { __mockState__ } from "../helpers/supabase-mock";

vi.mock("../../src/db/client", () => ({
  createSupabaseClient: () => __mockState__.db?.client,
}));

import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/index";
import {
  bearer,
  makeContractTestEnv,
  makeMockSupabase,
  resetMockState,
  seedApiKeyAuth,
  setMockDb,
} from "../helpers/supabase-mock";
import { createExecutionContext, waitOnExecutionContext } from "../setup";

describe("POST /api/events/batch — auth enforcement", () => {
  it("returns 401 without a bearer token", async () => {
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [] }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 with malformed bearer token", async () => {
    const db = makeMockSupabase();
    setMockDb(db);
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-token" },
      body: JSON.stringify({ events: [] }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/events/batch — input validation (mocked Supabase)", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("returns 400 when `events` key is missing from body", async () => {
    // Bug class: a misbehaving daemon (or scripted client) sends `{}` and
    // the handler crashes on .map of undefined. validateEventsBatchBody
    // MUST 400 BEFORE the prepareEventRows iteration — the gate prevents
    // the crash AND keeps the response shape stable.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    setMockDb(db);

    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: bearer("k"),
      body: JSON.stringify({}), // no events key
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
  });

  it("returns 400 when `events` array is empty", async () => {
    // Bug class: empty batches still hit the upsert and burn a DB roundtrip
    // (and the recompute fan-out). 400 short-circuits the no-op so the
    // daemon never spends server time on it.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    setMockDb(db);

    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: bearer("k"),
      body: JSON.stringify({ events: [] }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
  });

  it("returns 200 with accepted/duplicates/adjusted counts for a valid batch", async () => {
    // Contract: response body has the four required keys
    // `{ accepted, duplicates, adjusted, canonical_project_ids }`. Daemon's
    // capture loop reads these to learn:
    //   - accepted: how many events the server stored
    //   - duplicates: how many were already there (idempotent retry)
    //   - adjusted: which event_ids had occurred_at clamped (skew signal)
    //   - canonical_project_ids: cwd_<hash> → real UUID remap (none here)
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    // handoff_events.upsert returns { count: <accepted> }. With 2 events
    // sent and count=2, accepted=2, duplicates=0.
    db.tables.handoff_events = {
      upsert: () => ({ data: null, error: null, count: 2 }),
      // recomputeProjectStatus reads handoff_events to fold the delta —
      // empty arrays are fine for the count contract.
      select: () => ({ data: [], error: null }),
    };
    // handoff_project_status: no prior row → recompute fast-path skipped,
    // full recompute runs (also harmless with empty events).
    db.tables.handoff_project_status = {
      maybeSingle: () => ({ data: null, error: null }),
      upsert: () => ({ data: null, error: null }),
    };
    setMockDb(db);

    const realUuid = "11111111-2222-3333-4444-555555555555";
    const body = {
      events: [
        {
          event_id: "evt_001",
          project_id: realUuid,
          session_id: "s",
          actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
          attached_to: null,
          kind: "session_opened",
          occurred_at: "2026-05-14T09:00:00Z",
          payload: {},
        },
        {
          event_id: "evt_002",
          project_id: realUuid,
          session_id: "s",
          actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
          attached_to: null,
          kind: "session_closed",
          occurred_at: "2026-05-14T09:05:00Z",
          payload: {},
        },
      ],
    };

    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: bearer("k"),
      body: JSON.stringify(body),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      accepted: number;
      duplicates: number;
      adjusted: string[];
      canonical_project_ids: Record<string, string>;
    };
    expect(out.accepted).toBe(2);
    expect(out.duplicates).toBe(0);
    expect(Array.isArray(out.adjusted)).toBe(true);
    // No cwd_<hash> placeholder in the batch → empty mapping.
    expect(out.canonical_project_ids).toEqual({});
  });
});
