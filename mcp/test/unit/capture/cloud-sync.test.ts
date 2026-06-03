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
        // GET /api/projects
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: "proj_1", name: "My Project" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        // POST /api/conversations
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1" }), {
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
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Verify conversation creation
      const createCall = fetchSpy.mock.calls[1];
      expect(createCall[0]).toContain("/api/conversations");
      const createBody = JSON.parse(createCall[1]?.body as string);
      expect(createBody.project_id).toBe("proj_1");
      expect(createBody.fidelity_mode).toBe("full");

      // Verify messages push
      const msgCall = fetchSpy.mock.calls[2];
      expect(msgCall[0]).toContain("/api/conversations/conv_1/messages");
      const msgBody = JSON.parse(msgCall[1]?.body as string);
      expect(msgBody.messages).toHaveLength(2);
      expect(msgBody.messages[0].role).toBe("user");
      expect(msgBody.messages[0].source_agent).toBe("capture-daemon");
    });

    it("appends only new messages on subsequent syncs", async () => {
      fetchSpy
        // First sync: GET projects, POST conversation, POST messages
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: "proj_1", name: "P" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1" }), {
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
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      // Verify only 1 new message was sent
      const lastCall = fetchSpy.mock.calls[3];
      const body = JSON.parse(lastCall[1]?.body as string);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toBe("Follow up");
    });

    it("skips sync when no new messages on subsequent syncs", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: "proj_1", name: "P" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const syncer = new CloudSyncer();
      const session = makeSession();

      await syncer.sync(session);
      // Same session, no new messages
      const result = await syncer.sync(session);

      expect(result).toBe(true);
      // Should NOT have made a 4th fetch call
      expect(fetchSpy).toHaveBeenCalledTimes(3);
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
          new Response(JSON.stringify([{ id: "proj_1", name: "P" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const syncer = new CloudSyncer();
      const session = makeSession({ projectPath: "/home/user/my-project" });
      await syncer.sync(session);

      const createCall = fetchSpy.mock.calls[1];
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
        // First instance: full first-sync sequence (GET projects, POST conv, POST messages).
        fetchSpy
          .mockResolvedValueOnce(
            new Response(JSON.stringify([{ id: "proj_1", name: "P" }]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          )
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ id: "conv_persist_1" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          )
          .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
          // Second instance: only GET projects + POST messages (NO conv create).
          .mockResolvedValueOnce(
            new Response(JSON.stringify([{ id: "proj_1", name: "P" }]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          )
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

        // 5 fetches total, NOT 6. A 6th call would mean second instance
        // POSTed to /api/conversations again — the regression we're guarding.
        expect(fetchSpy).toHaveBeenCalledTimes(5);
        const allUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
        const conversationPosts = allUrls.filter(
          (u) => u.endsWith("/api/conversations") && !u.includes("/api/conversations/"),
        );
        expect(conversationPosts).toHaveLength(1);

        // Verify the second instance's append went to the SAME cloud id.
        const lastBody = JSON.parse(fetchSpy.mock.calls[4][1]?.body as string);
        expect(lastBody.messages).toHaveLength(1);
        expect(lastBody.messages[0].content).toBe("After restart");
        expect(String(fetchSpy.mock.calls[4][0])).toContain("/api/conversations/conv_persist_1/messages");
      });

      it("starts fresh and does not crash when sync-state.json is corrupt", async () => {
        // Land garbage at the file the next CloudSyncer is about to read.
        fs.writeFileSync(path.join(tmpDir, "sync-state.json"), "{not valid json");

        fetchSpy
          .mockResolvedValueOnce(
            new Response(JSON.stringify([{ id: "proj_1", name: "P" }]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          )
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ id: "conv_after_corrupt" }), {
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
          new Response(JSON.stringify([{ id: "proj_1", name: "P" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "conv_1" }), {
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

      const msgCall = fetchSpy.mock.calls[2];
      const body = JSON.parse(msgCall[1]?.body as string);
      expect(body.messages[0].tool_interaction).toEqual({
        name: "Read",
        summary: "Read + 1 more",
      });
    });
  });
});
