import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../../../src/capture/adapter-registry.js";
import { pullHandoff, pullHandoffWithTimeout } from "../../../src/capture/pull-compact.js";
import type { CapturedSession, ToolAdapter } from "../../../src/capture/types.js";
import { getProjectMapPath } from "../../../src/cli/project-map.js";

const CWD = "/some/repo";
const PROJECT_UUID = "proj-uuid-123";

function writeProjectMap(_home: string, entries: Record<string, { project_id: string; project_name: string }>): void {
  // Resolve via the module's helper so the test always agrees with
  // production on where project-map.json lives.
  const file = getProjectMapPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const map: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entries)) {
    map[k] = { ...v, updated_at: new Date().toISOString() };
  }
  fs.writeFileSync(file, JSON.stringify(map));
}

function makeAdapter(opts: {
  tool: string;
  watchDir: string;
  parsedFor: Map<string, CapturedSession>;
  compact?: ToolAdapter["compact"];
}): ToolAdapter {
  return {
    tool: opts.tool,
    watchPaths: () => [opts.watchDir],
    parse: (filePath: string) => opts.parsedFor.get(filePath) ?? null,
    compact: opts.compact,
  };
}

function session(id: string): CapturedSession {
  return {
    id,
    tool: "claude-code",
    projectPath: CWD,
    startedAt: "2026-05-24T03:00:00Z",
    updatedAt: "2026-05-24T03:05:00Z",
    messages: [{ role: "user", content: "hi", timestamp: "2026-05-24T03:00:00Z" }],
  };
}

describe("pullHandoff", () => {
  let tmpHome: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalApiKey = process.env.SYNAPSE_API_KEY;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pull-compact-test-"));
    process.env.SYNAPSE_HOME = tmpHome;
    process.env.SYNAPSE_API_KEY = "test-key";
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fetchSpy.mockRestore();
    process.env.SYNAPSE_HOME = undefined;
    process.env.SYNAPSE_API_KEY = originalApiKey;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns null when there is no project-map entry for the cwd", async () => {
    // No project-map.json written.
    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when there is no API key", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
    process.env.SYNAPSE_API_KEY = undefined;
    // Point process.cwd() at tmpHome (no .mcp.json) so the resolver's
    // cwd-fallback can't find a key from the real synapse repo.
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpHome);
    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    cwdSpy.mockRestore();
  });

  it("returns null when backend returns an empty conversation list", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBeNull();
  });

  it("returns the cached handoff when handoff_at is at or after updated_at (cache hit)", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          conversations: [
            {
              id: "conv_a",
              updated_at: "2026-05-24T03:00:00Z",
              metadata: { handoff_markdown: "## cached", handoff_at: "2026-05-24T03:00:01Z" },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBe("## cached");
    // Should NOT have called the full GET or compact.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("recomputes via adapter.compact() and POSTs the result when handoff is stale", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });

    // Stale list result, then full conversation, then POST /compact.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversations: [
              {
                id: "conv_stale",
                updated_at: "2026-05-24T03:30:00Z",
                metadata: { handoff_markdown: "## stale", handoff_at: "2026-05-24T03:00:00Z" },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              id: "conv_stale",
              updated_at: "2026-05-24T03:30:00Z",
              metadata: { handoff_markdown: "## stale", handoff_at: "2026-05-24T03:00:00Z" },
              working_context: { capturedSessionId: "ses_local_42" },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    // Stub adapter: returns the parsed session only when asked about the matching file.
    const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), "watchdir-"));
    const filePath = path.join(watchDir, "ses_local_42.jsonl");
    fs.writeFileSync(filePath, "irrelevant payload");
    const parsedFor = new Map<string, CapturedSession>([[filePath, session("ses_local_42")]]);

    const compactFn = vi.fn(async () => ({
      summary: "the summary",
      handoff: "## freshly recomputed",
      model: "claude-code:local-haiku",
    }));
    const adapter = makeAdapter({ tool: "claude-code", watchDir, parsedFor, compact: compactFn });

    const registry = new AdapterRegistry();
    registry.register(adapter);

    const result = await pullHandoff({ cwd: CWD, registry });

    expect(compactFn).toHaveBeenCalledTimes(1);
    expect(result).toBe("## freshly recomputed");

    // Last fetch was POST /api/conversations/conv_stale/compact with the new payload.
    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    expect(String(lastCall[0])).toContain("/api/conversations/conv_stale/compact");
    const body = JSON.parse(lastCall[1]?.body as string);
    expect(body.handoff).toBe("## freshly recomputed");
    expect(body.summary).toBe("the summary");

    fs.rmSync(watchDir, { recursive: true, force: true });
  });

  it("falls back to cached handoff when stale but no local session file is found", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });

    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversations: [
              {
                id: "conv_b",
                updated_at: "2026-05-24T03:30:00Z",
                metadata: { handoff_markdown: "## last-known", handoff_at: "2026-05-24T03:00:00Z" },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              id: "conv_b",
              updated_at: "2026-05-24T03:30:00Z",
              metadata: {},
              working_context: { capturedSessionId: "ses_local_nowhere" },
            },
          }),
          { status: 200 },
        ),
      );

    // Empty registry — nothing to find.
    const registry = new AdapterRegistry();
    const result = await pullHandoff({ cwd: CWD, registry });
    expect(result).toBe("## last-known");
  });

  it("falls back to cached handoff when adapter.compact() throws", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });

    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversations: [
              {
                id: "conv_c",
                updated_at: "2026-05-24T03:30:00Z",
                metadata: { handoff_markdown: "## still good", handoff_at: "2026-05-24T03:00:00Z" },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              id: "conv_c",
              updated_at: "2026-05-24T03:30:00Z",
              metadata: {},
              working_context: { capturedSessionId: "ses_throw" },
            },
          }),
          { status: 200 },
        ),
      );

    const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), "watchdir-"));
    const filePath = path.join(watchDir, "ses_throw.jsonl");
    fs.writeFileSync(filePath, "ignored");
    const parsedFor = new Map<string, CapturedSession>([[filePath, session("ses_throw")]]);

    const adapter = makeAdapter({
      tool: "claude-code",
      watchDir,
      parsedFor,
      compact: vi.fn(async () => {
        throw new Error("claude not on PATH");
      }),
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const logs: string[] = [];
    const result = await pullHandoff({ cwd: CWD, registry, log: (m) => logs.push(m) });
    expect(result).toBe("## still good");
    expect(logs.some((l) => l.includes("compact failed"))).toBe(true);

    fs.rmSync(watchDir, { recursive: true, force: true });
  });

  it("returns null when list endpoint returns non-2xx", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await pullHandoff({ cwd: CWD })).toBeNull();
  });

  // Regression guard for Fix #4 — bug class "stale project-map entry
  // points at a project deleted server-side (synapse reset / dashboard
  // delete), and every subsequent SessionStart silently 404s without
  // recovery." Fix: on 404 from list, drop the project-map entry so the
  // NEXT capture-sync from this cwd auto-creates a fresh project.
  it("clears the stale project-map entry when the list endpoint returns 404", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
    // Project was deleted server-side → requireRole throws NotFoundError → 404.
    fetchSpy.mockResolvedValueOnce(new Response("project gone", { status: 404 }));

    const logs: string[] = [];
    const result = await pullHandoff({ cwd: CWD, log: (m) => logs.push(m) });

    expect(result).toBeNull();
    // The stale entry MUST be gone from disk so the next capture-sync
    // from this cwd doesn't keep using the dead UUID.
    const map = JSON.parse(fs.readFileSync(getProjectMapPath(), "utf-8"));
    expect(map[CWD]).toBeUndefined();
    // And the daemon log should announce the invalidation.
    expect(logs.some((l) => l.toLowerCase().includes("invalidated"))).toBe(true);
  });

  // 5xx is transient — must NOT wipe the cache. Otherwise a flappy
  // backend would cause endless re-routing on the next session.
  it("does NOT clear project-map on 5xx (transient) — only on 404", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
    fetchSpy.mockResolvedValueOnce(new Response("upstream sad", { status: 503 }));

    await pullHandoff({ cwd: CWD });

    const map = JSON.parse(fs.readFileSync(getProjectMapPath(), "utf-8"));
    expect(map[CWD]).toBeDefined();
    expect(map[CWD].project_id).toBe(PROJECT_UUID);
  });

  // Regression guard for the bug class "a slow compact() blocks SessionStart
  // for tens of seconds, visibly stalling Claude Code." The wall-clock cap
  // must win over the inner async work, even when fetch hangs forever.
  describe("pullHandoffWithTimeout", () => {
    it("resolves to null within the timeout when pullHandoff hangs", async () => {
      writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
      // Fetch never resolves — pullHandoff is stuck on the first await.
      fetchSpy.mockReturnValueOnce(new Promise<Response>(() => {}));
      const t0 = Date.now();
      const result = await pullHandoffWithTimeout({ cwd: CWD }, 100);
      const elapsed = Date.now() - t0;
      expect(result).toBeNull();
      // Generous upper bound so we don't get flake under load — what matters
      // is that we didn't wait the full 30-60s a compact() would take.
      expect(elapsed).toBeLessThan(1000);
    });

    it("returns the pullHandoff result when it resolves before the timeout", async () => {
      writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversations: [
              {
                id: "conv_fast",
                updated_at: "2026-05-24T03:00:00Z",
                metadata: { handoff_markdown: "## quick", handoff_at: "2026-05-24T03:00:01Z" },
              },
            ],
          }),
          { status: 200 },
        ),
      );
      // 5s budget; the cache-hit path is single-fetch, sub-ms in test.
      const result = await pullHandoffWithTimeout({ cwd: CWD }, 5_000);
      expect(result).toBe("## quick");
    });

    it("returns null without throwing when pullHandoff rejects", async () => {
      writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
      // pullHandoff catches fetch errors internally, but if anything else
      // were to throw the wrapper still has to absorb it.
      fetchSpy.mockImplementationOnce(() => {
        throw new Error("synchronous boom");
      });
      const result = await pullHandoffWithTimeout({ cwd: CWD }, 1_000);
      expect(result).toBeNull();
    });
  });
});
