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
import { CodexAdapter } from "../../src/capture/adapters/codex.js";
import { CursorAdapter } from "../../src/capture/adapters/cursor.js";
import { GeminiAdapter } from "../../src/capture/adapters/gemini.js";
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
      expect(stdout).toContain("Not running");
      expect(stdout).toContain("0 captured session(s)");
    });

    it("capture start starts a daemon and prints PID", async () => {
      const { stdout } = await runCaptureCli(tmpHome, ["start"]);
      expect(stdout).toContain("Capture daemon started");
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
      expect(stdout).toContain("Running");
      expect(stdout).toMatch(/PID \d+/);

      await runCaptureCli(tmpHome, ["stop"]);
    });

    it("capture stop stops daemon and prints confirmation", async () => {
      await runCaptureCli(tmpHome, ["start"]);
      const { stdout } = await runCaptureCli(tmpHome, ["stop"]);
      expect(stdout).toContain("Capture daemon stopped");
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
      expect(stdout).toContain("Usage");
      expect(stdout).toContain("capture start");
      expect(stdout).toContain("capture stop");
      expect(stdout).toContain("capture status");
      expect(stdout).toContain("capture list");
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
  /*  7. Safe Read                                                      */
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
});
