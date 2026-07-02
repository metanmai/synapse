import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFlushCycle } from "../../src/capture/handoff-sync.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-sync-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("runFlushCycle", () => {
  it("posts unflushed events and updates watermark", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "projects/p1/events.jsonl"),
      `${[makeEv("01HZA"), makeEv("01HZB")].map((e) => JSON.stringify(e)).join("\n")}\n`,
    );

    const calls: Array<{ url: string; body: { events: unknown[] } }> = [];
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ accepted: 2, duplicates: 0 }), { status: 200 });
    }) as typeof fetch;

    const result = await runFlushCycle({ project_id: "p1", api_key: "k", api_url: "https://api.test" });
    expect(result.flushed).toBe(2);
    expect(calls[0].body.events).toHaveLength(2);

    const wm = fs.readFileSync(path.join(tmp, "projects/p1/.watermark"), "utf-8").trim();
    expect(wm).toBe("01HZB");
  });

  it("does not re-flush events already past the watermark", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p1/events.jsonl"), `${JSON.stringify(makeEv("01HZA"))}\n`);
    fs.writeFileSync(path.join(tmp, "projects/p1/.watermark"), "01HZA");
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;
    const result = await runFlushCycle({ project_id: "p1", api_key: "k", api_url: "https://api.test" });
    expect(result.flushed).toBe(0);
  });
});

function makeEv(id: string) {
  return {
    event_id: id,
    project_id: "p1",
    session_id: "s",
    actor: { user_id: "u", kind: "human" as const, device_id: "d", hostname: "h", client: "claude-code" },
    attached_to: null,
    kind: "session_opened" as const,
    occurred_at: "2026-05-11T09:00:00Z",
    received_at: "2026-05-11T09:00:01Z",
    payload: {},
  };
}

// Phase 2 (IDENT-02, D-08): runEagerPullCycle pulls historical events from the backend
// on a fresh machine-B install and writes them to events.jsonl with a `_pulled: true`
// marker. The marker is the explicit guard against Pitfall 4 from RESEARCH (watermark
// advanced past unflushed local events) — runFlushCycle filters _pulled events out of
// its outbound POST body so they don't ping-pong back to the backend.
//
// runEagerPullCycle itself does not exist yet; .skip cases below document the contract.
// runFlushCycle's _pulled filter is testable today as a RED contract (passes after
// Plan 02-04 lands).

describe("runFlushCycle — _pulled marker filtering (Phase 2 IDENT-02, D-08)", () => {
  it("filters _pulled: true events out of the outbound POST body", async () => {
    // RED until Plan 02-04: today's runFlushCycle has no _pulled awareness.
    // It will POST both events, so this test fails (calls.length expects only local events).
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    const localEv = makeEv("01HZA");
    const pulledEv = { ...makeEv("01HZB"), _pulled: true };
    fs.writeFileSync(
      path.join(tmp, "projects/p1/events.jsonl"),
      `${[localEv, pulledEv].map((e) => JSON.stringify(e)).join("\n")}\n`,
    );

    const calls: Array<{ body: { events: unknown[] } }> = [];
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), { status: 200 });
    }) as typeof fetch;

    const result = await runFlushCycle({ project_id: "p1", api_key: "k", api_url: "https://api.test" });

    // Contract: only the locally-captured event (no _pulled marker) is flushed.
    // The _pulled event came from the backend originally and must not be sent back.
    expect(result.flushed).toBe(1);
    expect(calls[0].body.events).toHaveLength(1);
    // Per feedback_test_generality.md: assert on event identity (event_id) not on
    // _pulled-flag-absence-in-body (the planner may strip the flag before POST).
    expect((calls[0].body.events[0] as { event_id: string }).event_id).toBe("01HZA");
  });

  it("locally-captured events flush normally even when _pulled events are also present (regression)", async () => {
    // RED until Plan 02-04: confirms the filter doesn't accidentally drop local events.
    fs.mkdirSync(path.join(tmp, "projects/p2"), { recursive: true });
    const localA = makeEv("01HZA");
    const localB = makeEv("01HZB");
    const pulled = { ...makeEv("01HZC"), _pulled: true };
    fs.writeFileSync(
      path.join(tmp, "projects/p2/events.jsonl"),
      `${[localA, localB, pulled].map((e) => JSON.stringify(e)).join("\n")}\n`,
    );

    global.fetch = vi.fn(async () => new Response(JSON.stringify({ accepted: 2 }), { status: 200 })) as typeof fetch;
    const result = await runFlushCycle({ project_id: "p2", api_key: "k", api_url: "https://api.test" });

    // Two local events flush; the pulled event does not.
    expect(result.flushed).toBe(2);
  });
});

describe("runEagerPullCycle — Phase 2 IDENT-02, D-08 (skipped until Plan 02-04 ships)", () => {
  // These .skip cases describe the contract runEagerPullCycle must satisfy. The executor
  // of Plan 02-04 Task 4 ("eager-pull cycle") flips them to active when the function lands.
  //
  // The function signature (per RESEARCH §Pattern 6): runEagerPullCycle({ project_id, api_key, api_url })
  // returns { pulled: number, watermark: string | null }.

  it.skip("pulls events from GET /api/projects/:id/events, writes them with _pulled: true marker, advances watermark", () => {
    // Mock fetch to return {events: [ev1, ev2], next_since: ev2.event_id}.
    // Assert:
    //   - events.jsonl appended with both events, each carrying _pulled: true
    //   - .watermark file updated to ev2.event_id
    //   - returned { pulled: 2, watermark: ev2.event_id }
  });

  it.skip("empty pull ({events: []}) is a no-op — no file mutation, returns { pulled: 0 }", () => {
    // Mock fetch returns {events: [], next_since: null}.
    // Assert: events.jsonl unchanged; .watermark unchanged; returned { pulled: 0 }.
  });

  it.skip("5xx response throws cleanly (does not swallow into a half-pull)", () => {
    // Mock fetch returns 503.
    // Assert: runEagerPullCycle rejects with an Error containing the status.
  });
});
