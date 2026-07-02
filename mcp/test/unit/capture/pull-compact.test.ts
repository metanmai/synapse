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

  // Bug class: cold-start with no known mapping AND backend doesn't know
  // either → return null (caller emits brief without handoff). The bug
  // BEFORE this fix was "skip the backend call entirely and always return
  // null on cold map" — that's why we now expect a resolver fetch.
  it("returns null when project-map is empty AND backend resolver finds no match", async () => {
    // No project-map.json written — simulates a fresh device.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ project_id: null, name: null, confidence: null, signal: "no_match" }), {
        status: 200,
      }),
    );
    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBeNull();
    // We DID call the resolver — that's the whole point of the fix.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/projects/resolve");
  });

  // Regression guard for Fix #6 — bug class "fresh device has no
  // project-map entry, so SessionStart silently emits a brief WITHOUT the
  // handoff even though the backend knows which project this cwd belongs
  // to." Fix: ask the backend's resolver on cold map; proceed if it knows.
  it("pulls handoff via backend resolver when project-map is cold and backend identifies the project", async () => {
    // No project-map.json — simulates a fresh device.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            project_id: PROJECT_UUID,
            name: "synapse",
            confidence: "high",
            signal: "name",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversations: [
              {
                id: "conv_fresh",
                updated_at: "2026-05-24T03:00:00Z",
                metadata: {
                  handoff_markdown: "## from a fresh device",
                  handoff_at: "2026-05-24T03:00:01Z",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBe("## from a fresh device");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/projects/resolve");
    expect(String(fetchSpy.mock.calls[1][0])).toContain(`project_id=${PROJECT_UUID}`);
  });

  // Bug class: backend resolver succeeds on cold start → write-through to
  // project-map so the NEXT session on this device hits the local fast
  // path and doesn't pay the resolver round-trip again.
  it("writes the resolved project to project-map after a successful backend resolve (write-through cache)", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            project_id: PROJECT_UUID,
            name: "synapse",
            confidence: "high",
            signal: "name",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
    await pullHandoff({ cwd: CWD });
    // The next session on this machine MUST find the entry locally.
    const map = JSON.parse(fs.readFileSync(getProjectMapPath(), "utf-8"));
    expect(map[CWD]).toBeDefined();
    expect(map[CWD].project_id).toBe(PROJECT_UUID);
    expect(map[CWD].project_name).toBe("synapse");
  });

  // Bug class: backend resolver itself fails (network down, auth error,
  // 5xx) on cold start → must degrade to null, not hang or throw upward.
  it("returns null when project-map is empty AND backend resolver throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBeNull();
    // The resolver was attempted, but no follow-up calls.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Bug class: backend resolver returns non-2xx on cold start → degrade
  // to null. The resolveProject client converts this into a workspace_fallback
  // internally; pull-compact just sees the null-typed result and bails.
  it("returns null when project-map is empty AND backend resolver returns 5xx", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("internal", { status: 500 }));
    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBeNull();
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

  // Bug class: the most-recently-updated conversation in a project doesn't
  // necessarily hold a handoff. The capture daemon creates a conversation
  // row at session START (before any PreCompact has posted handoff_markdown),
  // and short-lived sessions (claude -p subprocesses, non-claude-code tools
  // without compaction, sessions ended early) leave that row with empty
  // metadata forever. Before this fix, pull-compact looked only at limit=1
  // and returned null when that single newest row had no handoff — even
  // though older conversations in the SAME project held valid handoff text.
  // Real-world symptom: SessionStart hook surfaces a bare STATE.md brief
  // with no `## Last conversation handoff` section, even after a productive
  // prior session compacted and pushed its handoff to the backend.
  it("falls back to an older conversation's handoff when the newest row has no handoff and can't recompute", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversations: [
              // Newest: session-started-but-not-compacted. No handoff_markdown,
              // no handoff_at. Pre-fix this row was the only thing fetched.
              { id: "conv_newest_empty", updated_at: "2026-05-24T05:00:00Z", metadata: {} },
              // Middle: also empty (e.g. another short subprocess).
              { id: "conv_middle_empty", updated_at: "2026-05-24T04:30:00Z", metadata: {} },
              // Older but holds a real, fresh handoff — this is what the
              // SessionStart hook should surface when conv[0] can't recompute.
              {
                id: "conv_older_handoff",
                updated_at: "2026-05-24T04:00:00Z",
                metadata: { handoff_markdown: "## real prior work", handoff_at: "2026-05-24T04:00:01Z" },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      // Recompute path tries conv[0] first: GET full conversation.
      // It has no capturedSessionId so recompute aborts and we fall back
      // to staleFallback (the older conv's cached handoff).
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              id: "conv_newest_empty",
              updated_at: "2026-05-24T05:00:00Z",
              metadata: {},
              working_context: {},
            },
          }),
          { status: 200 },
        ),
      );

    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBe("## real prior work");
  });

  // Critical priority rule: conv[0] is the ACTIVE session. If it has
  // capturedSessionId we MUST attempt recompute against it rather than
  // serve an older cached handoff — the older one is likely from a
  // subprocess or unrelated short session, and serving it surfaces the
  // WRONG "where I left off" to the next agent.
  //
  // Bug class verified 2026-05-24: pull-compact picked subprocess
  // `60028d3b`'s handoff over main session `9a621a5c`'s in-progress
  // work, because the subprocess had a fresh cache and we scanned
  // for "first fresh cache anywhere" instead of prioritizing conv[0].
  it("recomputes conv[0] before returning a cached handoff from older conversations", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });

    const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), "priority-test-"));
    const filePath = path.join(watchDir, "ses_main.jsonl");
    fs.writeFileSync(filePath, "doesn't matter — adapter.parse is stubbed");
    const parsedFor = new Map<string, CapturedSession>([[filePath, session("ses_main")]]);
    const compactFn = vi.fn(async () => ({
      summary: "main session summary",
      handoff: "## active main session work",
      model: "claude-code:local-haiku",
    }));
    const adapter = makeAdapter({ tool: "claude-code", watchDir, parsedFor, compact: compactFn });
    const registry = new AdapterRegistry();
    registry.register(adapter);

    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversations: [
              // Newest: main session, empty handoff but has captured session.
              { id: "conv_main", updated_at: "2026-05-24T05:00:00Z", metadata: {} },
              // Older: short subprocess with FRESH cached handoff. Pre-fix
              // this is what we'd have returned.
              {
                id: "conv_subprocess",
                updated_at: "2026-05-24T04:30:00Z",
                metadata: {
                  handoff_markdown: "## subprocess trivia output",
                  handoff_at: "2026-05-24T04:30:01Z",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      // GET full conv_main → returns capturedSessionId so recompute proceeds.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              id: "conv_main",
              updated_at: "2026-05-24T05:00:00Z",
              metadata: {},
              working_context: { capturedSessionId: "ses_main" },
            },
          }),
          { status: 200 },
        ),
      )
      // POST /compact succeeds.
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await pullHandoff({ cwd: CWD, registry });
    expect(result).toBe("## active main session work");
    expect(compactFn).toHaveBeenCalledTimes(1);

    fs.rmSync(watchDir, { recursive: true, force: true });
  });

  // Companion to the above: when no conversation in the batch has a FRESH
  // cached handoff (everything is either empty or has handoff_at < updated_at),
  // pull-compact should still return the newest stale handoff rather than
  // null. Null would leave SessionStart with a bare brief; a stale handoff
  // is strictly more informative than nothing.
  it("returns the newest stale handoff when no fresh handoff exists and recompute is impossible", async () => {
    writeProjectMap(tmpHome, { [CWD]: { project_id: PROJECT_UUID, project_name: "P" } });
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversations: [
              // Newest: empty.
              { id: "conv_n", updated_at: "2026-05-24T05:00:00Z", metadata: {} },
              // Older: stale handoff (handoff_at < updated_at).
              {
                id: "conv_o",
                updated_at: "2026-05-24T04:30:00Z",
                metadata: { handoff_markdown: "## stale-but-real", handoff_at: "2026-05-24T04:00:00Z" },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      // Full GET on newest (conv_n) returns no capturedSessionId → recompute
      // path can't run → must fall back to staleFallback.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: { id: "conv_n", updated_at: "2026-05-24T05:00:00Z", metadata: {}, working_context: {} },
          }),
          { status: 200 },
        ),
      );

    const result = await pullHandoff({ cwd: CWD });
    expect(result).toBe("## stale-but-real");
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
