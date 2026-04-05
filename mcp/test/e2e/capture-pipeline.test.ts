/**
 * End-to-end tests for the full capture pipeline.
 *
 * Covers: CLI lifecycle, adapter parsing (Claude Code, Cursor, Codex, Gemini),
 * session store CRUD, validation, safe-read, watcher dedup, event queue dedup,
 * health tracking, daemon PID management, and parse error tracking.
 *
 * Run:  TEST_E2E=1 npx vitest run test/e2e/capture-pipeline.test.ts
 *
 * Without TEST_E2E=1 the suite is skipped.
 */
import child_process from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdapterRegistry } from "../../src/capture/adapter-registry.js";
import { ClaudeCodeAdapter } from "../../src/capture/adapters/claude-code.js";
import { ClineAdapter } from "../../src/capture/adapters/cline.js";
import { CodexAdapter } from "../../src/capture/adapters/codex.js";
import { CopilotCliAdapter } from "../../src/capture/adapters/copilot-cli.js";
import { CursorAdapter } from "../../src/capture/adapters/cursor.js";
import { GeminiAdapter } from "../../src/capture/adapters/gemini.js";
import { RooCodeAdapter } from "../../src/capture/adapters/roo-code.js";
import { CloudSyncer } from "../../src/capture/cloud-sync.js";
import { DaemonManager } from "../../src/capture/daemon.js";
import { safeReadFile } from "../../src/capture/safe-read.js";
import { SessionStore } from "../../src/capture/store.js";
import { type CapturedSession, sessionIdFromNative, validateSession } from "../../src/capture/types.js";
import { CaptureWatcher } from "../../src/capture/watcher.js";

/* ------------------------------------------------------------------ */
/*  Test gating                                                       */
/* ------------------------------------------------------------------ */

const RUN = process.env.TEST_E2E === "1";
const suite = RUN ? describe : describe.skip;

const BIN = path.resolve(__dirname, "../../dist/index.js");

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Strip ANSI escape codes from terminal output. */
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching control chars
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Run `node dist/index.js capture <args>` with custom HOME. */
function runCaptureCli(home: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const proc = child_process.spawn("node", [BIN, "capture", ...args], {
      env: { ...process.env, HOME: home, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      resolve({ stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), code });
    });
  });
}

/** Polling helper — waits until `predicate` returns true. */
async function waitFor(predicate: () => boolean, timeoutMs = 15000, intervalMs = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/* ------------------------------------------------------------------ */
/*  Fixture data                                                      */
/* ------------------------------------------------------------------ */

const CLAUDE_CODE_JSONL = [
  '{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"fix the bug"},"uuid":"u1","timestamp":"2026-04-02T10:00:00Z","cwd":"/tmp/proj","sessionId":"aaaa-bbbb-cccc-dddd"}',
  '{"parentUuid":"u1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Looking at the code."}]},"uuid":"a1","timestamp":"2026-04-02T10:00:01Z","sessionId":"aaaa-bbbb-cccc-dddd"}',
  '{"parentUuid":"a1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"src/main.ts"}}]},"uuid":"a2","timestamp":"2026-04-02T10:00:02Z","sessionId":"aaaa-bbbb-cccc-dddd"}',
  '{"parentUuid":"a2","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"file contents"}]},"uuid":"u2","timestamp":"2026-04-02T10:00:03Z","sessionId":"aaaa-bbbb-cccc-dddd"}',
  '{"parentUuid":"u2","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Fixed it."}]},"uuid":"a3","timestamp":"2026-04-02T10:00:04Z","sessionId":"aaaa-bbbb-cccc-dddd"}',
  '{"parentUuid":"a3","isSidechain":true,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"sidechain msg"}]},"uuid":"s1","timestamp":"2026-04-02T10:00:05Z","sessionId":"aaaa-bbbb-cccc-dddd"}',
  "INVALID JSON LINE HERE {{{",
].join("\n");

const CURSOR_JSON = JSON.stringify({
  version: 3,
  requests: [
    {
      requestId: "r1",
      message: { text: "explain auth" },
      response: [{ value: "Auth uses JWT." }],
      timestamp: 1743588000000,
    },
    {
      requestId: "r2",
      message: { text: "refactor it" },
      response: [{ value: "Refactored to cookies." }],
      timestamp: 1743588060000,
    },
    {
      requestId: "r3",
      message: { text: "test it" },
      response: [],
      timestamp: 1743588120000,
    },
  ],
  sessionId: "eeee-ffff-1111-2222",
  creationDate: 1743588000000,
  lastMessageDate: 1743588120000,
});

const CODEX_JSONL = [
  '{"type":"metadata","timestamp":"2026-04-02T10:00:00Z","session_id":"3333-4444-5555-6666","cwd":"/tmp/codex-proj"}',
  '{"type":"message","timestamp":"2026-04-02T10:00:01Z","role":"user","content":"add auth","session_id":"3333-4444-5555-6666"}',
  '{"type":"tool_call","timestamp":"2026-04-02T10:00:02Z","name":"shell","input":"cat src/auth.ts","output":"export const auth = {};","session_id":"3333-4444-5555-6666"}',
  '{"type":"message","timestamp":"2026-04-02T10:00:03Z","role":"assistant","content":"Added auth middleware.","session_id":"3333-4444-5555-6666"}',
  "NOT VALID JSON",
].join("\n");

const GEMINI_JSON = JSON.stringify({
  id: "7777-8888-9999-0000",
  messages: [
    {
      id: "g1",
      role: "user",
      content: [{ type: "text", text: "create migration" }],
      timestamp: "2026-04-02T10:00:00Z",
    },
    {
      id: "g2",
      role: "model",
      content: [
        { type: "text", text: "Created migration." },
        { type: "tool_use", toolName: "code_execution", input: { code: "CREATE TABLE" }, output: { result: "done" } },
      ],
      timestamp: "2026-04-02T10:00:10Z",
    },
    {
      id: "g3",
      role: "user",
      content: [{ type: "text", text: "add constraint" }],
      timestamp: "2026-04-02T10:01:00Z",
    },
    {
      id: "g4",
      role: "model",
      content: [{ type: "text", text: "Added constraint." }],
      timestamp: "2026-04-02T10:01:10Z",
    },
  ],
  createdAt: "2026-04-02T10:00:00Z",
  updatedAt: "2026-04-02T10:01:10Z",
});

const CLINE_JSON = JSON.stringify([
  {
    role: "user",
    content: [{ type: "text", text: "add rate limiting to the API" }],
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "I'll add rate limiting middleware." },
      { type: "tool_use", id: "toolu_01", name: "read_file", input: { path: "src/server.ts" } },
    ],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "const app = express();" }],
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Added rate limiter with 100 req/15min window." },
      {
        type: "tool_use",
        id: "toolu_02",
        name: "write_to_file",
        input: { path: "src/middleware/rate-limit.ts", content: "..." },
      },
    ],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_02", content: "File written." }],
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "Rate limiting is now active." }],
  },
]);

const ROO_CODE_JSON = JSON.stringify([
  {
    role: "user",
    content: [{ type: "text", text: "implement search endpoint" }],
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "I'll create the search endpoint." },
      { type: "tool_use", id: "toolu_10", name: "read_file", input: { path: "src/routes.ts" } },
    ],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_10", content: "const router = express.Router();" }],
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "Search endpoint is live at GET /api/search." }],
  },
]);

const COPILOT_CLI_JSONL = [
  '{"type":"session.start","data":{"cwd":"/tmp/copilot-proj","model":"gpt-4o"},"id":"ev1","timestamp":"2026-04-02T10:00:00Z","parentId":null}',
  '{"type":"user.message","data":{"content":"set up CI pipeline"},"id":"ev2","timestamp":"2026-04-02T10:00:01Z","parentId":"ev1"}',
  '{"type":"assistant.turn_start","data":{},"id":"ev3","timestamp":"2026-04-02T10:00:02Z","parentId":"ev2"}',
  '{"type":"tool.execution_start","data":{"toolCallId":"tc1","name":"read_file","input":{"path":".github/workflows"}},"id":"ev4","timestamp":"2026-04-02T10:00:03Z","parentId":"ev3"}',
  '{"type":"tool.execution_complete","data":{"toolCallId":"tc1","name":"read_file","output":"directory listing"},"id":"ev5","timestamp":"2026-04-02T10:00:04Z","parentId":"ev4"}',
  '{"type":"assistant.message","data":{"content":"I\'ll create a GitHub Actions workflow for CI."},"id":"ev6","timestamp":"2026-04-02T10:00:05Z","parentId":"ev5"}',
  '{"type":"user.message","data":{"content":"add test step too"},"id":"ev7","timestamp":"2026-04-02T10:00:10Z","parentId":"ev6"}',
  '{"type":"assistant.message","data":{"content":"Added test step with npm test."},"id":"ev8","timestamp":"2026-04-02T10:00:11Z","parentId":"ev7"}',
  '{"type":"assistant.turn_end","data":{},"id":"ev9","timestamp":"2026-04-02T10:00:12Z","parentId":"ev8"}',
  "CORRUPT LINE \u2028 WITH UNICODE",
].join("\n");

/* ------------------------------------------------------------------ */
/*  1. CLI Lifecycle                                                  */
/* ------------------------------------------------------------------ */

suite("Capture Pipeline E2E", () => {
  let tmpHome: string;

  function freshHome(): string {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-e2e-"));
    return tmpHome;
  }

  beforeAll(() => {
    expect(fs.existsSync(BIN)).toBe(true);
  });

  afterAll(() => {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("CLI Lifecycle", () => {
    beforeEach(() => {
      freshHome();
    });

    it("capture status when no daemon running shows not running", async () => {
      const { stdout } = await runCaptureCli(tmpHome, ["status"]);
      expect(stdout).toContain("stopped");
      expect(stdout).toContain("0 captured");
    });

    it("capture start starts a daemon and prints PID", async () => {
      const { stdout } = await runCaptureCli(tmpHome, ["start"]);
      expect(stdout).toContain("Daemon started");
      expect(stdout).toMatch(/PID \d+/);

      // Clean up daemon
      await runCaptureCli(tmpHome, ["stop"]);
    });

    it("capture start again prints already running", async () => {
      await runCaptureCli(tmpHome, ["start"]);
      const { stdout } = await runCaptureCli(tmpHome, ["start"]);
      expect(stdout).toContain("already running");

      await runCaptureCli(tmpHome, ["stop"]);
    });

    it("capture status while daemon running shows Running with PID", async () => {
      await runCaptureCli(tmpHome, ["start"]);
      const { stdout } = await runCaptureCli(tmpHome, ["status"]);
      expect(stdout).toContain("running");
      expect(stdout).toMatch(/PID \d+/);

      await runCaptureCli(tmpHome, ["stop"]);
    });

    it("capture stop stops daemon and prints confirmation", async () => {
      await runCaptureCli(tmpHome, ["start"]);
      const { stdout } = await runCaptureCli(tmpHome, ["stop"]);
      expect(stdout).toContain("Daemon stopped");
    });

    it("capture stop when not running prints not running", async () => {
      const { stdout } = await runCaptureCli(tmpHome, ["stop"]);
      expect(stdout).toContain("not running");
    });

    it("capture list with no sessions shows empty message", async () => {
      const { stdout } = await runCaptureCli(tmpHome, ["list"]);
      expect(stdout).toContain("No captured sessions yet");
    });

    it("capture with no subcommand prints usage", async () => {
      const { stdout } = await runCaptureCli(tmpHome, []);
      expect(stdout).toContain("start");
      expect(stdout).toContain("stop");
      expect(stdout).toContain("status");
      expect(stdout).toContain("list");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  2. Full Pipeline: File Change -> Session Captured                 */
  /* ------------------------------------------------------------------ */

  describe("Full Pipeline: file change to session captured", () => {
    let pipelineTmp: string;

    beforeEach(() => {
      pipelineTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-pipe-"));
    });

    afterEach(() => {
      fs.rmSync(pipelineTmp, { recursive: true, force: true });
    });

    it("Claude Code: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "claude-projects");
      fs.mkdirSync(watchDir, { recursive: true });
      const storeDir = path.join(pipelineTmp, "sessions");

      // Create a custom adapter pointing to our temp dir
      const adapter = new ClaudeCodeAdapter();
      adapter.watchPaths = () => [watchDir];

      const registry = new AdapterRegistry();
      registry.register(adapter);
      const store = new SessionStore(storeDir);

      const watcher = new CaptureWatcher(registry, 300);
      const sessions: CapturedSession[] = [];
      watcher.on("session", (s: CapturedSession) => {
        sessions.push(s);
        store.save(s);
      });

      await watcher.start();

      // Write the file
      const sessionFile = path.join(watchDir, "session.jsonl");
      fs.writeFileSync(sessionFile, CLAUDE_CODE_JSONL);

      await waitFor(() => sessions.length > 0);
      await watcher.stop();

      expect(sessions.length).toBe(1);
      const s = sessions[0];
      expect(s.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(s.tool).toBe("claude-code");
      expect(s.projectPath).toBe("/tmp/proj");
      expect(s.messages.length).toBeGreaterThan(0);
      expect(s.startedAt).toBeTruthy();
      expect(s.updatedAt).toBeTruthy();

      // Verify stored
      const stored = store.load(s.id);
      expect(stored).not.toBeNull();
      expect(stored?.id).toBe(s.id);
    });

    it("Cursor: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "cursor-workspace");
      fs.mkdirSync(watchDir, { recursive: true });
      const storeDir = path.join(pipelineTmp, "sessions");

      const adapter = new CursorAdapter();
      adapter.watchPaths = () => [watchDir];

      const registry = new AdapterRegistry();
      registry.register(adapter);
      const store = new SessionStore(storeDir);

      const watcher = new CaptureWatcher(registry, 300);
      const sessions: CapturedSession[] = [];
      watcher.on("session", (s: CapturedSession) => {
        sessions.push(s);
        store.save(s);
      });

      await watcher.start();

      const sessionFile = path.join(watchDir, "chat.json");
      fs.writeFileSync(sessionFile, CURSOR_JSON);

      await waitFor(() => sessions.length > 0);
      await watcher.stop();

      expect(sessions.length).toBe(1);
      const s = sessions[0];
      expect(s.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(s.tool).toBe("cursor");
      expect(s.messages.length).toBeGreaterThan(0);
    });

    it("Codex: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "codex-sessions");
      fs.mkdirSync(watchDir, { recursive: true });
      const storeDir = path.join(pipelineTmp, "sessions");

      const adapter = new CodexAdapter();
      adapter.watchPaths = () => [watchDir];

      const registry = new AdapterRegistry();
      registry.register(adapter);
      const store = new SessionStore(storeDir);

      const watcher = new CaptureWatcher(registry, 300);
      const sessions: CapturedSession[] = [];
      watcher.on("session", (s: CapturedSession) => {
        sessions.push(s);
        store.save(s);
      });

      await watcher.start();

      const sessionFile = path.join(watchDir, "codex-session.jsonl");
      fs.writeFileSync(sessionFile, CODEX_JSONL);

      await waitFor(() => sessions.length > 0);
      await watcher.stop();

      expect(sessions.length).toBe(1);
      const s = sessions[0];
      expect(s.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(s.tool).toBe("codex");
      expect(s.projectPath).toBe("/tmp/codex-proj");
    });

    it("Gemini: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "gemini-tmp");
      fs.mkdirSync(watchDir, { recursive: true });
      const storeDir = path.join(pipelineTmp, "sessions");

      const adapter = new GeminiAdapter();
      adapter.watchPaths = () => [watchDir];

      const registry = new AdapterRegistry();
      registry.register(adapter);
      const store = new SessionStore(storeDir);

      const watcher = new CaptureWatcher(registry, 300);
      const sessions: CapturedSession[] = [];
      watcher.on("session", (s: CapturedSession) => {
        sessions.push(s);
        store.save(s);
      });

      await watcher.start();

      const sessionFile = path.join(watchDir, "gemini-chat.json");
      fs.writeFileSync(sessionFile, GEMINI_JSON);

      await waitFor(() => sessions.length > 0);
      await watcher.stop();

      expect(sessions.length).toBe(1);
      const s = sessions[0];
      expect(s.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(s.tool).toBe("gemini");
    });

    it("Cline: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "cline-tasks");
      fs.mkdirSync(watchDir, { recursive: true });
      const storeDir = path.join(pipelineTmp, "sessions");

      const adapter = new ClineAdapter();
      adapter.watchPaths = () => [watchDir];

      const registry = new AdapterRegistry();
      registry.register(adapter);
      const store = new SessionStore(storeDir);

      const watcher = new CaptureWatcher(registry, 300);
      const sessions: CapturedSession[] = [];
      watcher.on("session", (s: CapturedSession) => {
        sessions.push(s);
        store.save(s);
      });

      await watcher.start();

      const taskDir = path.join(watchDir, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      fs.mkdirSync(taskDir, { recursive: true });
      const sessionFile = path.join(taskDir, "api_conversation_history.json");
      fs.writeFileSync(sessionFile, CLINE_JSON);

      await waitFor(() => sessions.length > 0);
      await watcher.stop();

      expect(sessions.length).toBe(1);
      const s = sessions[0];
      expect(s.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(s.tool).toBe("cline");
      expect(s.messages.length).toBeGreaterThan(0);

      const stored = store.load(s.id);
      expect(stored).not.toBeNull();
      expect(stored?.id).toBe(s.id);
    });

    it("Roo Code: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "roo-code-tasks");
      fs.mkdirSync(watchDir, { recursive: true });
      const storeDir = path.join(pipelineTmp, "sessions");

      const adapter = new RooCodeAdapter();
      adapter.watchPaths = () => [watchDir];

      const registry = new AdapterRegistry();
      registry.register(adapter);
      const store = new SessionStore(storeDir);

      const watcher = new CaptureWatcher(registry, 300);
      const sessions: CapturedSession[] = [];
      watcher.on("session", (s: CapturedSession) => {
        sessions.push(s);
        store.save(s);
      });

      await watcher.start();

      const taskDir = path.join(watchDir, "b2c3d4e5-f6a7-8901-bcde-f12345678901");
      fs.mkdirSync(taskDir, { recursive: true });
      const sessionFile = path.join(taskDir, "api_conversation_history.json");
      fs.writeFileSync(sessionFile, ROO_CODE_JSON);

      await waitFor(() => sessions.length > 0);
      await watcher.stop();

      expect(sessions.length).toBe(1);
      const s = sessions[0];
      expect(s.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(s.tool).toBe("roo-code");
      expect(s.messages.length).toBeGreaterThan(0);

      const stored = store.load(s.id);
      expect(stored).not.toBeNull();
      expect(stored?.id).toBe(s.id);
    });

    it("Copilot CLI: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "copilot-sessions");
      fs.mkdirSync(watchDir, { recursive: true });
      const storeDir = path.join(pipelineTmp, "sessions");

      const adapter = new CopilotCliAdapter();
      adapter.watchPaths = () => [watchDir];

      const registry = new AdapterRegistry();
      registry.register(adapter);
      const store = new SessionStore(storeDir);

      const watcher = new CaptureWatcher(registry, 300);
      const sessions: CapturedSession[] = [];
      watcher.on("session", (s: CapturedSession) => {
        sessions.push(s);
        store.save(s);
      });

      await watcher.start();

      const sessionDir = path.join(watchDir, "abc12300-deed-face-1234");
      fs.mkdirSync(sessionDir, { recursive: true });
      const sessionFile = path.join(sessionDir, "events.jsonl");
      fs.writeFileSync(sessionFile, COPILOT_CLI_JSONL);

      await waitFor(() => sessions.length > 0);
      await watcher.stop();

      expect(sessions.length).toBe(1);
      const s = sessions[0];
      expect(s.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(s.tool).toBe("copilot-cli");
      expect(s.projectPath).toBe("/tmp/copilot-proj");
      expect(s.messages.length).toBeGreaterThan(0);

      const stored = store.load(s.id);
      expect(stored).not.toBeNull();
      expect(stored?.id).toBe(s.id);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  3. Claude Code Adapter E2E                                        */
  /* ------------------------------------------------------------------ */

  describe("Claude Code Adapter E2E", () => {
    let adapterTmp: string;

    beforeEach(() => {
      adapterTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-claude-"));
    });

    afterEach(() => {
      fs.rmSync(adapterTmp, { recursive: true, force: true });
    });

    it("parses JSONL with correct message count, filters sidechain and tool_result", () => {
      const filePath = path.join(adapterTmp, "session.jsonl");
      fs.writeFileSync(filePath, CLAUDE_CODE_JSONL);

      const adapter = new ClaudeCodeAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      // Input lines: user "fix the bug", assistant "Looking at the code.",
      // assistant tool_use (Read), user tool_result (FILTERED), assistant "Fixed it.",
      // sidechain (FILTERED), invalid JSON (parse error)
      // Expected messages: user, assistant(text), assistant(tool_use), assistant(text) = 4
      expect(session?.messages.length).toBe(4);

      // First message is user
      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("fix the bug");

      // Second message is assistant text
      expect(session?.messages[1].role).toBe("assistant");
      expect(session?.messages[1].content).toBe("Looking at the code.");

      // Third message is assistant with tool call
      expect(session?.messages[2].role).toBe("assistant");
      expect(session?.messages[2].toolCalls).toBeDefined();
      expect(session?.messages[2].toolCalls?.length).toBe(1);
      expect(session?.messages[2].toolCalls?.[0].name).toBe("Read");

      // Fourth message is assistant text
      expect(session?.messages[3].role).toBe("assistant");
      expect(session?.messages[3].content).toBe("Fixed it.");

      // Session ID is deterministic
      expect(session?.id).toBe(sessionIdFromNative("aaaa-bbbb-cccc-dddd"));
      expect(session?.id).toMatch(/^ses_[0-9a-f]{16}$/);

      // Project path from cwd
      expect(session?.projectPath).toBe("/tmp/proj");

      // Parse errors from the invalid line
      expect(session?.parseErrors).toBeDefined();
      expect(session?.parseErrors?.length).toBe(1);
      expect(session?.parseErrors?.[0]).toContain("Line 7");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  4. Cursor Adapter E2E                                             */
  /* ------------------------------------------------------------------ */

  describe("Cursor Adapter E2E", () => {
    let adapterTmp: string;

    beforeEach(() => {
      adapterTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-cursor-"));
    });

    afterEach(() => {
      fs.rmSync(adapterTmp, { recursive: true, force: true });
    });

    it("parses JSON with correct message count and alternating roles", () => {
      const filePath = path.join(adapterTmp, "chat.json");
      fs.writeFileSync(filePath, CURSOR_JSON);

      const adapter = new CursorAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      // 3 requests: r1 has user+assistant, r2 has user+assistant, r3 has user only (empty response)
      // = 5 messages total
      expect(session?.messages.length).toBe(5);

      // Check alternating pattern for first 4
      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("explain auth");
      expect(session?.messages[1].role).toBe("assistant");
      expect(session?.messages[1].content).toBe("Auth uses JWT.");
      expect(session?.messages[2].role).toBe("user");
      expect(session?.messages[2].content).toBe("refactor it");
      expect(session?.messages[3].role).toBe("assistant");
      expect(session?.messages[3].content).toBe("Refactored to cookies.");

      // r3 has user only (empty response array)
      expect(session?.messages[4].role).toBe("user");
      expect(session?.messages[4].content).toBe("test it");

      // Session ID
      expect(session?.id).toBe(sessionIdFromNative("eeee-ffff-1111-2222"));
      expect(session?.tool).toBe("cursor");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  5. Codex Adapter E2E                                              */
  /* ------------------------------------------------------------------ */

  describe("Codex Adapter E2E", () => {
    let adapterTmp: string;

    beforeEach(() => {
      adapterTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-codex-"));
    });

    afterEach(() => {
      fs.rmSync(adapterTmp, { recursive: true, force: true });
    });

    it("parses JSONL with tool calls attached to next assistant message", () => {
      const filePath = path.join(adapterTmp, "session.jsonl");
      fs.writeFileSync(filePath, CODEX_JSONL);

      const adapter = new CodexAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      // metadata (skipped as message), user message, tool_call (buffered), assistant message
      // = 2 messages: user + assistant
      expect(session?.messages.length).toBe(2);

      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("add auth");

      expect(session?.messages[1].role).toBe("assistant");
      expect(session?.messages[1].content).toBe("Added auth middleware.");

      // Tool call attached to assistant message
      expect(session?.messages[1].toolCalls).toBeDefined();
      expect(session?.messages[1].toolCalls?.length).toBe(1);
      expect(session?.messages[1].toolCalls?.[0].name).toBe("shell");
      expect(session?.messages[1].toolCalls?.[0].input).toBe("cat src/auth.ts");
      expect(session?.messages[1].toolCalls?.[0].output).toBe("export const auth = {};");

      // Metadata extracted (cwd -> projectPath)
      expect(session?.projectPath).toBe("/tmp/codex-proj");
      expect(session?.id).toBe(sessionIdFromNative("3333-4444-5555-6666"));

      // Parse errors from the invalid line
      expect(session?.parseErrors).toBeDefined();
      expect(session?.parseErrors?.length).toBe(1);
      expect(session?.parseErrors?.[0]).toContain("Line 5");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  6. Gemini Adapter E2E                                             */
  /* ------------------------------------------------------------------ */

  describe("Gemini Adapter E2E", () => {
    let adapterTmp: string;

    beforeEach(() => {
      adapterTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-gemini-"));
    });

    afterEach(() => {
      fs.rmSync(adapterTmp, { recursive: true, force: true });
    });

    it("parses JSON with model mapped to assistant and tool calls extracted", () => {
      const filePath = path.join(adapterTmp, "chat.json");
      fs.writeFileSync(filePath, GEMINI_JSON);

      const adapter = new GeminiAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      // 4 messages: user, model(assistant), user, model(assistant)
      expect(session?.messages.length).toBe(4);

      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("create migration");

      // "model" mapped to "assistant"
      expect(session?.messages[1].role).toBe("assistant");
      expect(session?.messages[1].content).toBe("Created migration.");

      // Tool calls on message g2
      expect(session?.messages[1].toolCalls).toBeDefined();
      expect(session?.messages[1].toolCalls?.length).toBe(1);
      expect(session?.messages[1].toolCalls?.[0].name).toBe("code_execution");

      expect(session?.messages[2].role).toBe("user");
      expect(session?.messages[2].content).toBe("add constraint");

      expect(session?.messages[3].role).toBe("assistant");
      expect(session?.messages[3].content).toBe("Added constraint.");
      expect(session?.messages[3].toolCalls).toBeUndefined();

      expect(session?.id).toBe(sessionIdFromNative("7777-8888-9999-0000"));
      expect(session?.tool).toBe("gemini");
      expect(session?.startedAt).toBe("2026-04-02T10:00:00Z");
      expect(session?.updatedAt).toBe("2026-04-02T10:01:10Z");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  7. Cline Adapter E2E                                              */
  /* ------------------------------------------------------------------ */

  describe("Cline Adapter E2E", () => {
    let adapterTmp: string;

    beforeEach(() => {
      adapterTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-cline-"));
    });

    afterEach(() => {
      fs.rmSync(adapterTmp, { recursive: true, force: true });
    });

    it("parses Anthropic Messages API format with tool calls and tool_result filtering", () => {
      const taskDir = path.join(adapterTmp, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      fs.mkdirSync(taskDir, { recursive: true });
      const filePath = path.join(taskDir, "api_conversation_history.json");
      fs.writeFileSync(filePath, CLINE_JSON);

      const adapter = new ClineAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      expect(session?.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(session?.tool).toBe("cline");

      // 6 raw messages: user, assistant(text+tool_use), user(tool_result FILTERED),
      // assistant(text+tool_use), user(tool_result FILTERED), assistant(text)
      // = 4 messages: 1 user + 3 assistant
      expect(session?.messages.length).toBe(4);

      // First message is user
      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("add rate limiting to the API");

      // Second message is assistant with tool call
      expect(session?.messages[1].role).toBe("assistant");
      expect(session?.messages[1].toolCalls).toBeDefined();
      expect(session?.messages[1].toolCalls?.length).toBe(1);
      expect(session?.messages[1].toolCalls?.[0].name).toBe("read_file");
    });

    it("returns null for non-JSON files", () => {
      const taskDir = path.join(adapterTmp, "some-task-id");
      fs.mkdirSync(taskDir, { recursive: true });
      const filePath = path.join(taskDir, "api_conversation_history.jsonl");
      fs.writeFileSync(filePath, "some content");

      const adapter = new ClineAdapter();
      expect(adapter.parse(filePath)).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      const taskDir = path.join(adapterTmp, "some-task-id");
      fs.mkdirSync(taskDir, { recursive: true });
      const filePath = path.join(taskDir, "api_conversation_history.json");
      fs.writeFileSync(filePath, "{not an array}");

      const adapter = new ClineAdapter();
      expect(adapter.parse(filePath)).toBeNull();
    });

    it("returns null for empty message array", () => {
      const taskDir = path.join(adapterTmp, "some-task-id");
      fs.mkdirSync(taskDir, { recursive: true });
      const filePath = path.join(taskDir, "api_conversation_history.json");
      fs.writeFileSync(filePath, "[]");

      const adapter = new ClineAdapter();
      expect(adapter.parse(filePath)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  8. Roo Code Adapter E2E                                           */
  /* ------------------------------------------------------------------ */

  describe("Roo Code Adapter E2E", () => {
    let adapterTmp: string;

    beforeEach(() => {
      adapterTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-roo-"));
    });

    afterEach(() => {
      fs.rmSync(adapterTmp, { recursive: true, force: true });
    });

    it("parses Anthropic Messages API format with tool_result filtering", () => {
      const taskDir = path.join(adapterTmp, "b2c3d4e5-f6a7-8901-bcde-f12345678901");
      fs.mkdirSync(taskDir, { recursive: true });
      const filePath = path.join(taskDir, "api_conversation_history.json");
      fs.writeFileSync(filePath, ROO_CODE_JSON);

      const adapter = new RooCodeAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      expect(session?.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(session?.tool).toBe("roo-code");

      // 4 raw messages: user, assistant(text+tool_use), user(tool_result FILTERED),
      // assistant(text)
      // = 3 messages: 1 user + 2 assistant
      expect(session?.messages.length).toBe(3);

      // First message is user
      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("implement search endpoint");

      // Second message is assistant with tool call
      expect(session?.messages[1].role).toBe("assistant");
      expect(session?.messages[1].content).toBe("I'll create the search endpoint.");
      expect(session?.messages[1].toolCalls).toBeDefined();
      expect(session?.messages[1].toolCalls?.length).toBe(1);
      expect(session?.messages[1].toolCalls?.[0].name).toBe("read_file");

      // Third message is assistant text
      expect(session?.messages[2].role).toBe("assistant");
      expect(session?.messages[2].content).toBe("Search endpoint is live at GET /api/search.");
    });

    it("ignores Roo-specific extra fields without errors", () => {
      const taskDir = path.join(adapterTmp, "c3d4e5f6-a7b8-9012-cdef-123456789012");
      fs.mkdirSync(taskDir, { recursive: true });
      const filePath = path.join(taskDir, "api_conversation_history.json");

      const rooSpecificData = JSON.stringify([
        {
          role: "user",
          content: [{ type: "text", text: "refactor auth module" }],
          apiProtocol: "anthropic",
          isProtected: true,
          condenseParent: "parent-id-123",
          isSummary: false,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "I'll refactor the auth module." }],
          apiProtocol: "anthropic",
          isProtected: false,
          condenseParent: null,
          isSummary: true,
        },
      ]);

      fs.writeFileSync(filePath, rooSpecificData);

      const adapter = new RooCodeAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      expect(session?.messages.length).toBe(2);
      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("refactor auth module");
      expect(session?.messages[1].role).toBe("assistant");
      expect(session?.messages[1].content).toBe("I'll refactor the auth module.");
    });

    it("returns null for non-JSON files", () => {
      const taskDir = path.join(adapterTmp, "some-task-id");
      fs.mkdirSync(taskDir, { recursive: true });
      const filePath = path.join(taskDir, "api_conversation_history.jsonl");
      fs.writeFileSync(filePath, "some content");

      const adapter = new RooCodeAdapter();
      expect(adapter.parse(filePath)).toBeNull();
    });

    it("returns null for empty conversation", () => {
      const taskDir = path.join(adapterTmp, "some-task-id");
      fs.mkdirSync(taskDir, { recursive: true });
      const filePath = path.join(taskDir, "api_conversation_history.json");
      fs.writeFileSync(filePath, "[]");

      const adapter = new RooCodeAdapter();
      expect(adapter.parse(filePath)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  9. Copilot CLI Adapter E2E                                        */
  /* ------------------------------------------------------------------ */

  describe("Copilot CLI Adapter E2E", () => {
    let adapterTmp: string;

    beforeEach(() => {
      adapterTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-copilot-"));
    });

    afterEach(() => {
      fs.rmSync(adapterTmp, { recursive: true, force: true });
    });

    it("parses JSONL events into user/assistant messages with tool calls", () => {
      const sessionDir = path.join(adapterTmp, "abc12300-deed-face-1234");
      fs.mkdirSync(sessionDir, { recursive: true });
      const filePath = path.join(sessionDir, "events.jsonl");
      fs.writeFileSync(filePath, COPILOT_CLI_JSONL);

      const adapter = new CopilotCliAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      expect(session?.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(session?.tool).toBe("copilot-cli");
      expect(session?.projectPath).toBe("/tmp/copilot-proj");

      // 4 messages: user.message("set up CI pipeline"), assistant.message(with tool calls),
      // user.message("add test step too"), assistant.message("Added test step...")
      expect(session?.messages.length).toBe(4);

      // First message is user
      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("set up CI pipeline");

      // Second message is assistant with tool calls
      expect(session?.messages[1].role).toBe("assistant");
      expect(session?.messages[1].toolCalls).toBeDefined();
      expect(session?.messages[1].toolCalls?.some((tc) => tc.name === "read_file")).toBe(true);

      // Third message is user
      expect(session?.messages[2].role).toBe("user");

      // Fourth message is assistant
      expect(session?.messages[3].role).toBe("assistant");

      expect(session?.startedAt).toBe("2026-04-02T10:00:00Z");
      expect(session?.updatedAt).toBe("2026-04-02T10:00:12Z");
    });

    it("handles U+2028/U+2029 Unicode sanitization", () => {
      const sessionDir = path.join(adapterTmp, "unicode-session");
      fs.mkdirSync(sessionDir, { recursive: true });
      const filePath = path.join(sessionDir, "events.jsonl");

      const unicodeLines = [
        '{"type":"session.start","data":{"cwd":"/tmp/proj"},"id":"ev1","timestamp":"2026-04-02T10:00:00Z","parentId":null}',
        '{"type":"user.message","data":{"content":"hello \u2028 world \u2029 test"},"id":"ev2","timestamp":"2026-04-02T10:00:01Z","parentId":"ev1"}',
        '{"type":"assistant.message","data":{"content":"response \u2028 here"},"id":"ev3","timestamp":"2026-04-02T10:00:02Z","parentId":"ev2"}',
      ].join("\n");

      fs.writeFileSync(filePath, unicodeLines);

      const adapter = new CopilotCliAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      expect(session?.messages.length).toBe(2);
      expect(session?.parseErrors).toBeUndefined();
    });

    it("tracks parse errors for corrupt JSONL lines", () => {
      const sessionDir = path.join(adapterTmp, "corrupt-session");
      fs.mkdirSync(sessionDir, { recursive: true });
      const filePath = path.join(sessionDir, "events.jsonl");
      fs.writeFileSync(filePath, COPILOT_CLI_JSONL);

      const adapter = new CopilotCliAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      expect(session?.parseErrors).toBeDefined();
      expect(session?.parseErrors?.length).toBe(1);
      expect(session?.parseErrors?.[0]).toMatch(/Line 10/);
    });

    it("returns null for non-JSONL files", () => {
      const sessionDir = path.join(adapterTmp, "json-session");
      fs.mkdirSync(sessionDir, { recursive: true });
      const filePath = path.join(sessionDir, "events.json");
      fs.writeFileSync(filePath, '{"type":"session.start"}');

      const adapter = new CopilotCliAdapter();
      expect(adapter.parse(filePath)).toBeNull();
    });

    it("returns null when no user or assistant messages exist", () => {
      const sessionDir = path.join(adapterTmp, "empty-session");
      fs.mkdirSync(sessionDir, { recursive: true });
      const filePath = path.join(sessionDir, "events.jsonl");

      const noMessagesLines = [
        '{"type":"session.start","data":{"cwd":"/tmp/proj","model":"gpt-4o"},"id":"ev1","timestamp":"2026-04-02T10:00:00Z","parentId":null}',
        '{"type":"session.info","data":{"version":"1.0"},"id":"ev2","timestamp":"2026-04-02T10:00:01Z","parentId":"ev1"}',
      ].join("\n");

      fs.writeFileSync(filePath, noMessagesLines);

      const adapter = new CopilotCliAdapter();
      expect(adapter.parse(filePath)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  10. Safe Read                                                     */
  /* ------------------------------------------------------------------ */

  describe("Safe Read", () => {
    let safeTmp: string;

    beforeEach(() => {
      safeTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-safe-"));
    });

    afterEach(() => {
      fs.rmSync(safeTmp, { recursive: true, force: true });
    });

    it("rejects symlinks and returns null", () => {
      const realFile = path.join(safeTmp, "real.txt");
      fs.writeFileSync(realFile, "content");
      const symlink = path.join(safeTmp, "link.txt");
      fs.symlinkSync(realFile, symlink);

      const result = safeReadFile(symlink);
      expect(result).toBeNull();
    });

    it("reads normal files successfully via copy-on-read", () => {
      const filePath = path.join(safeTmp, "normal.txt");
      const content = "hello world test content";
      fs.writeFileSync(filePath, content);

      const result = safeReadFile(filePath);
      expect(result).toBe(content);
    });

    it("returns null for non-existent files", () => {
      const result = safeReadFile(path.join(safeTmp, "does-not-exist.txt"));
      expect(result).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  8. Parse Error Tracking (JSONL adapters)                          */
  /* ------------------------------------------------------------------ */

  describe("Parse Error Tracking", () => {
    let errorTmp: string;

    beforeEach(() => {
      errorTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-err-"));
    });

    afterEach(() => {
      fs.rmSync(errorTmp, { recursive: true, force: true });
    });

    it("Claude Code adapter tracks parse errors for corrupt lines", () => {
      const lines = [
        '{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"hello"},"uuid":"u1","timestamp":"2026-04-02T10:00:00Z","cwd":"/tmp/p","sessionId":"aaaa-bbbb-cccc-dddd"}',
        "THIS IS NOT JSON",
        '{"parentUuid":"u1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]},"uuid":"a1","timestamp":"2026-04-02T10:00:01Z","sessionId":"aaaa-bbbb-cccc-dddd"}',
        "{broken json",
      ].join("\n");

      const filePath = path.join(errorTmp, "session.jsonl");
      fs.writeFileSync(filePath, lines);

      const adapter = new ClaudeCodeAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      expect(session?.messages.length).toBe(2); // valid user + assistant
      expect(session?.parseErrors).toBeDefined();
      expect(session?.parseErrors?.length).toBe(2); // two bad lines
      expect(session?.parseErrors?.[0]).toContain("Line 2");
      expect(session?.parseErrors?.[1]).toContain("Line 4");
    });

    it("Codex adapter tracks parse errors for corrupt lines", () => {
      const lines = [
        '{"type":"metadata","timestamp":"2026-04-02T10:00:00Z","session_id":"abcd-1234-5678-9999","cwd":"/tmp/p"}',
        "CORRUPT LINE",
        '{"type":"message","timestamp":"2026-04-02T10:00:01Z","role":"user","content":"hi","session_id":"abcd-1234-5678-9999"}',
        '{"type":"message","timestamp":"2026-04-02T10:00:02Z","role":"assistant","content":"hello","session_id":"abcd-1234-5678-9999"}',
      ].join("\n");

      const filePath = path.join(errorTmp, "session.jsonl");
      fs.writeFileSync(filePath, lines);

      const adapter = new CodexAdapter();
      const session = adapter.parse(filePath);

      expect(session).not.toBeNull();
      expect(session?.messages.length).toBe(2);
      expect(session?.parseErrors).toBeDefined();
      expect(session?.parseErrors?.length).toBe(1);
      expect(session?.parseErrors?.[0]).toContain("Line 2");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  9. Deduplication (mtime + size)                                   */
  /* ------------------------------------------------------------------ */

  describe("Deduplication (mtime + size)", () => {
    let dedupTmp: string;

    beforeEach(() => {
      dedupTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-dedup-"));
    });

    afterEach(() => {
      fs.rmSync(dedupTmp, { recursive: true, force: true });
    });

    it("emits on first write, skips if unchanged, emits again on content change", async () => {
      const watchDir = path.join(dedupTmp, "watch");
      fs.mkdirSync(watchDir, { recursive: true });

      const adapter = new ClaudeCodeAdapter();
      adapter.watchPaths = () => [watchDir];

      const registry = new AdapterRegistry();
      registry.register(adapter);

      const watcher = new CaptureWatcher(registry, 300);
      const sessions: CapturedSession[] = [];
      watcher.on("session", (s: CapturedSession) => sessions.push(s));

      await watcher.start();

      // First write
      const file = path.join(watchDir, "session.jsonl");
      fs.writeFileSync(file, CLAUDE_CODE_JSONL);

      await waitFor(() => sessions.length >= 1);
      const countAfterFirst = sessions.length;
      expect(countAfterFirst).toBe(1);

      // Wait for scan interval to pass
      await new Promise((r) => setTimeout(r, 500));

      // Append new content (changes size) to trigger re-emit
      const extraLine =
        '\n{"parentUuid":"a3","isSidechain":false,"type":"user","message":{"role":"user","content":"another question"},"uuid":"u3","timestamp":"2026-04-02T10:00:06Z","cwd":"/tmp/proj","sessionId":"aaaa-bbbb-cccc-dddd"}';
      fs.appendFileSync(file, extraLine);

      await waitFor(() => sessions.length > countAfterFirst);
      await watcher.stop();

      expect(sessions.length).toBe(2);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  10. Event Queue Dedup                                             */
  /* ------------------------------------------------------------------ */

  describe("Event Queue Dedup", () => {
    let queueTmp: string;

    beforeEach(() => {
      queueTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-queue-"));
    });

    afterEach(() => {
      fs.rmSync(queueTmp, { recursive: true, force: true });
    });

    it("rapid writes to the same file emit at most 1 session per scan interval", async () => {
      const watchDir = path.join(queueTmp, "watch");
      fs.mkdirSync(watchDir, { recursive: true });

      const adapter = new GeminiAdapter();
      adapter.watchPaths = () => [watchDir];

      const registry = new AdapterRegistry();
      registry.register(adapter);

      // Use a longer scan interval so events accumulate
      const watcher = new CaptureWatcher(registry, 2000);
      const sessions: CapturedSession[] = [];
      watcher.on("session", (s: CapturedSession) => sessions.push(s));

      await watcher.start();

      const file = path.join(watchDir, "chat.json");

      // Write to the same file 5 times rapidly
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(file, GEMINI_JSON);
      }

      // Wait for one scan cycle
      await new Promise((r) => setTimeout(r, 3000));
      await watcher.stop();

      // Should emit at most 1 session (the queue deduplicates by path)
      expect(sessions.length).toBeLessThanOrEqual(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  11. Health Tracking                                               */
  /* ------------------------------------------------------------------ */

  describe("Health Tracking", () => {
    let healthTmp: string;

    beforeEach(() => {
      healthTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-health-"));
    });

    afterEach(() => {
      fs.rmSync(healthTmp, { recursive: true, force: true });
    });

    it("reports degraded when watch paths do not exist", async () => {
      const nonExistentPath = path.join(healthTmp, "does-not-exist");
      const adapter = new ClaudeCodeAdapter();
      adapter.watchPaths = () => [nonExistentPath];

      const registry = new AdapterRegistry();
      registry.register(adapter);

      const watcher = new CaptureWatcher(registry, 300);
      await watcher.start();

      expect(watcher.getHealth()).toBe("degraded");
      expect(watcher.getLastError()).toContain("not found");

      await watcher.stop();
    });

    it("reports healthy when watch paths exist", async () => {
      const existingPath = path.join(healthTmp, "sessions");
      fs.mkdirSync(existingPath, { recursive: true });

      const adapter = new ClaudeCodeAdapter();
      adapter.watchPaths = () => [existingPath];

      const registry = new AdapterRegistry();
      registry.register(adapter);

      const watcher = new CaptureWatcher(registry, 300);
      await watcher.start();

      expect(watcher.getHealth()).toBe("healthy");

      await watcher.stop();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  12. Daemon PID File                                               */
  /* ------------------------------------------------------------------ */

  describe("Daemon PID File", () => {
    let daemonTmp: string;

    beforeEach(() => {
      daemonTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-daemon-"));
    });

    afterEach(() => {
      fs.rmSync(daemonTmp, { recursive: true, force: true });
    });

    it("writePid creates PID file and readPid reads it back", () => {
      const dm = new DaemonManager(daemonTmp);
      dm.writePid(12345);

      const pid = dm.readPid();
      expect(pid).toBe(12345);
    });

    it("isRunning returns false for stale PID and cleans up PID file", () => {
      const dm = new DaemonManager(daemonTmp);
      // Write a PID that definitely does not exist (very high number)
      dm.writePid(2147483647);

      expect(dm.isRunning()).toBe(false);

      // PID file should be cleaned up
      const pidFile = path.join(daemonTmp, "capture.pid");
      expect(fs.existsSync(pidFile)).toBe(false);
    });

    it("isRunning returns true for a real running process", () => {
      const dm = new DaemonManager(daemonTmp);
      // Use our own PID which is definitely running
      dm.writePid(process.pid);

      expect(dm.isRunning()).toBe(true);
    });

    it("cleanup removes PID file", () => {
      const dm = new DaemonManager(daemonTmp);
      dm.writePid(12345);

      const pidFile = path.join(daemonTmp, "capture.pid");
      expect(fs.existsSync(pidFile)).toBe(true);

      dm.cleanup();
      expect(fs.existsSync(pidFile)).toBe(false);
    });

    it("status returns correct state", () => {
      const dm = new DaemonManager(daemonTmp);

      // No PID file
      const s1 = dm.status();
      expect(s1.running).toBe(false);
      expect(s1.pid).toBeNull();

      // Write own PID (running)
      dm.writePid(process.pid);
      const s2 = dm.status();
      expect(s2.running).toBe(true);
      expect(s2.pid).toBe(process.pid);

      // Write stale PID
      dm.writePid(2147483647);
      const s3 = dm.status();
      expect(s3.running).toBe(false);
      expect(s3.pid).toBeNull();
    });

    it("readPid returns null when no PID file exists", () => {
      const dm = new DaemonManager(daemonTmp);
      expect(dm.readPid()).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  13. Session Store                                                 */
  /* ------------------------------------------------------------------ */

  describe("Session Store", () => {
    let storeTmp: string;

    beforeEach(() => {
      storeTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cap-store-"));
    });

    afterEach(() => {
      fs.rmSync(storeTmp, { recursive: true, force: true });
    });

    function makeSession(id: string, updatedAt: string): CapturedSession {
      return {
        id,
        tool: "claude-code",
        projectPath: "/tmp/test",
        startedAt: "2026-04-02T10:00:00Z",
        updatedAt,
        messages: [{ role: "user", content: "hello", timestamp: "2026-04-02T10:00:00Z" }],
      };
    }

    it("save 3 sessions then list returns them sorted by updatedAt descending", () => {
      const store = new SessionStore(storeTmp);

      const s1 = makeSession("ses_aaa1111122222222", "2026-04-02T10:00:00Z");
      const s2 = makeSession("ses_bbb1111122222222", "2026-04-02T12:00:00Z");
      const s3 = makeSession("ses_ccc1111122222222", "2026-04-02T11:00:00Z");

      store.save(s1);
      store.save(s2);
      store.save(s3);

      const list = store.list();
      expect(list.length).toBe(3);
      // Most recent first
      expect(list[0].id).toBe("ses_bbb1111122222222");
      expect(list[1].id).toBe("ses_ccc1111122222222");
      expect(list[2].id).toBe("ses_aaa1111122222222");
    });

    it("load specific session by ID matches what was saved", () => {
      const store = new SessionStore(storeTmp);
      const s = makeSession("ses_dddd111122222222", "2026-04-02T10:00:00Z");
      store.save(s);

      const loaded = store.load("ses_dddd111122222222");
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(s.id);
      expect(loaded?.tool).toBe(s.tool);
      expect(loaded?.projectPath).toBe(s.projectPath);
      expect(loaded?.messages.length).toBe(s.messages.length);
    });

    it("delete session then load returns null", () => {
      const store = new SessionStore(storeTmp);
      const s = makeSession("ses_eeee111122222222", "2026-04-02T10:00:00Z");
      store.save(s);

      expect(store.load("ses_eeee111122222222")).not.toBeNull();

      store.delete("ses_eeee111122222222");
      expect(store.load("ses_eeee111122222222")).toBeNull();
    });

    it("list after delete shows one fewer session", () => {
      const store = new SessionStore(storeTmp);
      const s1 = makeSession("ses_fff1111122222222", "2026-04-02T10:00:00Z");
      const s2 = makeSession("ses_ggg1111122222222", "2026-04-02T11:00:00Z");
      store.save(s1);
      store.save(s2);

      expect(store.list().length).toBe(2);

      store.delete("ses_fff1111122222222");
      expect(store.list().length).toBe(1);
      expect(store.list()[0].id).toBe("ses_ggg1111122222222");
    });

    it("load non-existent session returns null", () => {
      const store = new SessionStore(storeTmp);
      expect(store.load("ses_nonexistent00000")).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  14. Session Validation                                            */
  /* ------------------------------------------------------------------ */

  describe("Session Validation", () => {
    it("valid session passes validateSession", () => {
      const session: CapturedSession = {
        id: "ses_aabbccdd11223344",
        tool: "claude-code",
        projectPath: "/tmp/test",
        startedAt: "2026-04-02T10:00:00Z",
        updatedAt: "2026-04-02T10:01:00Z",
        messages: [{ role: "user", content: "hello", timestamp: "2026-04-02T10:00:00Z" }],
      };
      expect(validateSession(session)).toBe(true);
    });

    it("session with empty messages fails", () => {
      const session = {
        id: "ses_aabbccdd11223344",
        tool: "claude-code",
        projectPath: "/tmp/test",
        startedAt: "2026-04-02T10:00:00Z",
        updatedAt: "2026-04-02T10:01:00Z",
        messages: [],
      };
      expect(validateSession(session)).toBe(false);
    });

    it("session with unknown tool fails", () => {
      const session = {
        id: "ses_aabbccdd11223344",
        tool: "unknown-tool",
        projectPath: "/tmp/test",
        startedAt: "2026-04-02T10:00:00Z",
        updatedAt: "2026-04-02T10:01:00Z",
        messages: [{ role: "user", content: "hello", timestamp: "2026-04-02T10:00:00Z" }],
      };
      expect(validateSession(session)).toBe(false);
    });

    it("session with invalid message role fails", () => {
      const session = {
        id: "ses_aabbccdd11223344",
        tool: "cursor",
        projectPath: "/tmp/test",
        startedAt: "2026-04-02T10:00:00Z",
        updatedAt: "2026-04-02T10:01:00Z",
        messages: [{ role: "system", content: "hello", timestamp: "2026-04-02T10:00:00Z" }],
      };
      expect(validateSession(session)).toBe(false);
    });

    it("null or non-object fails", () => {
      expect(validateSession(null)).toBe(false);
      expect(validateSession("string")).toBe(false);
      expect(validateSession(42)).toBe(false);
    });

    it("session missing required fields fails", () => {
      expect(validateSession({ id: "test" })).toBe(false);
      expect(validateSession({ id: "test", tool: "cursor" })).toBe(false);
    });

    it("all four tools are valid", () => {
      for (const tool of ["claude-code", "cursor", "codex", "gemini"]) {
        const session = {
          id: "ses_aabbccdd11223344",
          tool,
          projectPath: "/tmp/test",
          startedAt: "2026-04-02T10:00:00Z",
          updatedAt: "2026-04-02T10:01:00Z",
          messages: [{ role: "user", content: "hello", timestamp: "2026-04-02T10:00:00Z" }],
        };
        expect(validateSession(session)).toBe(true);
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  15. Cloud Sync                                                      */
  /* ------------------------------------------------------------------ */

  const SYNC_KEY = process.env.TEST_SYNAPSE_API_KEY ?? "";
  const syncSuite = SYNC_KEY ? describe : describe.skip;
  const API_BASE = "https://api.synapsesync.app";

  syncSuite("Cloud Sync", () => {
    const originalApiKey = process.env.SYNAPSE_API_KEY;
    let createdConversationIds: string[] = [];
    let resolvedProjectId: string | null = null;

    /** Fetch the first project ID from the Synapse API. */
    async function fetchProjectId(): Promise<string | null> {
      if (resolvedProjectId) return resolvedProjectId;
      const res = await fetch(`${API_BASE}/api/projects`, {
        headers: { Authorization: `Bearer ${SYNC_KEY}` },
      });
      if (!res.ok) return null;
      const projects = (await res.json()) as Array<{ id: string }>;
      resolvedProjectId = projects[0]?.id ?? null;
      return resolvedProjectId;
    }

    /** Delete a conversation by ID. Logs if the endpoint is missing (404/405). */
    async function deleteConversation(id: string): Promise<void> {
      const res = await fetch(`${API_BASE}/api/conversations/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${SYNC_KEY}` },
      });
      // 404 means already gone; 405 means DELETE not supported — both are OK for cleanup
      if (!res.ok && res.status !== 404 && res.status !== 405) {
        console.warn(`Cloud Sync cleanup: DELETE /api/conversations/${id} returned ${res.status}`);
      }
    }

    beforeEach(() => {
      process.env.SYNAPSE_API_KEY = SYNC_KEY;
    });

    afterEach(() => {
      if (originalApiKey === undefined) {
        process.env.SYNAPSE_API_KEY = undefined;
      } else {
        process.env.SYNAPSE_API_KEY = originalApiKey;
      }
    });

    afterAll(async () => {
      // Best-effort cleanup of any conversations created during these tests
      for (const id of createdConversationIds) {
        await deleteConversation(id);
      }
      createdConversationIds = [];
    });

    /** Build a minimal CapturedSession with N messages for testing. */
    function makeCloudSession(msgCount: number): CapturedSession {
      const messages: CapturedSession["messages"] = [];
      for (let i = 0; i < msgCount; i++) {
        messages.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i + 1}`,
          timestamp: `2026-04-02T10:00:0${i}Z`,
        });
      }
      return {
        id: `ses_cloudsync${String(Date.now()).slice(-6).padStart(10, "0")}`,
        tool: "claude-code",
        projectPath: "/tmp/cloud-sync-test",
        startedAt: "2026-04-02T10:00:00Z",
        updatedAt: "2026-04-02T10:00:05Z",
        messages,
      };
    }

    it("CloudSyncer with real API key is enabled", () => {
      const syncer = new CloudSyncer();
      expect(syncer.isEnabled()).toBe(true);
    }, 30000);

    it("first sync creates conversation and pushes messages", async () => {
      const syncer = new CloudSyncer();
      const session = makeCloudSession(3);

      const ok = await syncer.sync(session);
      expect(ok).toBe(true);

      // Verify the conversation was created in the cloud
      const projectId = await fetchProjectId();
      expect(projectId).not.toBeNull();

      const res = await fetch(`${API_BASE}/api/conversations?project_id=${projectId}`, {
        headers: { Authorization: `Bearer ${SYNC_KEY}` },
      });
      expect(res.ok).toBe(true);

      const convos = (await res.json()) as Array<{ id: string; working_context?: { capturedSessionId?: string } }>;
      const match = convos.find((c) => c.working_context?.capturedSessionId === session.id);
      expect(match).toBeDefined();

      if (match) {
        createdConversationIds.push(match.id);
      }
    }, 30000);

    it("subsequent sync appends only new messages", async () => {
      const syncer = new CloudSyncer();
      const session = makeCloudSession(2);

      // First sync — 2 messages
      const ok1 = await syncer.sync(session);
      expect(ok1).toBe(true);

      // Add a third message and sync again
      session.messages.push({
        role: "user",
        content: "Message 3",
        timestamp: "2026-04-02T10:00:06Z",
      });

      const ok2 = await syncer.sync(session);
      expect(ok2).toBe(true);

      // Find the conversation and verify message count is 3
      const projectId = await fetchProjectId();
      expect(projectId).not.toBeNull();

      const res = await fetch(`${API_BASE}/api/conversations?project_id=${projectId}`, {
        headers: { Authorization: `Bearer ${SYNC_KEY}` },
      });
      expect(res.ok).toBe(true);

      const convos = (await res.json()) as Array<{ id: string; working_context?: { capturedSessionId?: string } }>;
      const match = convos.find((c) => c.working_context?.capturedSessionId === session.id);
      expect(match).toBeDefined();

      if (match) {
        createdConversationIds.push(match.id);

        // Fetch messages for this conversation
        const msgRes = await fetch(`${API_BASE}/api/conversations/${match.id}/messages`, {
          headers: { Authorization: `Bearer ${SYNC_KEY}` },
        });
        if (msgRes.ok) {
          const msgs = (await msgRes.json()) as unknown[];
          expect(msgs.length).toBe(3);
        }
      }
    }, 30000);

    it("sync disabled without API key", async () => {
      // Temporarily unset the key
      process.env.SYNAPSE_API_KEY = undefined;

      const syncer = new CloudSyncer();
      expect(syncer.isEnabled()).toBe(false);

      const session = makeCloudSession(1);
      const ok = await syncer.sync(session);
      expect(ok).toBe(false);

      // Restore for afterEach
      process.env.SYNAPSE_API_KEY = SYNC_KEY;
    }, 30000);

    it("full pipeline: capture → idle → sync", async () => {
      const pipelineTmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-cloud-pipe-"));

      try {
        const watchDir = path.join(pipelineTmp, "claude-projects");
        fs.mkdirSync(watchDir, { recursive: true });
        const storeDir = path.join(pipelineTmp, "sessions");

        const adapter = new ClaudeCodeAdapter();
        adapter.watchPaths = () => [watchDir];

        const registry = new AdapterRegistry();
        registry.register(adapter);
        const store = new SessionStore(storeDir);
        const syncer = new CloudSyncer();

        const watcher = new CaptureWatcher(registry, 300);
        const sessions: CapturedSession[] = [];
        watcher.on("session", async (s: CapturedSession) => {
          sessions.push(s);
          store.save(s);
          // Manually trigger sync instead of waiting for the 5-minute interval
          await syncer.sync(s);
        });

        await watcher.start();

        // Write a Claude Code JSONL file to trigger capture
        const sessionFile = path.join(watchDir, "session.jsonl");
        fs.writeFileSync(sessionFile, CLAUDE_CODE_JSONL);

        await waitFor(() => sessions.length > 0, 15000);
        await watcher.stop();

        expect(sessions.length).toBe(1);
        const capturedSession = sessions[0];

        // Verify the session appears in the cloud
        const projectId = await fetchProjectId();
        expect(projectId).not.toBeNull();

        const res = await fetch(`${API_BASE}/api/conversations?project_id=${projectId}`, {
          headers: { Authorization: `Bearer ${SYNC_KEY}` },
        });
        expect(res.ok).toBe(true);

        const convos = (await res.json()) as Array<{
          id: string;
          working_context?: { capturedSessionId?: string };
        }>;
        const match = convos.find((c) => c.working_context?.capturedSessionId === capturedSession.id);
        expect(match).toBeDefined();

        if (match) {
          createdConversationIds.push(match.id);
        }
      } finally {
        fs.rmSync(pipelineTmp, { recursive: true, force: true });
      }
    }, 30000);
  });
});
