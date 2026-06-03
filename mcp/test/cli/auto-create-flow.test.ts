import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFlushCycle } from "../../src/capture/handoff-sync.js";

// Verifies the daemon side of v1.1 Task 6: when the backend returns a
// canonical_project_ids map for our cwd_<hash> placeholder, runFlushCycle
// must rename the local ~/.synapse/projects/<cwd_hash> dir to <canonical-uuid>
// and surface the new id to its caller.

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-autocreate-"));
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: env var cleanup
  delete process.env.SYNAPSE_HOME;
});

function makeEv(id: string, project_id: string) {
  return {
    event_id: id,
    project_id,
    session_id: "s",
    actor: { user_id: "u", kind: "human" as const, device_id: "d", hostname: "h", client: "claude-code" },
    attached_to: null,
    kind: "session_opened" as const,
    occurred_at: "2026-05-14T09:00:00Z",
    received_at: "2026-05-14T09:00:01Z",
    payload: { git_basename: "test-repo" },
  };
}

describe("runFlushCycle — auto-create remap", () => {
  it("renames the project dir when canonical_project_ids returns a uuid", async () => {
    const cwdHash = "cwd_abcdef123456";
    const canonical = "11111111-2222-3333-4444-555555555555";
    fs.mkdirSync(path.join(tmp, "projects", cwdHash), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "projects", cwdHash, "events.jsonl"),
      `${JSON.stringify(makeEv("01HZA", cwdHash))}\n`,
    );

    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accepted: 1,
            duplicates: 0,
            canonical_project_ids: { [cwdHash]: canonical },
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const result = await runFlushCycle({ project_id: cwdHash, api_key: "k", api_url: "https://api.test" });
    expect(result.flushed).toBe(1);
    expect(result.canonical_project_id).toBe(canonical);
    expect(fs.existsSync(path.join(tmp, "projects", cwdHash))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "projects", canonical))).toBe(true);
    const wm = fs.readFileSync(path.join(tmp, "projects", canonical, ".watermark"), "utf-8").trim();
    expect(wm).toBe("01HZA");
  });

  // Updated 2026-05-24: previously this test expected the cycle to throw
  // when the canonical destination already existed. That behavior stranded
  // events forever because the hook keeps re-creating `cwd_<hash>/` dirs
  // each session before the project-map catches up. The handler now MERGES
  // the pseudo dir's events into the canonical events.jsonl, advances the
  // watermark (never regressing it), and removes the pseudo dir.
  it("merges into the canonical directory when it already exists (no throw)", async () => {
    const cwdHash = "cwd_abcdef123456";
    const canonical = "11111111-2222-3333-4444-555555555555";
    fs.mkdirSync(path.join(tmp, "projects", cwdHash), { recursive: true });
    fs.mkdirSync(path.join(tmp, "projects", canonical), { recursive: true });

    // Pseudo: 1 new event.
    fs.writeFileSync(
      path.join(tmp, "projects", cwdHash, "events.jsonl"),
      `${JSON.stringify(makeEv("01PSEUDO_EV", cwdHash))}\n`,
    );
    // Canonical: prior history + watermark.
    fs.writeFileSync(
      path.join(tmp, "projects", canonical, "events.jsonl"),
      `${JSON.stringify(makeEv("01CANONICAL_EV", canonical))}\n`,
    );
    fs.writeFileSync(path.join(tmp, "projects", canonical, ".watermark"), "01CANONICAL_EV");

    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ accepted: 1, duplicates: 0, canonical_project_ids: { [cwdHash]: canonical } }), {
          status: 200,
        }),
    ) as typeof fetch;

    const result = await runFlushCycle({ project_id: cwdHash, api_key: "k", api_url: "https://api.test" });

    expect(result.flushed).toBe(1);
    expect(result.canonical_project_id).toBe(canonical);
    // Pseudo dir removed.
    expect(fs.existsSync(path.join(tmp, "projects", cwdHash))).toBe(false);
    // Canonical dir contains both events (append, not replace).
    const merged = fs.readFileSync(path.join(tmp, "projects", canonical, "events.jsonl"), "utf-8");
    expect(merged).toContain("01PSEUDO_EV");
    expect(merged).toContain("01CANONICAL_EV");
    // Watermark advanced past the pseudo event.
    const wm = fs.readFileSync(path.join(tmp, "projects", canonical, ".watermark"), "utf-8").trim();
    expect(wm).toBe("01PSEUDO_EV"); // PSEUDO > CANONICAL lexicographically (P > C)
  });

  it("leaves project_id alone when backend does not return canonical_project_ids", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p1/events.jsonl"), `${JSON.stringify(makeEv("01HZA", "p1"))}\n`);

    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), { status: 200 }),
    ) as typeof fetch;

    const result = await runFlushCycle({ project_id: "p1", api_key: "k", api_url: "https://api.test" });
    expect(result.canonical_project_id).toBeUndefined();
    expect(fs.existsSync(path.join(tmp, "projects/p1"))).toBe(true);
  });
});
