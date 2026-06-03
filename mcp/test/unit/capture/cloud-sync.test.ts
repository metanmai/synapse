import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudSyncer } from "../../../src/capture/cloud-sync.js";
import type { CapturedSession } from "../../../src/capture/types.js";

function makeSession(overrides?: Partial<CapturedSession>): CapturedSession {
  return {
    id: "ses_test1234567890",
    tool: "claude-code",
    projectPath: "/home/user/project",
    startedAt: "2026-03-31T10:00:00Z",
    updatedAt: "2026-03-31T10:05:00Z",
    messages: [
      { role: "user", content: "Hello", timestamp: "2026-03-31T10:00:00Z" },
      { role: "assistant", content: "Hi there!", timestamp: "2026-03-31T10:00:01Z" },
    ],
    ...overrides,
  };
}

describe("CloudSyncer", () => {
  const originalEnv = process.env.SYNAPSE_API_KEY;
  const originalSynapseHome = process.env.SYNAPSE_HOME;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-sync-test-"));
    process.env.SYNAPSE_API_KEY = undefined;
    // Redirect ~/.synapse to tmpDir so sync-state persistence doesn't touch
    // the developer's real home directory during tests.
    process.env.SYNAPSE_HOME = tmpDir;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.SYNAPSE_API_KEY = originalEnv;
    } else {
      process.env.SYNAPSE_API_KEY = undefined;
    }
    if (originalSynapseHome) {
      process.env.SYNAPSE_HOME = originalSynapseHome;
    } else {
      process.env.SYNAPSE_HOME = undefined;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("API key discovery", () => {
    it("reads API key from environment variable", () => {
      process.env.SYNAPSE_API_KEY = "env-key-123";
      const syncer = new CloudSyncer();
      expect(syncer.isEnabled()).toBe(true);
    });

    it("reads API key from .mcp.json in cwd", () => {
      const mcpConfig = {
        mcpServers: {
          synapse: {
            command: "npx",
            args: ["synapsesync"],
            env: { SYNAPSE_API_KEY: "mcp-key-456" },
          },
        },
      };

      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".mcp.json"), JSON.stringify(mcpConfig));

      const syncer = new CloudSyncer();
      expect(syncer.isEnabled()).toBe(true);

      cwdSpy.mockRestore();
    });

    it("reads API key from ~/.mcp.json as fallback", () => {
      const mcpConfig = {
        mcpServers: {
          synapse: {
            env: { SYNAPSE_API_KEY: "home-key-789" },
          },
        },
      };

      // Mock cwd to tmpDir (no .mcp.json there)
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

      // Create .mcp.json in a fake home dir
      const fakeHome = path.join(tmpDir, "fakehome");
      fs.mkdirSync(fakeHome);
      fs.writeFileSync(path.join(fakeHome, ".mcp.json"), JSON.stringify(mcpConfig));

      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);

      const syncer = new CloudSyncer();
      expect(syncer.isEnabled()).toBe(true);

      cwdSpy.mockRestore();
      homedirSpy.mockRestore();
    });

    it("disables sync when no API key is found", () => {
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const fakeHome = path.join(tmpDir, "nohome");
      fs.mkdirSync(fakeHome);
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);

      const logs: string[] = [];
      const syncer = new CloudSyncer((msg) => logs.push(msg));
      expect(syncer.isEnabled()).toBe(false);
      expect(logs.some((l) => l.includes("disabled"))).toBe(true);

      cwdSpy.mockRestore();
      homedirSpy.mockRestore();
    });

    // Regression guard for the bug class "hooks fire from project dirs that
    // have no .mcp.json and yet are expected to reach the API." The hook is
    // invoked from arbitrary cwds (random project repos), so .mcp.json / env
    // are unreliable. `~/.synapse/config.json` (written by `synapse init`)
    // is the canonical key location — resolveApiKey must fall through to it.
    it("falls back to ~/.synapse/config.json when no .mcp.json is reachable", () => {
      // Wipe env and point cwd + homedir at dirs without any .mcp.json.
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const fakeHome = path.join(tmpDir, "fakehome");
      fs.mkdirSync(fakeHome);
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
      // tmpDir IS already SYNAPSE_HOME via the outer beforeEach. Place a
      // config.json there as if `synapse init` had written it.
      fs.writeFileSync(path.join(tmpDir, "config.json"), JSON.stringify({ api_key: "config-json-key-xyz" }));

      const syncer = new CloudSyncer();
      expect(syncer.isEnabled()).toBe(true);

      cwdSpy.mockRestore();
      homedirSpy.mockRestore();
    });
  });

  describe("sync", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      process.env.SYNAPSE_API_KEY = "test-key";
      fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("creates conversation and pushes messages on first sync", async () => {
      fetchSpy
        // POST /api/conversations — backend auto-routes via working_context.git_origin_url
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1", project_id: "proj_resolved", project_name: "My Project" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        // POST /api/conversations/:id/messages
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const syncer = new CloudSyncer();
      const session = makeSession();
      const result = await syncer.sync(session);

      expect(result).toBe(true);
      // No projects-list fetch any more — just create + append.
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Verify conversation creation — body has NO project_id; routing is
      // server-side based on working_context.git_origin_url + cwd basename.
      const createCall = fetchSpy.mock.calls[0];
      expect(createCall[0]).toContain("/api/conversations");
      const createBody = JSON.parse(createCall[1]?.body as string);
      expect(createBody.project_id).toBeUndefined();
      expect(createBody.fidelity_mode).toBe("full");
      expect(createBody.working_context.projectPath).toBe("/home/user/project");

      // Verify messages push
      const msgCall = fetchSpy.mock.calls[1];
      expect(msgCall[0]).toContain("/api/conversations/conv_1/messages");
      const msgBody = JSON.parse(msgCall[1]?.body as string);
      expect(msgBody.messages).toHaveLength(2);
      expect(msgBody.messages[0].role).toBe("user");
      expect(msgBody.messages[0].source_agent).toBe("capture-daemon");
    });

    it("appends only new messages on subsequent syncs", async () => {
      fetchSpy
        // First sync: POST conversation, POST messages (no projects-list).
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1", project_id: "proj_1", project_name: "P" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        // Second sync: POST messages (only new ones)
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const syncer = new CloudSyncer();

      // First sync with 2 messages
      const session = makeSession();
      await syncer.sync(session);

      // Second sync with 3 messages (1 new)
      const updatedSession = makeSession({
        messages: [...session.messages, { role: "user", content: "Follow up", timestamp: "2026-03-31T10:01:00Z" }],
      });

      const result = await syncer.sync(updatedSession);
      expect(result).toBe(true);
      // 2 (create + append) for first sync + 1 (append) for second = 3.
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Verify only 1 new message was sent. Total = 2 (first sync) + 1 (append) = 3.
      const lastCall = fetchSpy.mock.calls[2];
      const body = JSON.parse(lastCall[1]?.body as string);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toBe("Follow up");
    });

    it("skips sync when no new messages on subsequent syncs", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1", project_id: "proj_1", project_name: "P" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const syncer = new CloudSyncer();
      const session = makeSession();

      await syncer.sync(session);
      // Same session, no new messages — should NOT call fetch again.
      const result = await syncer.sync(session);

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("returns false when no API key", async () => {
      process.env.SYNAPSE_API_KEY = undefined;
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const fakeHome = path.join(tmpDir, "nohome");
      fs.mkdirSync(fakeHome);
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);

      const syncer = new CloudSyncer();
      const result = await syncer.sync(makeSession());
      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();

      cwdSpy.mockRestore();
      homedirSpy.mockRestore();
    });

    it("handles API errors gracefully", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

      const logs: string[] = [];
      const syncer = new CloudSyncer((msg) => logs.push(msg));
      const result = await syncer.sync(makeSession());

      expect(result).toBe(false);
      expect(logs.some((l) => l.includes("Failed"))).toBe(true);
    });

    it("handles network errors gracefully", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      const logs: string[] = [];
      const syncer = new CloudSyncer((msg) => logs.push(msg));
      const result = await syncer.sync(makeSession());

      expect(result).toBe(false);
    });

    it("includes cwd in working_context matching session projectPath", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1", project_id: "proj_1", project_name: "my-project" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const syncer = new CloudSyncer();
      const session = makeSession({ projectPath: "/home/user/my-project" });
      await syncer.sync(session);

      const createCall = fetchSpy.mock.calls[0];
      const createBody = JSON.parse(createCall[1]?.body as string);
      expect(createBody.working_context.cwd).toBe("/home/user/my-project");
      expect(createBody.working_context.projectPath).toBe("/home/user/my-project");
    });

    // Regression guard: bug class "daemon restart creates duplicate
    // conversations." Before persistence, every CloudSyncer instance started
    // with an empty syncStates Map; the next sync of an existing local
    // session would re-hit POST /api/conversations and create a fresh row on
    // the backend. The persisted sync-state.json file is what keeps the
    // cloudConversationId mapping alive across restarts.
    describe("syncStates persistence (restart-duplication guard)", () => {
      it("does NOT recreate the conversation when a new CloudSyncer restarts and re-syncs", async () => {
        // First instance: POST conv (auto-routed), POST messages.
        fetchSpy
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ id: "conv_persist_1", project_id: "proj_1", project_name: "P" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          )
          .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
          // Second instance: ONLY POST messages (no recreation).
          .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const session = makeSession();
        const first = new CloudSyncer();
        await first.sync(session);

        // Simulate daemon restart by constructing a fresh instance. With
        // persistence, it must read sync-state.json and recognize the session.
        const second = new CloudSyncer();
        const updated = makeSession({
          messages: [
            ...session.messages,
            { role: "user", content: "After restart", timestamp: "2026-03-31T10:02:00Z" },
          ],
        });
        await second.sync(updated);

        // 3 fetches total. A 4th would mean second instance POSTed to
        // /api/conversations again — the regression we're guarding.
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        const allUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
        const conversationPosts = allUrls.filter(
          (u) => u.endsWith("/api/conversations") && !u.includes("/api/conversations/"),
        );
        expect(conversationPosts).toHaveLength(1);

        // Verify the second instance's append went to the SAME cloud id.
        const lastBody = JSON.parse(fetchSpy.mock.calls[2][1]?.body as string);
        expect(lastBody.messages).toHaveLength(1);
        expect(lastBody.messages[0].content).toBe("After restart");
        expect(String(fetchSpy.mock.calls[2][0])).toContain("/api/conversations/conv_persist_1/messages");
      });

      // Regression guard for Fix #4 — bug class "after `synapse reset` (or
      // a dashboard delete), the local sync-state.json + project-map.json
      // still point at the dead cloud conversation, and every subsequent
      // sync silently 404s forever." Fix: 404 on append → wipe cache, fall
      // through to first-sync auto-create.
      it("recovers from 404 by clearing cached state and re-creating the conversation", async () => {
        // Seed sync-state.json as if a previous run completed against a
        // conversation that has since been deleted server-side.
        const seededState = {
          version: 1,
          states: {
            ses_test1234567890: {
              cloudConversationId: "conv_deleted",
              lastSyncedMessageCount: 1, // already synced 1 of the 2 messages
              projectId: "proj_deleted",
              projectName: "DeadProject",
            },
          },
        };
        fs.writeFileSync(path.join(tmpDir, "sync-state.json"), JSON.stringify(seededState));

        fetchSpy
          // 1. POST /api/conversations/conv_deleted/messages → 404 (dead conv)
          .mockResolvedValueOnce(new Response("conv gone", { status: 404 }))
          // 2. Recovery: POST /api/conversations (createConversation, no project_id)
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ id: "conv_fresh", project_id: "proj_fresh", project_name: "FreshProject" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          )
          // 3. POST /api/conversations/conv_fresh/messages
          .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const logs: string[] = [];
        const syncer = new CloudSyncer((m) => logs.push(m));
        // Session has 2 messages, lastSyncedMessageCount was 1 — there's
        // exactly 1 new message to send, so sync() takes the "subsequent"
        // branch which is where the 404 fires.
        const session = makeSession();
        const ok = await syncer.sync(session);

        expect(ok).toBe(true);
        // Three fetches: dead-append, fresh-create, fresh-append.
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        // The first fetch hit the dead conv id (proving we DID try the
        // stale cache once — important to not skip directly to re-create).
        expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/conversations/conv_deleted/messages");
        // The second fetch was the recreation POST (no project_id in body).
        const createBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
        expect("project_id" in createBody).toBe(false);
        // The third fetch went to the FRESH conv id.
        expect(String(fetchSpy.mock.calls[2][0])).toContain("/api/conversations/conv_fresh/messages");
        // A log line should announce the invalidation so the user can see
        // recovery happened (not silent retry).
        expect(logs.some((l) => l.toLowerCase().includes("stale") || l.toLowerCase().includes("404"))).toBe(true);
      });

      // Defense against over-eager invalidation: a transient 5xx must NOT
      // wipe the cache — otherwise a flappy backend would cause endless
      // re-create churn and duplicate conversations on the next recovery.
      it("does NOT clear cache on transient 5xx — only on 404", async () => {
        const seededState = {
          version: 1,
          states: {
            ses_test1234567890: {
              cloudConversationId: "conv_live",
              lastSyncedMessageCount: 1,
              projectId: "proj_live",
              projectName: "Live",
            },
          },
        };
        fs.writeFileSync(path.join(tmpDir, "sync-state.json"), JSON.stringify(seededState));

        fetchSpy.mockResolvedValueOnce(new Response("upstream sad", { status: 503 }));

        const syncer = new CloudSyncer();
        const ok = await syncer.sync(makeSession());

        expect(ok).toBe(false);
        // Only the failed append — no recovery createConversation should fire.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        // sync-state.json should still hold the original mapping.
        const after = JSON.parse(fs.readFileSync(path.join(tmpDir, "sync-state.json"), "utf-8"));
        expect(after.states.ses_test1234567890.cloudConversationId).toBe("conv_live");
      });

      it("starts fresh and does not crash when sync-state.json is corrupt", async () => {
        // Land garbage at the file the next CloudSyncer is about to read.
        fs.writeFileSync(path.join(tmpDir, "sync-state.json"), "{not valid json");

        fetchSpy
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ id: "conv_after_corrupt", project_id: "proj_1", project_name: "P" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          )
          .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const logs: string[] = [];
        const syncer = new CloudSyncer((m) => logs.push(m));
        const ok = await syncer.sync(makeSession());

        expect(ok).toBe(true);
        // A warning should have been logged about the corrupt file.
        expect(logs.some((l) => l.toLowerCase().includes("sync-state.json"))).toBe(true);
      });
    });

    it("maps tool calls to tool_interaction", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1", project_id: "proj_1", project_name: "P" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const syncer = new CloudSyncer();
      const session = makeSession({
        messages: [
          {
            role: "assistant",
            content: "Let me read that file.",
            timestamp: "2026-03-31T10:00:00Z",
            toolCalls: [
              { name: "Read", input: "/path/to/file" },
              { name: "Edit", input: "changes" },
            ],
          },
        ],
      });

      await syncer.sync(session);

      const msgCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(msgCall[1]?.body as string);
      expect(body.messages[0].tool_interaction).toEqual({
        name: "Read",
        summary: "Read + 1 more",
      });
    });

    // Regression guard for the bug class "captured sessions all land in
    // projects[0] regardless of cwd". The fix moved routing to the backend
    // by passing working_context.git_origin_url + cwd basename; the worker
    // must NOT send a project_id, and must respect the project_id returned
    // by the backend (which is the per-cwd resolution).
    it("sends no project_id on create — routing is server-side via working_context", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_routed", project_id: "proj_routed", project_name: "RoutedRepo" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const syncer = new CloudSyncer();
      await syncer.sync(makeSession({ projectPath: "/some/repo" }));

      const createCall = fetchSpy.mock.calls[0];
      const createBody = JSON.parse(createCall[1]?.body as string);
      // Body must NOT carry project_id — that's the whole point.
      expect("project_id" in createBody).toBe(false);
      // But it MUST carry the routing signals the backend needs.
      expect(createBody.working_context.cwd).toBe("/some/repo");
      expect(createBody.working_context.projectPath).toBe("/some/repo");
    });
  });
});
