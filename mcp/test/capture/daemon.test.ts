import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHandoffLoop } from "../../src/capture/daemon.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-daemon-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("handoff daemon loop", () => {
  it("touches healthcheck file periodically", async () => {
    const stop = startHandoffLoop({
      projects: ["p1"],
      api_key: "k",
      api_url: "https://api.test",
      pull_ms: 100,
      healthcheck_ms: 100,
      tier_override: "plus",
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(fs.existsSync(path.join(tmp, "daemon.healthcheck"))).toBe(true);
    stop();
  });

  it("processes flush-now signal immediately", async () => {
    global.fetch = vi.fn(async () => new Response('{"accepted":0}', { status: 200 })) as typeof fetch;
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p1/events.jsonl"), `${JSON.stringify(makeEv())}\n`);
    const stop = startHandoffLoop({
      projects: ["p1"],
      api_key: "k",
      api_url: "https://api.test",
      pull_ms: 10000,
      healthcheck_ms: 1000,
      tier_override: "plus",
    });
    fs.writeFileSync(path.join(tmp, "daemon-flush-now"), "");
    await new Promise((r) => setTimeout(r, 200));
    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(0);
    stop();
  });

  // Regression guard: bug class "daemon snapshots projects/ at startup and
  // never re-scans". Manifests as a healthy-looking daemon that does nothing
  // when the typical install flow creates the first project dir AFTER the
  // daemon has launched. The fix makes the cycle re-read projects_dir each
  // iteration; this test would have failed before the fix.
  it("picks up project dirs created after the daemon started (no restart needed)", async () => {
    global.fetch = vi.fn(async () => new Response('{"accepted":1}', { status: 200 })) as typeof fetch;
    const projectsDir = path.join(tmp, "projects");
    fs.mkdirSync(projectsDir, { recursive: true });

    // Daemon starts with projects = [] — typical fresh install state.
    const stop = startHandoffLoop({
      projects: [],
      projects_dir: projectsDir,
      api_key: "k",
      api_url: "https://api.test",
      pull_ms: 10000,
      healthcheck_ms: 1000,
      tier_override: "plus",
    });

    // Wait long enough for at least one cycle to fire on the empty list.
    await new Promise((r) => setTimeout(r, 150));
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(0);

    // Now simulate a hook firing: create a new project dir mid-run.
    fs.mkdirSync(path.join(projectsDir, "late-arrival"), { recursive: true });
    fs.writeFileSync(path.join(projectsDir, "late-arrival/events.jsonl"), `${JSON.stringify(makeEv())}\n`);
    fs.writeFileSync(path.join(tmp, "daemon-flush-now"), ""); // trigger a cycle without waiting for backoff

    await new Promise((r) => setTimeout(r, 250));
    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(0);
    const calls = vi.mocked(global.fetch).mock.calls;
    const flushCall = calls.find((c) => String(c[0]).endsWith("/api/events/batch"));
    expect(flushCall, "expected a /events/batch POST for the late-arrival project").toBeDefined();

    stop();
  });

  // Regression guard: bug class "canonical-id rename collision throws and
  // strands events forever". Happens when the hook re-creates a `cwd_<hash>`
  // dir after a prior cycle has already renamed it to the canonical UUID
  // dir. The fix merges events into the canonical dir + removes the pseudo
  // dir + advances the watermark instead of throwing.
  it("merges into canonical dir when remap destination already exists", async () => {
    const canonicalId = "11111111-1111-1111-1111-111111111111";
    const pseudoId = "cwd_deadbeef";
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ accepted: 1, canonical_project_ids: { [pseudoId]: canonicalId } }), {
        status: 200,
      });
    }) as typeof fetch;

    const projectsDir = path.join(tmp, "projects");
    const pseudoDir = path.join(projectsDir, pseudoId);
    const canonicalDir = path.join(projectsDir, canonicalId);

    // Both dirs exist — pseudo has 1 fresh event, canonical has prior history.
    fs.mkdirSync(pseudoDir, { recursive: true });
    fs.writeFileSync(path.join(pseudoDir, "events.jsonl"), `${JSON.stringify(makeEv("01EVENT_PSEUDO"))}\n`);
    fs.mkdirSync(canonicalDir, { recursive: true });
    fs.writeFileSync(path.join(canonicalDir, "events.jsonl"), `${JSON.stringify(makeEv("01EVENT_CANONICAL"))}\n`);
    fs.writeFileSync(path.join(canonicalDir, ".watermark"), "01EVENT_CANONICAL");

    const stop = startHandoffLoop({
      projects: [pseudoId],
      projects_dir: projectsDir,
      api_key: "k",
      api_url: "https://api.test",
      pull_ms: 10000,
      healthcheck_ms: 1000,
      tier_override: "plus",
    });
    fs.writeFileSync(path.join(tmp, "daemon-flush-now"), "");
    await new Promise((r) => setTimeout(r, 250));

    // Pseudo dir is removed.
    expect(fs.existsSync(pseudoDir), "pseudo dir should be removed after merge").toBe(false);
    // Canonical events.jsonl now contains both events (append, not replace).
    const merged = fs.readFileSync(path.join(canonicalDir, "events.jsonl"), "utf-8");
    expect(merged).toContain("01EVENT_CANONICAL");
    expect(merged).toContain("01EVENT_PSEUDO");
    // Watermark advanced past the new event.
    const wm = fs.readFileSync(path.join(canonicalDir, ".watermark"), "utf-8").trim();
    expect(wm).toBe("01EVENT_PSEUDO"); // PSEUDO > CANONICAL lexicographically (P > C)

    stop();
  });
});

function makeEv(eventId = "01HZA") {
  return {
    event_id: eventId,
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
