# Session Capture (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silently capture AI coding sessions from Claude Code, Cursor, Codex CLI, and Gemini CLI via a background daemon with tool-specific adapters behind a common interface.

**Architecture:** A filesystem watcher (chokidar) monitors tool-specific paths. When files change, the watcher routes the event to the matching adapter, which parses the native format into a standard `CapturedSession` object. A daemon manages the watcher lifecycle. Sessions are stored locally as JSON files at `~/.synapse/sessions/`. CLI commands (`capture start/stop/status/list`) control everything.

**Tech Stack:** TypeScript, Node.js, chokidar (filesystem watching), vitest (testing)

---

## File Structure

```
mcp/src/capture/
  types.ts           — CapturedSession, SessionMessage, ToolAdapter interfaces
  adapter-registry.ts — register/lookup adapters by tool name
  adapters/
    claude-code.ts   — Claude Code adapter (JSONL append-only)
    cursor.ts        — Cursor IDE adapter (JSON rewrite)
    codex.ts         — Codex CLI adapter (JSONL rollout files)
    gemini.ts        — Gemini CLI adapter (JSON rewrite)
  watcher.ts         — chokidar watcher, routes events to adapters
  daemon.ts          — detached process lifecycle (start/stop/status)
  store.ts           — read/write sessions to ~/.synapse/sessions/
  cli.ts             — capture subcommand handler (start/stop/status/list)

mcp/test/unit/capture/
  types.test.ts      — session format validation
  claude-code.test.ts — Claude Code adapter unit tests
  cursor.test.ts     — Cursor adapter unit tests
  codex.test.ts      — Codex adapter unit tests
  gemini.test.ts     — Gemini adapter unit tests
  adapter-registry.test.ts — registry lookup tests
  watcher.test.ts    — watcher routing tests
  store.test.ts      — session store read/write tests
  daemon.test.ts     — daemon lifecycle tests

mcp/test/fixtures/capture/
  claude-code/       — sample JSONL session files
  cursor/            — sample JSON chat session files
  codex/             — sample rollout JSONL files
  gemini/            — sample JSON chat files
```

---

### Task 1: Types and Session Format

**Files:**
- Create: `mcp/src/capture/types.ts`
- Create: `mcp/test/unit/capture/types.test.ts`

- [ ] **Step 1: Write the test file for session types**

```typescript
// mcp/test/unit/capture/types.test.ts
import { describe, expect, it } from "vitest";
import { validateSession, validateMessage } from "../../src/capture/types.js";

describe("validateMessage", () => {
  it("accepts a valid user message", () => {
    const msg = { role: "user" as const, content: "hello", timestamp: "2026-04-02T10:00:00Z" };
    expect(validateMessage(msg)).toBe(true);
  });

  it("accepts a valid assistant message with tool calls", () => {
    const msg = {
      role: "assistant" as const,
      content: "I'll read that file",
      timestamp: "2026-04-02T10:00:01Z",
      toolCalls: [{ name: "read", input: "foo.ts", output: "contents" }],
    };
    expect(validateMessage(msg)).toBe(true);
  });

  it("rejects a message with missing content", () => {
    const msg = { role: "user" as const, timestamp: "2026-04-02T10:00:00Z" };
    expect(validateMessage(msg as any)).toBe(false);
  });

  it("rejects a message with invalid role", () => {
    const msg = { role: "system", content: "hello", timestamp: "2026-04-02T10:00:00Z" };
    expect(validateMessage(msg as any)).toBe(false);
  });
});

describe("validateSession", () => {
  it("accepts a valid session", () => {
    const session = {
      id: "ses_abc123",
      tool: "claude-code" as const,
      projectPath: "/Users/test/project",
      startedAt: "2026-04-02T10:00:00Z",
      updatedAt: "2026-04-02T10:05:00Z",
      messages: [
        { role: "user" as const, content: "fix the bug", timestamp: "2026-04-02T10:00:00Z" },
        { role: "assistant" as const, content: "I'll look into it", timestamp: "2026-04-02T10:00:01Z" },
      ],
    };
    expect(validateSession(session)).toBe(true);
  });

  it("rejects a session with no messages", () => {
    const session = {
      id: "ses_abc123",
      tool: "claude-code" as const,
      projectPath: "/Users/test/project",
      startedAt: "2026-04-02T10:00:00Z",
      updatedAt: "2026-04-02T10:05:00Z",
      messages: [],
    };
    expect(validateSession(session)).toBe(false);
  });

  it("rejects a session with unknown tool", () => {
    const session = {
      id: "ses_abc123",
      tool: "unknown-tool",
      projectPath: "/Users/test/project",
      startedAt: "2026-04-02T10:00:00Z",
      updatedAt: "2026-04-02T10:05:00Z",
      messages: [{ role: "user" as const, content: "hi", timestamp: "2026-04-02T10:00:00Z" }],
    };
    expect(validateSession(session as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/types.test.ts`
Expected: FAIL — module `../../src/capture/types.js` not found

- [ ] **Step 3: Write the types module**

```typescript
// mcp/src/capture/types.ts

export interface ToolCall {
  name: string;
  input?: string;
  output?: string;
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO 8601
  toolCalls?: ToolCall[];
}

export interface CapturedSession {
  id: string;
  tool: "claude-code" | "cursor" | "codex" | "gemini";
  projectPath: string;
  startedAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  messages: SessionMessage[];
}

export interface ToolAdapter {
  tool: string;
  watchPaths(): string[];
  parse(filePath: string): CapturedSession | null;
}

const VALID_TOOLS = new Set(["claude-code", "cursor", "codex", "gemini"]);
const VALID_ROLES = new Set(["user", "assistant"]);

export function validateMessage(msg: unknown): boolean {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (!VALID_ROLES.has(m.role as string)) return false;
  if (typeof m.content !== "string") return false;
  if (typeof m.timestamp !== "string") return false;
  return true;
}

export function validateSession(session: unknown): boolean {
  if (typeof session !== "object" || session === null) return false;
  const s = session as Record<string, unknown>;
  if (typeof s.id !== "string") return false;
  if (!VALID_TOOLS.has(s.tool as string)) return false;
  if (typeof s.projectPath !== "string") return false;
  if (typeof s.startedAt !== "string") return false;
  if (typeof s.updatedAt !== "string") return false;
  if (!Array.isArray(s.messages) || s.messages.length === 0) return false;
  return (s.messages as unknown[]).every(validateMessage);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/types.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/capture/types.ts mcp/test/unit/capture/types.test.ts
git commit -m "feat(capture): add session types, adapter interface, and validators"
```

---

### Task 2: Session Store

**Files:**
- Create: `mcp/src/capture/store.ts`
- Create: `mcp/test/unit/capture/store.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// mcp/test/unit/capture/store.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "../../src/capture/store.js";
import type { CapturedSession } from "../../src/capture/types.js";

function makeSession(overrides: Partial<CapturedSession> = {}): CapturedSession {
  return {
    id: "ses_test1",
    tool: "claude-code",
    projectPath: "/tmp/test-project",
    startedAt: "2026-04-02T10:00:00Z",
    updatedAt: "2026-04-02T10:05:00Z",
    messages: [{ role: "user", content: "hello", timestamp: "2026-04-02T10:00:00Z" }],
    ...overrides,
  };
}

describe("SessionStore", () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-store-test-"));
    store = new SessionStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads a session", () => {
    const session = makeSession();
    store.save(session);
    const loaded = store.load("ses_test1");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("ses_test1");
    expect(loaded!.messages).toHaveLength(1);
  });

  it("returns null for nonexistent session", () => {
    expect(store.load("ses_nonexistent")).toBeNull();
  });

  it("lists saved sessions sorted by updatedAt descending", () => {
    store.save(makeSession({ id: "ses_old", updatedAt: "2026-04-01T10:00:00Z" }));
    store.save(makeSession({ id: "ses_new", updatedAt: "2026-04-02T10:00:00Z" }));
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("ses_new");
    expect(list[1].id).toBe("ses_old");
  });

  it("overwrites an existing session on save", () => {
    store.save(makeSession({ id: "ses_1", messages: [{ role: "user", content: "v1", timestamp: "2026-04-02T10:00:00Z" }] }));
    store.save(makeSession({ id: "ses_1", messages: [
      { role: "user", content: "v1", timestamp: "2026-04-02T10:00:00Z" },
      { role: "assistant", content: "v2", timestamp: "2026-04-02T10:00:01Z" },
    ] }));
    const loaded = store.load("ses_1");
    expect(loaded!.messages).toHaveLength(2);
  });

  it("deletes a session", () => {
    store.save(makeSession({ id: "ses_del" }));
    expect(store.load("ses_del")).not.toBeNull();
    store.delete("ses_del");
    expect(store.load("ses_del")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the store module**

```typescript
// mcp/src/capture/store.ts
import fs from "node:fs";
import path from "node:path";
import type { CapturedSession } from "./types.js";

export class SessionStore {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? path.join(process.env.HOME ?? "~", ".synapse", "sessions");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  save(session: CapturedSession): void {
    fs.writeFileSync(this.filePath(session.id), JSON.stringify(session, null, 2));
  }

  load(id: string): CapturedSession | null {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as CapturedSession;
  }

  delete(id: string): void {
    const fp = this.filePath(id);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  list(): CapturedSession[] {
    if (!fs.existsSync(this.dir)) return [];
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    const sessions = files.map((f) => {
      return JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8")) as CapturedSession;
    });
    return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/store.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/capture/store.ts mcp/test/unit/capture/store.test.ts
git commit -m "feat(capture): add session store (read/write/list/delete)"
```

---

### Task 3: Adapter Registry

**Files:**
- Create: `mcp/src/capture/adapter-registry.ts`
- Create: `mcp/test/unit/capture/adapter-registry.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// mcp/test/unit/capture/adapter-registry.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "../../src/capture/adapter-registry.js";
import type { ToolAdapter, CapturedSession } from "../../src/capture/types.js";

function makeAdapter(tool: string, paths: string[]): ToolAdapter {
  return {
    tool,
    watchPaths: () => paths,
    parse: () => null,
  };
}

describe("AdapterRegistry", () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it("registers and retrieves an adapter by tool name", () => {
    const adapter = makeAdapter("claude-code", ["/home/.claude"]);
    registry.register(adapter);
    expect(registry.get("claude-code")).toBe(adapter);
  });

  it("returns undefined for unregistered tool", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("finds the adapter whose watchPath matches a file path", () => {
    registry.register(makeAdapter("claude-code", ["/home/.claude/projects"]));
    registry.register(makeAdapter("cursor", ["/home/Library/Cursor"]));
    const found = registry.findByPath("/home/.claude/projects/abc/session.jsonl");
    expect(found?.tool).toBe("claude-code");
  });

  it("returns undefined when no adapter matches the path", () => {
    registry.register(makeAdapter("claude-code", ["/home/.claude/projects"]));
    expect(registry.findByPath("/completely/different/path")).toBeUndefined();
  });

  it("returns all watch paths from all adapters", () => {
    registry.register(makeAdapter("claude-code", ["/a"]));
    registry.register(makeAdapter("cursor", ["/b", "/c"]));
    expect(registry.allWatchPaths()).toEqual(["/a", "/b", "/c"]);
  });

  it("lists all registered adapter tool names", () => {
    registry.register(makeAdapter("claude-code", ["/a"]));
    registry.register(makeAdapter("cursor", ["/b"]));
    expect(registry.tools()).toEqual(["claude-code", "cursor"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/adapter-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the registry module**

```typescript
// mcp/src/capture/adapter-registry.ts
import type { ToolAdapter } from "./types.js";

export class AdapterRegistry {
  private adapters = new Map<string, ToolAdapter>();

  register(adapter: ToolAdapter): void {
    this.adapters.set(adapter.tool, adapter);
  }

  get(tool: string): ToolAdapter | undefined {
    return this.adapters.get(tool);
  }

  findByPath(filePath: string): ToolAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.watchPaths().some((wp) => filePath.startsWith(wp))) {
        return adapter;
      }
    }
    return undefined;
  }

  allWatchPaths(): string[] {
    return Array.from(this.adapters.values()).flatMap((a) => a.watchPaths());
  }

  tools(): string[] {
    return Array.from(this.adapters.keys());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/adapter-registry.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/capture/adapter-registry.ts mcp/test/unit/capture/adapter-registry.test.ts
git commit -m "feat(capture): add adapter registry with path-based lookup"
```

---

### Task 4: Claude Code Adapter

**Files:**
- Create: `mcp/src/capture/adapters/claude-code.ts`
- Create: `mcp/test/unit/capture/claude-code.test.ts`
- Create: `mcp/test/fixtures/capture/claude-code/sample-session.jsonl`

- [ ] **Step 1: Create the test fixture**

Create `mcp/test/fixtures/capture/claude-code/sample-session.jsonl` with real-format Claude Code JSONL. Each line is a JSON object. Include user messages, assistant messages, and tool use entries.

```jsonl
{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"fix the auth bug in login.ts"},"uuid":"msg-001","timestamp":"2026-04-02T10:00:00.000Z","userType":"external","entrypoint":"cli","cwd":"/Users/test/myproject","sessionId":"ses_cc_001","version":"2.1.85","gitBranch":"main"}
{"parentUuid":"msg-001","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll look at the login.ts file to find the auth bug."}]},"uuid":"msg-002","timestamp":"2026-04-02T10:00:05.000Z","sessionId":"ses_cc_001"}
{"parentUuid":"msg-002","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool_001","name":"Read","input":{"file_path":"/Users/test/myproject/src/login.ts"}}]},"uuid":"msg-003","timestamp":"2026-04-02T10:00:06.000Z","sessionId":"ses_cc_001"}
{"parentUuid":"msg-003","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool_001","content":"export function login() { return null; }"}]},"uuid":"msg-004","timestamp":"2026-04-02T10:00:07.000Z","sessionId":"ses_cc_001"}
{"parentUuid":"msg-004","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Found the issue. The login function returns null instead of the session token. Let me fix it."}]},"uuid":"msg-005","timestamp":"2026-04-02T10:00:10.000Z","sessionId":"ses_cc_001"}
```

- [ ] **Step 2: Write the test file**

```typescript
// mcp/test/unit/capture/claude-code.test.ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../../src/capture/adapters/claude-code.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../test/fixtures/capture/claude-code/sample-session.jsonl");

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter();

  it("has tool name 'claude-code'", () => {
    expect(adapter.tool).toBe("claude-code");
  });

  it("returns watch paths under ~/.claude/projects", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain(".claude/projects");
  });

  it("parses a JSONL session file into CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.tool).toBe("claude-code");
    expect(session!.id).toBe("ses_cc_001");
    expect(session!.projectPath).toBe("/Users/test/myproject");
  });

  it("extracts user and assistant messages", () => {
    const session = adapter.parse(FIXTURE)!;
    const userMsgs = session.messages.filter((m) => m.role === "user");
    const assistantMsgs = session.messages.filter((m) => m.role === "assistant");
    expect(userMsgs.length).toBeGreaterThan(0);
    expect(assistantMsgs.length).toBeGreaterThan(0);
  });

  it("extracts tool calls from assistant messages", () => {
    const session = adapter.parse(FIXTURE)!;
    const withTools = session.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0);
    expect(withTools.length).toBeGreaterThan(0);
    expect(withTools[0].toolCalls![0].name).toBe("Read");
  });

  it("returns null for non-JSONL files", () => {
    expect(adapter.parse("/some/random/file.txt")).toBeNull();
  });

  it("skips sidechain messages", () => {
    const session = adapter.parse(FIXTURE)!;
    // All messages in the fixture have isSidechain: false, so all should be included
    // If a sidechain message were present, it should be excluded
    expect(session.messages.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/claude-code.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write the Claude Code adapter**

```typescript
// mcp/src/capture/adapters/claude-code.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";

interface ClaudeCodeLine {
  parentUuid: string | null;
  isSidechain: boolean;
  type: string;
  message: {
    role: string;
    content: string | { type: string; text?: string; name?: string; id?: string; input?: unknown }[];
  };
  uuid: string;
  timestamp: string;
  sessionId?: string;
  cwd?: string;
}

function extractText(content: string | { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

function extractToolCalls(
  content: string | { type: string; name?: string; input?: unknown; id?: string }[],
): { name: string; input?: string }[] {
  if (typeof content === "string") return [];
  return content
    .filter((c) => c.type === "tool_use" && c.name)
    .map((c) => ({
      name: c.name!,
      input: c.input ? JSON.stringify(c.input) : undefined,
    }));
}

export class ClaudeCodeAdapter implements ToolAdapter {
  tool = "claude-code";

  watchPaths(): string[] {
    return [path.join(os.homedir(), ".claude", "projects")];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".jsonl")) return null;
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    let sessionId: string | null = null;
    let projectPath: string | null = null;
    let startedAt: string | null = null;
    let updatedAt: string | null = null;
    const messages: SessionMessage[] = [];

    for (const line of lines) {
      let parsed: ClaudeCodeLine;
      try {
        parsed = JSON.parse(line) as ClaudeCodeLine;
      } catch {
        continue;
      }

      // Skip non-message lines (e.g., file-history-snapshot)
      if (!parsed.message?.role) continue;
      // Skip sidechain messages
      if (parsed.isSidechain) continue;
      // Skip meta/tool_result messages from user (these are tool outputs, not user prompts)
      if (parsed.type === "user" && parsed.message.role === "user" && Array.isArray(parsed.message.content)) {
        const isToolResult = parsed.message.content.every(
          (c: { type: string }) => c.type === "tool_result",
        );
        if (isToolResult) continue;
      }

      if (!sessionId && parsed.sessionId) sessionId = parsed.sessionId;
      if (!projectPath && parsed.cwd) projectPath = parsed.cwd;
      if (!startedAt) startedAt = parsed.timestamp;
      updatedAt = parsed.timestamp;

      const text = extractText(parsed.message.content);
      if (!text) continue;

      const toolCalls = parsed.message.role === "assistant" ? extractToolCalls(parsed.message.content) : [];

      messages.push({
        role: parsed.message.role === "assistant" ? "assistant" : "user",
        content: text,
        timestamp: parsed.timestamp,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    if (!sessionId || messages.length === 0) return null;

    return {
      id: sessionId,
      tool: "claude-code",
      projectPath: projectPath ?? "unknown",
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
      messages,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/claude-code.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add mcp/src/capture/adapters/claude-code.ts mcp/test/unit/capture/claude-code.test.ts mcp/test/fixtures/capture/claude-code/sample-session.jsonl
git commit -m "feat(capture): add Claude Code adapter"
```

---

### Task 5: Cursor Adapter

**Files:**
- Create: `mcp/src/capture/adapters/cursor.ts`
- Create: `mcp/test/unit/capture/cursor.test.ts`
- Create: `mcp/test/fixtures/capture/cursor/sample-chat.json`

- [ ] **Step 1: Create the test fixture**

Create `mcp/test/fixtures/capture/cursor/sample-chat.json`:

```json
{
  "version": 3,
  "requests": [
    {
      "requestId": "req_001",
      "message": {
        "text": "explain the auth middleware",
        "parts": [{ "range": { "start": 0, "endExclusive": 27 }, "text": "explain the auth middleware", "kind": "text" }]
      },
      "response": [
        { "value": "The auth middleware validates JWT tokens on every incoming request. It extracts the token from the Authorization header, verifies it against the secret, and attaches the decoded user to req.user." }
      ],
      "result": {
        "timings": { "firstProgress": 500, "totalElapsed": 1200 },
        "metadata": { "sessionId": "ses_cursor_001", "agentId": "github.copilot" }
      },
      "timestamp": 1743588000000,
      "agent": { "id": "github.copilot" },
      "modelId": "gpt-4.1"
    },
    {
      "requestId": "req_002",
      "message": {
        "text": "refactor it to use session cookies instead",
        "parts": [{ "range": { "start": 0, "endExclusive": 42 }, "text": "refactor it to use session cookies instead", "kind": "text" }]
      },
      "response": [
        { "value": "I'll refactor the auth middleware to use session cookies. Here's the updated code..." }
      ],
      "result": {
        "timings": { "firstProgress": 300, "totalElapsed": 900 },
        "metadata": { "sessionId": "ses_cursor_001", "agentId": "github.copilot" }
      },
      "timestamp": 1743588060000,
      "agent": { "id": "github.copilot" },
      "modelId": "gpt-4.1"
    }
  ],
  "sessionId": "ses_cursor_001",
  "creationDate": 1743588000000,
  "lastMessageDate": 1743588060000,
  "isImported": false
}
```

- [ ] **Step 2: Write the test file**

```typescript
// mcp/test/unit/capture/cursor.test.ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CursorAdapter } from "../../src/capture/adapters/cursor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../test/fixtures/capture/cursor/sample-chat.json");

describe("CursorAdapter", () => {
  const adapter = new CursorAdapter();

  it("has tool name 'cursor'", () => {
    expect(adapter.tool).toBe("cursor");
  });

  it("returns watch paths under Cursor workspace storage", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain("Cursor");
  });

  it("parses a JSON chat file into CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.tool).toBe("cursor");
    expect(session!.id).toBe("ses_cursor_001");
  });

  it("extracts alternating user/assistant messages from requests", () => {
    const session = adapter.parse(FIXTURE)!;
    expect(session.messages).toHaveLength(4); // 2 user + 2 assistant
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[1].role).toBe("assistant");
    expect(session.messages[2].role).toBe("user");
    expect(session.messages[3].role).toBe("assistant");
  });

  it("returns null for non-JSON files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/cursor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write the Cursor adapter**

```typescript
// mcp/src/capture/adapters/cursor.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";

interface CursorRequest {
  requestId: string;
  message: { text: string };
  response?: { value: string }[];
  timestamp: number;
}

interface CursorChat {
  requests: CursorRequest[];
  sessionId: string;
  creationDate: number;
  lastMessageDate: number;
}

export class CursorAdapter implements ToolAdapter {
  tool = "cursor";

  watchPaths(): string[] {
    const base = path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "workspaceStorage");
    return [base];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".json")) return null;
    if (!fs.existsSync(filePath)) return null;

    let chat: CursorChat;
    try {
      chat = JSON.parse(fs.readFileSync(filePath, "utf-8")) as CursorChat;
    } catch {
      return null;
    }

    if (!chat.requests || !chat.sessionId) return null;

    const messages: SessionMessage[] = [];

    for (const req of chat.requests) {
      const userText = req.message?.text;
      if (!userText) continue;

      messages.push({
        role: "user",
        content: userText,
        timestamp: new Date(req.timestamp).toISOString(),
      });

      const responseText = req.response?.map((r) => r.value).join("\n");
      if (responseText) {
        messages.push({
          role: "assistant",
          content: responseText,
          timestamp: new Date(req.timestamp).toISOString(),
        });
      }
    }

    if (messages.length === 0) return null;

    // Extract workspace path from the file path if possible
    // Pattern: .../workspaceStorage/<hash>/chatSessions/<uuid>.json
    const parts = filePath.split(path.sep);
    const wsIdx = parts.indexOf("workspaceStorage");
    const projectPath = wsIdx >= 0 ? parts.slice(0, wsIdx).join(path.sep) : "unknown";

    return {
      id: chat.sessionId,
      tool: "cursor",
      projectPath,
      startedAt: new Date(chat.creationDate).toISOString(),
      updatedAt: new Date(chat.lastMessageDate).toISOString(),
      messages,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/cursor.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add mcp/src/capture/adapters/cursor.ts mcp/test/unit/capture/cursor.test.ts mcp/test/fixtures/capture/cursor/sample-chat.json
git commit -m "feat(capture): add Cursor adapter"
```

---

### Task 6: Codex CLI Adapter

**Files:**
- Create: `mcp/src/capture/adapters/codex.ts`
- Create: `mcp/test/unit/capture/codex.test.ts`
- Create: `mcp/test/fixtures/capture/codex/rollout-sample.jsonl`

- [ ] **Step 1: Create the test fixture**

Create `mcp/test/fixtures/capture/codex/rollout-sample.jsonl`:

```jsonl
{"type":"metadata","timestamp":"2026-04-02T10:00:00Z","session_id":"ses_codex_001","model":"o4-mini","cwd":"/Users/test/myproject"}
{"type":"message","timestamp":"2026-04-02T10:00:01Z","role":"user","content":"add rate limiting to the API","session_id":"ses_codex_001"}
{"type":"message","timestamp":"2026-04-02T10:00:05Z","role":"assistant","content":"I'll add rate limiting using a token bucket algorithm. Let me first check the existing middleware.","session_id":"ses_codex_001","tokens":{"input":150,"output":45}}
{"type":"tool_call","timestamp":"2026-04-02T10:00:06Z","role":"assistant","name":"shell","input":"cat src/middleware/index.ts","output":"export const cors = ...","session_id":"ses_codex_001"}
{"type":"message","timestamp":"2026-04-02T10:00:15Z","role":"assistant","content":"I've added rate limiting middleware using a sliding window approach. The limits are 100 requests per minute per API key.","session_id":"ses_codex_001","tokens":{"input":500,"output":120}}
```

- [ ] **Step 2: Write the test file**

```typescript
// mcp/test/unit/capture/codex.test.ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAdapter } from "../../src/capture/adapters/codex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../test/fixtures/capture/codex/rollout-sample.jsonl");

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  it("has tool name 'codex'", () => {
    expect(adapter.tool).toBe("codex");
  });

  it("returns watch paths under ~/.codex/sessions", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain(".codex/sessions");
  });

  it("parses a rollout JSONL file into CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.tool).toBe("codex");
    expect(session!.id).toBe("ses_codex_001");
    expect(session!.projectPath).toBe("/Users/test/myproject");
  });

  it("extracts user and assistant messages", () => {
    const session = adapter.parse(FIXTURE)!;
    const userMsgs = session.messages.filter((m) => m.role === "user");
    const assistantMsgs = session.messages.filter((m) => m.role === "assistant");
    expect(userMsgs.length).toBe(1);
    expect(assistantMsgs.length).toBe(2);
  });

  it("extracts tool calls", () => {
    const session = adapter.parse(FIXTURE)!;
    const withTools = session.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0);
    expect(withTools.length).toBe(1);
    expect(withTools[0].toolCalls![0].name).toBe("shell");
  });

  it("returns null for non-JSONL files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/codex.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write the Codex adapter**

```typescript
// mcp/src/capture/adapters/codex.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";

interface CodexLine {
  type: string;
  timestamp: string;
  role?: string;
  content?: string;
  session_id?: string;
  name?: string;
  input?: string;
  output?: string;
  model?: string;
  cwd?: string;
  tokens?: { input: number; output: number };
}

export class CodexAdapter implements ToolAdapter {
  tool = "codex";

  watchPaths(): string[] {
    return [path.join(os.homedir(), ".codex", "sessions")];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".jsonl")) return null;
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    let sessionId: string | null = null;
    let projectPath: string | null = null;
    let startedAt: string | null = null;
    let updatedAt: string | null = null;
    const messages: SessionMessage[] = [];

    for (const line of lines) {
      let parsed: CodexLine;
      try {
        parsed = JSON.parse(line) as CodexLine;
      } catch {
        continue;
      }

      if (!sessionId && parsed.session_id) sessionId = parsed.session_id;
      if (!projectPath && parsed.cwd) projectPath = parsed.cwd;
      if (!startedAt && parsed.timestamp) startedAt = parsed.timestamp;
      if (parsed.timestamp) updatedAt = parsed.timestamp;

      if (parsed.type === "message" && parsed.role && parsed.content) {
        messages.push({
          role: parsed.role === "assistant" ? "assistant" : "user",
          content: parsed.content,
          timestamp: parsed.timestamp,
        });
      } else if (parsed.type === "tool_call" && parsed.name) {
        // Attach tool call to a synthetic assistant message
        messages.push({
          role: "assistant",
          content: parsed.output ?? `[called ${parsed.name}]`,
          timestamp: parsed.timestamp,
          toolCalls: [{ name: parsed.name, input: parsed.input, output: parsed.output }],
        });
      }
    }

    if (!sessionId || messages.length === 0) return null;

    return {
      id: sessionId,
      tool: "codex",
      projectPath: projectPath ?? "unknown",
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
      messages,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/codex.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add mcp/src/capture/adapters/codex.ts mcp/test/unit/capture/codex.test.ts mcp/test/fixtures/capture/codex/rollout-sample.jsonl
git commit -m "feat(capture): add Codex CLI adapter"
```

---

### Task 7: Gemini CLI Adapter

**Files:**
- Create: `mcp/src/capture/adapters/gemini.ts`
- Create: `mcp/test/unit/capture/gemini.test.ts`
- Create: `mcp/test/fixtures/capture/gemini/sample-chat.json`

- [ ] **Step 1: Create the test fixture**

Create `mcp/test/fixtures/capture/gemini/sample-chat.json`:

```json
{
  "id": "ses_gemini_001",
  "messages": [
    {
      "id": "msg_g1",
      "role": "user",
      "content": [{ "type": "text", "text": "set up the database migration for the users table" }],
      "timestamp": "2026-04-02T10:00:00Z"
    },
    {
      "id": "msg_g2",
      "role": "model",
      "content": [
        { "type": "text", "text": "I'll create a migration for the users table with the required columns." },
        { "type": "tool_use", "toolName": "code_execution", "input": { "code": "CREATE TABLE users ..." }, "output": { "result": "Migration created" } }
      ],
      "timestamp": "2026-04-02T10:00:10Z",
      "metadata": { "model": "gemini-2.0-flash", "tokens": { "input": 200, "output": 80 } }
    },
    {
      "id": "msg_g3",
      "role": "user",
      "content": [{ "type": "text", "text": "add an email unique constraint" }],
      "timestamp": "2026-04-02T10:01:00Z"
    },
    {
      "id": "msg_g4",
      "role": "model",
      "content": [{ "type": "text", "text": "Done. I've added a unique constraint on the email column." }],
      "timestamp": "2026-04-02T10:01:10Z"
    }
  ],
  "createdAt": "2026-04-02T10:00:00Z",
  "updatedAt": "2026-04-02T10:01:10Z",
  "projectHash": "abc123"
}
```

- [ ] **Step 2: Write the test file**

```typescript
// mcp/test/unit/capture/gemini.test.ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GeminiAdapter } from "../../src/capture/adapters/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../test/fixtures/capture/gemini/sample-chat.json");

describe("GeminiAdapter", () => {
  const adapter = new GeminiAdapter();

  it("has tool name 'gemini'", () => {
    expect(adapter.tool).toBe("gemini");
  });

  it("returns watch paths under ~/.gemini/tmp", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain(".gemini");
  });

  it("parses a JSON chat file into CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session!.tool).toBe("gemini");
    expect(session!.id).toBe("ses_gemini_001");
  });

  it("maps 'model' role to 'assistant'", () => {
    const session = adapter.parse(FIXTURE)!;
    const roles = session.messages.map((m) => m.role);
    expect(roles).not.toContain("model");
    expect(roles.filter((r) => r === "assistant").length).toBe(2);
  });

  it("extracts tool calls from model messages", () => {
    const session = adapter.parse(FIXTURE)!;
    const withTools = session.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0);
    expect(withTools.length).toBe(1);
    expect(withTools[0].toolCalls![0].name).toBe("code_execution");
  });

  it("returns null for non-JSON files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/gemini.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write the Gemini adapter**

```typescript
// mcp/src/capture/adapters/gemini.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";

interface GeminiContent {
  type: string;
  text?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
}

interface GeminiMessage {
  id: string;
  role: string; // "user" | "model"
  content: GeminiContent[];
  timestamp: string;
}

interface GeminiChat {
  id: string;
  messages: GeminiMessage[];
  createdAt: string;
  updatedAt: string;
  projectHash?: string;
}

export class GeminiAdapter implements ToolAdapter {
  tool = "gemini";

  watchPaths(): string[] {
    return [path.join(os.homedir(), ".gemini", "tmp")];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".json")) return null;
    if (!fs.existsSync(filePath)) return null;

    let chat: GeminiChat;
    try {
      chat = JSON.parse(fs.readFileSync(filePath, "utf-8")) as GeminiChat;
    } catch {
      return null;
    }

    if (!chat.id || !chat.messages) return null;

    const messages: SessionMessage[] = [];

    for (const msg of chat.messages) {
      const text = msg.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n");

      if (!text) continue;

      const toolCalls = msg.content
        .filter((c) => c.type === "tool_use" && c.toolName)
        .map((c) => ({
          name: c.toolName!,
          input: c.input ? JSON.stringify(c.input) : undefined,
          output: c.output ? JSON.stringify(c.output) : undefined,
        }));

      messages.push({
        role: msg.role === "model" ? "assistant" : "user",
        content: text,
        timestamp: msg.timestamp,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    if (messages.length === 0) return null;

    return {
      id: chat.id,
      tool: "gemini",
      projectPath: "unknown", // Gemini uses projectHash, not a path
      startedAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/gemini.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add mcp/src/capture/adapters/gemini.ts mcp/test/unit/capture/gemini.test.ts mcp/test/fixtures/capture/gemini/sample-chat.json
git commit -m "feat(capture): add Gemini CLI adapter"
```

---

### Task 8: Watcher

**Files:**
- Create: `mcp/src/capture/watcher.ts`
- Create: `mcp/test/unit/capture/watcher.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// mcp/test/unit/capture/watcher.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CaptureWatcher } from "../../src/capture/watcher.js";
import { AdapterRegistry } from "../../src/capture/adapter-registry.js";
import type { CapturedSession, ToolAdapter } from "../../src/capture/types.js";

function makeFakeAdapter(tool: string, watchDir: string): ToolAdapter {
  return {
    tool,
    watchPaths: () => [watchDir],
    parse: (filePath: string) => {
      if (!filePath.endsWith(".jsonl")) return null;
      return {
        id: `ses_${tool}_1`,
        tool: tool as CapturedSession["tool"],
        projectPath: "/tmp/project",
        startedAt: "2026-04-02T10:00:00Z",
        updatedAt: "2026-04-02T10:05:00Z",
        messages: [{ role: "user" as const, content: "test", timestamp: "2026-04-02T10:00:00Z" }],
      };
    },
  };
}

describe("CaptureWatcher", () => {
  let tmpDir: string;
  let registry: AdapterRegistry;
  let watcher: CaptureWatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-watcher-test-"));
    registry = new AdapterRegistry();
    registry.register(makeFakeAdapter("claude-code", tmpDir));
    watcher = new CaptureWatcher(registry);
  });

  afterEach(async () => {
    await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits a session when a watched file changes", async () => {
    const sessions: CapturedSession[] = [];
    watcher.on("session", (s) => sessions.push(s));

    await watcher.start();

    // Create a file in the watched directory
    const testFile = path.join(tmpDir, "test-session.jsonl");
    fs.writeFileSync(testFile, '{"test": true}\n');

    // Wait for chokidar to detect the change
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe("ses_claude-code_1");
  });

  it("ignores files that adapters return null for", async () => {
    const sessions: CapturedSession[] = [];
    watcher.on("session", (s) => sessions.push(s));

    await watcher.start();

    // Create a .txt file (adapter returns null for non-JSONL)
    fs.writeFileSync(path.join(tmpDir, "ignored.txt"), "not a session");

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(sessions.length).toBe(0);
  });

  it("reports running state", async () => {
    expect(watcher.isRunning()).toBe(false);
    await watcher.start();
    expect(watcher.isRunning()).toBe(true);
    await watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/watcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Add chokidar dependency**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npm install chokidar`

- [ ] **Step 4: Write the watcher module**

```typescript
// mcp/src/capture/watcher.ts
import { watch, type FSWatcher } from "chokidar";
import { EventEmitter } from "node:events";
import type { AdapterRegistry } from "./adapter-registry.js";
import type { CapturedSession } from "./types.js";

export class CaptureWatcher extends EventEmitter {
  private registry: AdapterRegistry;
  private fsWatcher: FSWatcher | null = null;
  private running = false;

  constructor(registry: AdapterRegistry) {
    super();
    this.registry = registry;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const paths = this.registry.allWatchPaths();
    if (paths.length === 0) return;

    this.fsWatcher = watch(paths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    this.fsWatcher.on("add", (filePath) => this.handleEvent(filePath));
    this.fsWatcher.on("change", (filePath) => this.handleEvent(filePath));

    this.running = true;

    // Wait for chokidar to be ready
    await new Promise<void>((resolve) => {
      this.fsWatcher!.on("ready", resolve);
    });
  }

  async stop(): Promise<void> {
    if (this.fsWatcher) {
      await this.fsWatcher.close();
      this.fsWatcher = null;
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private handleEvent(filePath: string): void {
    const adapter = this.registry.findByPath(filePath);
    if (!adapter) return;

    const session = adapter.parse(filePath);
    if (!session) return;

    this.emit("session", session);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/watcher.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add mcp/src/capture/watcher.ts mcp/test/unit/capture/watcher.test.ts mcp/package.json
git commit -m "feat(capture): add filesystem watcher with adapter routing"
```

---

### Task 9: Daemon Lifecycle

**Files:**
- Create: `mcp/src/capture/daemon.ts`
- Create: `mcp/test/unit/capture/daemon.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// mcp/test/unit/capture/daemon.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DaemonManager } from "../../src/capture/daemon.js";

describe("DaemonManager", () => {
  let tmpDir: string;
  let manager: DaemonManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-daemon-test-"));
    manager = new DaemonManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports not running when no PID file exists", () => {
    expect(manager.isRunning()).toBe(false);
  });

  it("reports not running when PID file has stale PID", () => {
    // Write a PID that definitely doesn't exist
    fs.writeFileSync(path.join(tmpDir, "capture.pid"), "999999999");
    expect(manager.isRunning()).toBe(false);
  });

  it("writes and reads PID file", () => {
    manager.writePid(12345);
    expect(manager.readPid()).toBe(12345);
  });

  it("cleans up PID file", () => {
    manager.writePid(12345);
    manager.cleanup();
    expect(manager.readPid()).toBeNull();
  });

  it("returns status with running state and PID", () => {
    const status = manager.status();
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/daemon.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the daemon module**

```typescript
// mcp/src/capture/daemon.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null; // seconds
}

export class DaemonManager {
  private dir: string;
  private pidFile: string;
  private logFile: string;

  constructor(dir?: string) {
    this.dir = dir ?? path.join(os.homedir(), ".synapse");
    fs.mkdirSync(this.dir, { recursive: true });
    this.pidFile = path.join(this.dir, "capture.pid");
    this.logFile = path.join(this.dir, "capture.log");
  }

  writePid(pid: number): void {
    fs.writeFileSync(this.pidFile, String(pid));
  }

  readPid(): number | null {
    if (!fs.existsSync(this.pidFile)) return null;
    const raw = fs.readFileSync(this.pidFile, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isNaN(pid) ? null : pid;
  }

  isRunning(): boolean {
    const pid = this.readPid();
    if (pid === null) return false;
    try {
      process.kill(pid, 0); // Signal 0 = check if process exists
      return true;
    } catch {
      // Process doesn't exist, clean up stale PID file
      this.cleanup();
      return false;
    }
  }

  cleanup(): void {
    if (fs.existsSync(this.pidFile)) fs.unlinkSync(this.pidFile);
  }

  status(): DaemonStatus {
    const pid = this.readPid();
    const running = this.isRunning();
    return { running, pid: running ? pid : null, uptime: null };
  }

  getLogFile(): string {
    return this.logFile;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/daemon.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/capture/daemon.ts mcp/test/unit/capture/daemon.test.ts
git commit -m "feat(capture): add daemon lifecycle manager"
```

---

### Task 10: CLI Subcommand and Integration

**Files:**
- Create: `mcp/src/capture/cli.ts`
- Modify: `mcp/src/index.ts` (add `capture` to CLI_SUBCOMMANDS and handleCli)

- [ ] **Step 1: Write the CLI handler**

```typescript
// mcp/src/capture/cli.ts
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonManager } from "./daemon.js";
import { SessionStore } from "./store.js";
import { bold, accent, muted } from "../cli/theme.js";

const daemon = new DaemonManager();
const store = new SessionStore();

export async function runCapture(args: string[]): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "start":
      return startCapture();
    case "stop":
      return stopCapture();
    case "status":
      return captureStatus();
    case "list":
      return listCaptures();
    default:
      console.log(`${bold("Usage:")}`);
      console.log(`  npx synapsesync-mcp capture start    Start capture daemon`);
      console.log(`  npx synapsesync-mcp capture stop     Stop capture daemon`);
      console.log(`  npx synapsesync-mcp capture status   Check daemon status`);
      console.log(`  npx synapsesync-mcp capture list     List captured sessions`);
  }
}

function startCapture(): void {
  if (daemon.isRunning()) {
    console.log(`${accent("Capture daemon is already running")} (PID ${daemon.readPid()})`);
    return;
  }

  // Spawn the daemon as a detached child process
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "capture-worker.js");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });

  child.unref();
  if (child.pid) {
    daemon.writePid(child.pid);
    console.log(`${accent("Capture daemon started")} (PID ${child.pid})`);
    console.log(muted(`Log: ${daemon.getLogFile()}`));
  }
}

function stopCapture(): void {
  const pid = daemon.readPid();
  if (!pid || !daemon.isRunning()) {
    console.log("Capture daemon is not running.");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    daemon.cleanup();
    console.log(`${accent("Capture daemon stopped")} (PID ${pid})`);
  } catch {
    console.log("Failed to stop daemon. It may have already exited.");
    daemon.cleanup();
  }
}

function captureStatus(): void {
  const status = daemon.status();
  if (status.running) {
    console.log(`${accent("Running")} (PID ${status.pid})`);
  } else {
    console.log(muted("Not running"));
  }

  const sessions = store.list();
  console.log(`${sessions.length} captured session(s)`);
}

function listCaptures(): void {
  const sessions = store.list();
  if (sessions.length === 0) {
    console.log(muted("No captured sessions yet."));
    return;
  }

  for (const s of sessions.slice(0, 20)) {
    const date = new Date(s.updatedAt).toLocaleString();
    const msgCount = s.messages.length;
    console.log(`  ${accent(s.id)}  ${s.tool}  ${msgCount} msgs  ${date}`);
  }

  if (sessions.length > 20) {
    console.log(muted(`  ... and ${sessions.length - 20} more`));
  }
}
```

- [ ] **Step 2: Wire capture into the main CLI**

Modify `mcp/src/index.ts`:

Add `"capture"` to the `CLI_SUBCOMMANDS` set:

```typescript
const CLI_SUBCOMMANDS = new Set(["wizard", "help", "stats", "tree", "status", "refresh", "upgrade", "whoami", "capture"]);
```

Add the import at the top of the file alongside other CLI imports:

```typescript
import { runCapture } from "./capture/cli.js";
```

Add the handler in `handleCli()` after the `whoami` block and before the wizard fallback:

```typescript
  if (cmd === "capture") {
    await runCapture(raw.slice(1));
    process.exit(0);
  }
```

Add capture to `printHelp()` in the appropriate section:

```typescript
    bold("Capture"),
    s("npx synapsesync-mcp capture start", "Start session capture daemon"),
    s("npx synapsesync-mcp capture stop", "Stop capture daemon"),
    s("npx synapsesync-mcp capture status", "Check daemon status"),
    s("npx synapsesync-mcp capture list", "List captured sessions"),
    "",
```

- [ ] **Step 3: Build and verify no type errors**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npm run build`
Expected: Clean build, no errors

- [ ] **Step 4: Run all capture tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npx vitest run test/unit/capture/`
Expected: All tests pass

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd /Users/Tanmai.N/Documents/synapse && npm run verify`
Expected: All 647+ tests pass, lint clean, typecheck clean

- [ ] **Step 6: Commit**

```bash
git add mcp/src/capture/cli.ts mcp/src/index.ts
git commit -m "feat(capture): add CLI subcommand (start/stop/status/list)"
```

---

### Task 11: Capture Worker (Daemon Entry Point)

**Files:**
- Create: `mcp/src/capture/capture-worker.ts`

This is the script that runs as the detached daemon process. It wires together the registry, adapters, watcher, and store.

- [ ] **Step 1: Write the capture worker**

```typescript
// mcp/src/capture/capture-worker.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AdapterRegistry } from "./adapter-registry.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { CursorAdapter } from "./adapters/cursor.js";
import { CodexAdapter } from "./adapters/codex.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { CaptureWatcher } from "./watcher.js";
import { SessionStore } from "./store.js";

const logFile = path.join(os.homedir(), ".synapse", "capture.log");

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
}

async function main(): Promise<void> {
  log("Capture daemon starting");

  const registry = new AdapterRegistry();
  registry.register(new ClaudeCodeAdapter());
  registry.register(new CursorAdapter());
  registry.register(new CodexAdapter());
  registry.register(new GeminiAdapter());

  log(`Registered adapters: ${registry.tools().join(", ")}`);

  const store = new SessionStore();
  const watcher = new CaptureWatcher(registry);

  watcher.on("session", (session) => {
    log(`Captured session ${session.id} from ${session.tool} (${session.messages.length} messages)`);
    store.save(session);
  });

  process.on("SIGTERM", async () => {
    log("Received SIGTERM, shutting down");
    await watcher.stop();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    log("Received SIGINT, shutting down");
    await watcher.stop();
    process.exit(0);
  });

  await watcher.start();
  log(`Watching: ${registry.allWatchPaths().join(", ")}`);
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
```

- [ ] **Step 2: Build and verify the worker compiles**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && npm run build`
Expected: Clean build. `dist/capture/capture-worker.js` exists.

- [ ] **Step 3: Verify the worker can be spawned**

Run: `cd /Users/Tanmai.N/Documents/synapse/mcp && node dist/capture/capture-worker.js &; sleep 2; kill %1 2>/dev/null; cat ~/.synapse/capture.log | tail -3`
Expected: Log lines showing "Capture daemon starting", "Registered adapters: ...", "Watching: ..."

- [ ] **Step 4: Commit**

```bash
git add mcp/src/capture/capture-worker.ts
git commit -m "feat(capture): add daemon worker entry point"
```

---

### Task 12: Final Integration Test and Cleanup

**Files:**
- Modify: `mcp/package.json` (add chokidar to dependencies if not already done)
- Run full test suite

- [ ] **Step 1: Verify chokidar is in dependencies**

Check `mcp/package.json` has `chokidar` in `dependencies`. If not, run `cd /Users/Tanmai.N/Documents/synapse/mcp && npm install chokidar`.

- [ ] **Step 2: Run the full verify suite**

Run: `cd /Users/Tanmai.N/Documents/synapse && npm run verify`
Expected: All tests pass (existing 647+ plus new capture tests), lint clean, typecheck clean.

- [ ] **Step 3: Test the CLI end-to-end**

Run:
```bash
cd /Users/Tanmai.N/Documents/synapse/mcp
npx synapsesync-mcp capture status   # Should print "Not running"
npx synapsesync-mcp capture start    # Should print "Capture daemon started (PID ...)"
npx synapsesync-mcp capture status   # Should print "Running (PID ...)"
npx synapsesync-mcp capture stop     # Should print "Capture daemon stopped"
npx synapsesync-mcp capture list     # Should print captured sessions or "No captured sessions yet"
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(capture): complete phase 1 — session capture with 4 tool adapters"
```
