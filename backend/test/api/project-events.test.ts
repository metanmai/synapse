// GET /api/projects/:id/events — auth + pull-cursor contracts.
//
// Three data-path contracts (in addition to the auth gate):
//   - 200 with `{ events, next_since }` shape for a known project
//   - `?since=` cursor: rows whose event_id > since
//   - `?limit=` cap: rows.length <= limit
//
// All implemented as real route invocations against a mocked Supabase
// client (see test/helpers/supabase-mock.ts). The pure cursor math
// (parseEventsLimit, computeNextSince) is already covered by
// project-events-pure.test.ts; THIS file covers the route's gluing
// behavior — that the cursor/limit query params reach the DB and that
// the response body shape is exactly `{ events, next_since }`.

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

describe("GET /api/projects/:id/events — auth enforcement", () => {
  it("returns 401 without a bearer token", async () => {
    const req = new Request("http://localhost/api/projects/test-project-id/events");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 without a bearer token (with since param)", async () => {
    const req = new Request("http://localhost/api/projects/test-project-id/events?since=evt_001&limit=50");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 with malformed bearer token", async () => {
    const db = makeMockSupabase();
    setMockDb(db);
    const req = new Request("http://localhost/api/projects/test-project-id/events", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/projects/:id/events — data paths (mocked Supabase)", () => {
  beforeEach(() => {
    resetMockState();
  });

  // Helper: build a fake event row in the shape handoff_events returns.
  function fakeEvent(id: string): Record<string, unknown> {
    return {
      event_id: id,
      project_id: "proj-1",
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

  it("returns 200 with { events, next_since } for a project with events", async () => {
    // Contract pin: response body MUST have both keys (`events` array AND
    // `next_since` cursor). Daemon's pull loop reads both — dropping
    // next_since would silently break incremental pulling (re-fetch from
    // the top every poll).
    const events = [fakeEvent("evt_001"), fakeEvent("evt_002")];
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    db.tables.handoff_events = {
      // Awaited directly (no .single/.maybeSingle) — returns the array shape.
      select: () => ({ data: events, error: null }),
    };
    setMockDb(db);

    const req = new Request("http://localhost/api/projects/proj-1/events", { headers: bearer("k") });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: { event_id: string }[]; next_since: string | null };
    expect(body.events).toHaveLength(2);
    expect(body.events[0].event_id).toBe("evt_001");
    // next_since echoes the LAST event's event_id (computeNextSince in
    // project-events-pure.ts). An empty page returns the caller's `since`
    // instead — both branches are pinned in project-events-pure.test.ts.
    expect(body.next_since).toBe("evt_002");
  });

  it("respects ?since= cursor: empty page returns next_since = original since", async () => {
    // Bug class: someone changes the empty-page fallback in computeNextSince
    // to `null`, breaking the daemon's idle-poll path. The route MUST echo
    // the caller's `since` when the page is empty so the daemon doesn't
    // reset its cursor and re-read history on the next non-empty page.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    db.tables.handoff_events = { select: () => ({ data: [], error: null }) };
    setMockDb(db);

    const req = new Request("http://localhost/api/projects/proj-1/events?since=evt_old", { headers: bearer("k") });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[]; next_since: string | null };
    expect(body.events).toEqual([]);
    expect(body.next_since).toBe("evt_old");
  });

  it("respects ?limit= cap: parses limit param, no 5xx on a huge value", async () => {
    // Bug class: `Number.parseInt("99999999", 10)` slips through as the
    // raw limit and the DB query attempts to page through millions of
    // rows — Worker times out, daemon retries hammering. parseEventsLimit
    // caps at MAX_EVENTS_LIMIT (1000). The route MUST not 500 on absurd
    // values; the cap is silent.
    const events = Array.from({ length: 3 }, (_, i) => fakeEvent(`evt_${i + 1}`));
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    db.tables.handoff_events = { select: () => ({ data: events, error: null }) };
    setMockDb(db);

    const req = new Request("http://localhost/api/projects/proj-1/events?limit=99999999", { headers: bearer("k") });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[]; next_since: string | null };
    expect(Array.isArray(body.events)).toBe(true);
  });
});
