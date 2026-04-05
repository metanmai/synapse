# Capture Adapters Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cline, Roo Code, and Copilot CLI capture adapters to expand tool coverage from 4 to 7.

**Architecture:** Each adapter is a self-contained file implementing the existing `ToolAdapter` interface (`tool`, `watchPaths()`, `parse()`). They register in `capture-worker.ts` and integrate with the existing watcher/store/daemon pipeline with zero structural changes.

**Tech Stack:** TypeScript, Vitest, chokidar (existing), Node.js fs/os/path

---

## File Structure

| File | Responsibility |
|------|---------------|
| `mcp/src/capture/types.ts` | Widen tool union + VALID_TOOLS set |
| `mcp/src/capture/capture-worker.ts` | Register 3 new adapters |
| `mcp/src/capture/adapters/cline.ts` | Cline adapter (VS Code globalStorage, Anthropic JSON) |
| `mcp/src/capture/adapters/roo-code.ts` | Roo Code adapter (VS Code globalStorage, Anthropic JSON) |
| `mcp/src/capture/adapters/copilot-cli.ts` | Copilot CLI adapter (~/.copilot/session-state, JSONL events) |
| `mcp/test/e2e/capture-pipeline.test.ts` | E2E + pipeline tests for all 3 new adapters |

---

### Task 1: Widen types to support 7 tools

**Files:**
- Modify: `mcp/src/capture/types.ts:14-17` (CapturedSession.tool union)
- Modify: `mcp/src/capture/types.ts:39` (VALID_TOOLS set)

- [ ] **Step 1: Update the tool union in CapturedSession**

In `mcp/src/capture/types.ts`, change line 16 from:

```typescript
  tool: "claude-code" | "cursor" | "codex" | "gemini";
```

to:

```typescript
  tool: "claude-code" | "cursor" | "codex" | "gemini" | "copilot-cli" | "cline" | "roo-code";
```

- [ ] **Step 2: Update VALID_TOOLS set**

In `mcp/src/capture/types.ts`, change line 39 from:

```typescript
const VALID_TOOLS = new Set(["claude-code", "cursor", "codex", "gemini"]);
```

to:

```typescript
const VALID_TOOLS = new Set(["claude-code", "cursor", "codex", "gemini", "copilot-cli", "cline", "roo-code"]);
```

- [ ] **Step 3: Run typecheck to verify no regressions**

Run: `cd mcp && npx tsc --noEmit`
Expected: PASS — no errors. The union is wider, so all existing code still compiles.

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `cd mcp && npx vitest run`
Expected: All existing tests pass. The only test that checks tool names (`"all four tools are valid"`) will still pass because the valid set is a superset.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/capture/types.ts
git commit -m "feat(capture): widen tool union to support 7 tools"
```

---

### Task 2: Cline adapter with E2E tests

**Files:**
- Create: `mcp/src/capture/adapters/cline.ts`
- Modify: `mcp/test/e2e/capture-pipeline.test.ts` (add fixture data + E2E tests + pipeline test)

- [ ] **Step 1: Add Cline fixture data to E2E test file**

At the top of `mcp/test/e2e/capture-pipeline.test.ts`, after the existing `GEMINI_JSON` fixture (around line 163), add:

```typescript
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
      { type: "tool_use", id: "toolu_02", name: "write_to_file", input: { path: "src/middleware/rate-limit.ts", content: "..." } },
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
```

- [ ] **Step 2: Add Cline adapter E2E describe block**

After the existing `"Gemini Adapter E2E"` describe block (around line 623), add:

```typescript
  /* ------------------------------------------------------------------ */
  /*  Cline Adapter E2E                                                 */
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
      fs.writeFileSync(path.join(taskDir, "api_conversation_history.json"), CLINE_JSON);

      const adapter = new ClineAdapter();
      adapter.watchPaths = () => [adapterTmp];
      const session = adapter.parse(path.join(taskDir, "api_conversation_history.json"));

      expect(session).not.toBeNull();
      expect(session!.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(session!.tool).toBe("cline");
      // 6 messages in fixture: 1 user, 1 assistant+tool, 1 tool_result(skip), 1 assistant+tool, 1 tool_result(skip), 1 assistant
      // = 1 user + 3 assistant = 4 messages (2 tool_result user messages skipped)
      expect(session!.messages.length).toBe(4);
      expect(session!.messages[0].role).toBe("user");
      expect(session!.messages[0].content).toBe("add rate limiting to the API");
      expect(session!.messages[1].role).toBe("assistant");
      expect(session!.messages[1].toolCalls).toBeDefined();
      expect(session!.messages[1].toolCalls![0].name).toBe("read_file");
    });

    it("returns null for non-JSON files", () => {
      const file = path.join(adapterTmp, "session.jsonl");
      fs.writeFileSync(file, "not json");

      const adapter = new ClineAdapter();
      adapter.watchPaths = () => [adapterTmp];
      expect(adapter.parse(file)).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      const taskDir = path.join(adapterTmp, "bad-task");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, "api_conversation_history.json"), "{not an array}");

      const adapter = new ClineAdapter();
      adapter.watchPaths = () => [adapterTmp];
      expect(adapter.parse(path.join(taskDir, "api_conversation_history.json"))).toBeNull();
    });

    it("returns null for empty message array", () => {
      const taskDir = path.join(adapterTmp, "empty-task");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, "api_conversation_history.json"), "[]");

      const adapter = new ClineAdapter();
      adapter.watchPaths = () => [adapterTmp];
      expect(adapter.parse(path.join(taskDir, "api_conversation_history.json"))).toBeNull();
    });
  });
```

- [ ] **Step 3: Add Cline full pipeline test**

Inside the `"Full Pipeline: file change to session captured"` describe block (after the Gemini pipeline test, around line 406), add:

```typescript
    it("Cline: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "cline-tasks");
      const taskDir = path.join(watchDir, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      fs.mkdirSync(taskDir, { recursive: true });
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
```

- [ ] **Step 4: Add the ClineAdapter import to the test file**

At the top of `mcp/test/e2e/capture-pipeline.test.ts`, after the GeminiAdapter import, add:

```typescript
import { ClineAdapter } from "../../src/capture/adapters/cline.js";
```

- [ ] **Step 5: Run the E2E tests to verify they fail**

Run: `cd mcp && TEST_E2E=1 npx vitest run test/e2e/capture-pipeline.test.ts`
Expected: FAIL — `ClineAdapter` does not exist yet.

- [ ] **Step 6: Create the Cline adapter**

Create `mcp/src/capture/adapters/cline.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface ClineMessage {
  role: string;
  content: ContentBlock[];
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("\n");
}

function extractToolCalls(content: ContentBlock[]): { name: string; input?: string }[] {
  return content
    .filter((c) => c.type === "tool_use" && c.name)
    .map((c) => ({
      name: c.name as string,
      input: c.input !== undefined ? JSON.stringify(c.input) : undefined,
    }));
}

function isToolResultOnly(msg: ClineMessage): boolean {
  return msg.role === "user" && msg.content.every((c) => c.type === "tool_result");
}

export class ClineAdapter implements ToolAdapter {
  tool = "cline";

  watchPaths(): string[] {
    const base =
      process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "tasks")
        : path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "tasks");
    return [base];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".json")) return null;
    if (!path.basename(filePath).startsWith("api_conversation_history")) return null;

    const raw = safeReadFile(filePath);
    if (!raw) return null;

    let conversation: ClineMessage[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      conversation = parsed as ClineMessage[];
    } catch {
      return null;
    }

    if (conversation.length === 0) return null;

    // Extract task ID from directory name (parent of the JSON file)
    const taskId = path.basename(path.dirname(filePath));
    if (!taskId) return null;

    const messages: SessionMessage[] = [];
    const now = new Date().toISOString();

    for (const msg of conversation) {
      if (!msg.role || !Array.isArray(msg.content)) continue;
      if (isToolResultOnly(msg)) continue;

      const text = extractText(msg.content);
      const toolCalls = msg.role === "assistant" ? extractToolCalls(msg.content) : [];

      if (!text && toolCalls.length === 0) continue;

      messages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: text,
        timestamp: now,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    if (messages.length === 0) return null;

    // Try to get startedAt from taskHistory.json
    let startedAt = now;
    try {
      const historyPath = path.join(path.dirname(path.dirname(filePath)), "..", "state", "taskHistory.json");
      const historyRaw = fs.readFileSync(historyPath, "utf-8");
      const history = JSON.parse(historyRaw) as { id: string; ts: number }[];
      const match = history.find((h) => h.id === taskId);
      if (match?.ts) startedAt = new Date(match.ts).toISOString();
    } catch {
      // Fall back to file birthtime
      try {
        const stat = fs.statSync(filePath);
        startedAt = stat.birthtime.toISOString();
      } catch {
        // Use now as final fallback
      }
    }

    // updatedAt from file mtime
    let updatedAt = now;
    try {
      const stat = fs.statSync(filePath);
      updatedAt = stat.mtime.toISOString();
    } catch {
      // Use now as fallback
    }

    return {
      id: sessionIdFromNative(taskId),
      tool: "cline",
      projectPath: "unknown",
      startedAt,
      updatedAt,
      messages,
    };
  }
}
```

- [ ] **Step 7: Run the E2E tests to verify they pass**

Run: `cd mcp && TEST_E2E=1 npx vitest run test/e2e/capture-pipeline.test.ts`
Expected: All new Cline tests pass, all existing tests still pass.

- [ ] **Step 8: Run full test suite**

Run: `cd mcp && npx vitest run`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add mcp/src/capture/adapters/cline.ts mcp/test/e2e/capture-pipeline.test.ts
git commit -m "feat(capture): add Cline adapter with E2E tests"
```

---

### Task 3: Roo Code adapter with E2E tests

**Files:**
- Create: `mcp/src/capture/adapters/roo-code.ts`
- Modify: `mcp/test/e2e/capture-pipeline.test.ts` (add fixture data + E2E tests + pipeline test)

- [ ] **Step 1: Add Roo Code fixture data to E2E test file**

After the `CLINE_JSON` fixture, add:

```typescript
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
```

- [ ] **Step 2: Add Roo Code adapter E2E describe block**

After the Cline Adapter E2E describe block, add:

```typescript
  /* ------------------------------------------------------------------ */
  /*  Roo Code Adapter E2E                                              */
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
      const taskDir = path.join(adapterTmp, "f1e2d3c4-b5a6-0987-fedc-ba9876543210");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, "api_conversation_history.json"), ROO_CODE_JSON);

      const adapter = new RooCodeAdapter();
      adapter.watchPaths = () => [adapterTmp];
      const session = adapter.parse(path.join(taskDir, "api_conversation_history.json"));

      expect(session).not.toBeNull();
      expect(session!.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(session!.tool).toBe("roo-code");
      // 4 messages: 1 user, 1 assistant+tool, 1 tool_result(skip), 1 assistant = 3
      expect(session!.messages.length).toBe(3);
      expect(session!.messages[0].role).toBe("user");
      expect(session!.messages[1].role).toBe("assistant");
      expect(session!.messages[1].toolCalls).toBeDefined();
      expect(session!.messages[1].toolCalls![0].name).toBe("read_file");
      expect(session!.messages[2].role).toBe("assistant");
    });

    it("ignores Roo-specific extra fields without errors", () => {
      const rooExtended = JSON.stringify([
        {
          role: "user",
          content: [{ type: "text", text: "test" }],
          apiProtocol: "anthropic",
          isProtected: true,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "response" }],
          condenseParent: true,
          isSummary: false,
        },
      ]);

      const taskDir = path.join(adapterTmp, "aabb1122-3344-5566-7788-99aabbccddee");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, "api_conversation_history.json"), rooExtended);

      const adapter = new RooCodeAdapter();
      adapter.watchPaths = () => [adapterTmp];
      const session = adapter.parse(path.join(taskDir, "api_conversation_history.json"));

      expect(session).not.toBeNull();
      expect(session!.messages.length).toBe(2);
    });

    it("returns null for non-JSON files", () => {
      const file = path.join(adapterTmp, "session.jsonl");
      fs.writeFileSync(file, "not json");

      const adapter = new RooCodeAdapter();
      adapter.watchPaths = () => [adapterTmp];
      expect(adapter.parse(file)).toBeNull();
    });

    it("returns null for empty conversation", () => {
      const taskDir = path.join(adapterTmp, "empty-task");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, "api_conversation_history.json"), "[]");

      const adapter = new RooCodeAdapter();
      adapter.watchPaths = () => [adapterTmp];
      expect(adapter.parse(path.join(taskDir, "api_conversation_history.json"))).toBeNull();
    });
  });
```

- [ ] **Step 3: Add Roo Code full pipeline test**

Inside the `"Full Pipeline"` describe block, after the Cline pipeline test, add:

```typescript
    it("Roo Code: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "roo-code-tasks");
      const taskDir = path.join(watchDir, "f1e2d3c4-b5a6-0987-fedc-ba9876543210");
      fs.mkdirSync(taskDir, { recursive: true });
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
```

- [ ] **Step 4: Add the RooCodeAdapter import to the test file**

At the top of the test file, after the ClineAdapter import, add:

```typescript
import { RooCodeAdapter } from "../../src/capture/adapters/roo-code.js";
```

- [ ] **Step 5: Run E2E tests to verify they fail**

Run: `cd mcp && TEST_E2E=1 npx vitest run test/e2e/capture-pipeline.test.ts`
Expected: FAIL — `RooCodeAdapter` does not exist yet.

- [ ] **Step 6: Create the Roo Code adapter**

Create `mcp/src/capture/adapters/roo-code.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface RooCodeMessage {
  role: string;
  content: ContentBlock[];
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("\n");
}

function extractToolCalls(content: ContentBlock[]): { name: string; input?: string }[] {
  return content
    .filter((c) => c.type === "tool_use" && c.name)
    .map((c) => ({
      name: c.name as string,
      input: c.input !== undefined ? JSON.stringify(c.input) : undefined,
    }));
}

function isToolResultOnly(msg: RooCodeMessage): boolean {
  return msg.role === "user" && msg.content.every((c) => c.type === "tool_result");
}

export class RooCodeAdapter implements ToolAdapter {
  tool = "roo-code";

  watchPaths(): string[] {
    const base =
      process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "tasks")
        : path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "tasks");
    return [base];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".json")) return null;
    if (!path.basename(filePath).startsWith("api_conversation_history")) return null;

    const raw = safeReadFile(filePath);
    if (!raw) return null;

    let conversation: RooCodeMessage[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      conversation = parsed as RooCodeMessage[];
    } catch {
      return null;
    }

    if (conversation.length === 0) return null;

    const taskId = path.basename(path.dirname(filePath));
    if (!taskId) return null;

    const messages: SessionMessage[] = [];
    const now = new Date().toISOString();

    for (const msg of conversation) {
      if (!msg.role || !Array.isArray(msg.content)) continue;
      if (isToolResultOnly(msg)) continue;

      const text = extractText(msg.content);
      const toolCalls = msg.role === "assistant" ? extractToolCalls(msg.content) : [];

      if (!text && toolCalls.length === 0) continue;

      messages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: text,
        timestamp: now,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    if (messages.length === 0) return null;

    let startedAt = now;
    try {
      const historyPath = path.join(path.dirname(path.dirname(filePath)), "..", "state", "taskHistory.json");
      const historyRaw = fs.readFileSync(historyPath, "utf-8");
      const history = JSON.parse(historyRaw) as { id: string; ts: number }[];
      const match = history.find((h) => h.id === taskId);
      if (match?.ts) startedAt = new Date(match.ts).toISOString();
    } catch {
      try {
        const stat = fs.statSync(filePath);
        startedAt = stat.birthtime.toISOString();
      } catch {
        // Use now as final fallback
      }
    }

    let updatedAt = now;
    try {
      const stat = fs.statSync(filePath);
      updatedAt = stat.mtime.toISOString();
    } catch {
      // Use now as fallback
    }

    return {
      id: sessionIdFromNative(taskId),
      tool: "roo-code",
      projectPath: "unknown",
      startedAt,
      updatedAt,
      messages,
    };
  }
}
```

- [ ] **Step 7: Run E2E tests to verify they pass**

Run: `cd mcp && TEST_E2E=1 npx vitest run test/e2e/capture-pipeline.test.ts`
Expected: All Roo Code tests pass, all existing tests still pass.

- [ ] **Step 8: Run full test suite**

Run: `cd mcp && npx vitest run`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add mcp/src/capture/adapters/roo-code.ts mcp/test/e2e/capture-pipeline.test.ts
git commit -m "feat(capture): add Roo Code adapter with E2E tests"
```

---

### Task 4: Copilot CLI adapter with E2E tests

**Files:**
- Create: `mcp/src/capture/adapters/copilot-cli.ts`
- Modify: `mcp/test/e2e/capture-pipeline.test.ts` (add fixture data + E2E tests + pipeline test)

- [ ] **Step 1: Add Copilot CLI fixture data to E2E test file**

After the `ROO_CODE_JSON` fixture, add:

```typescript
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
  'CORRUPT LINE \u2028 WITH UNICODE',
].join("\n");
```

- [ ] **Step 2: Add Copilot CLI adapter E2E describe block**

After the Roo Code Adapter E2E describe block, add:

```typescript
  /* ------------------------------------------------------------------ */
  /*  Copilot CLI Adapter E2E                                           */
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
      const sessionDir = path.join(adapterTmp, "abc123-session-id");
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, "events.jsonl"), COPILOT_CLI_JSONL);

      const adapter = new CopilotCliAdapter();
      adapter.watchPaths = () => [adapterTmp];
      const session = adapter.parse(path.join(sessionDir, "events.jsonl"));

      expect(session).not.toBeNull();
      expect(session!.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(session!.tool).toBe("copilot-cli");
      expect(session!.projectPath).toBe("/tmp/copilot-proj");
      // 2 user.message + 2 assistant.message = 4 messages
      expect(session!.messages.length).toBe(4);
      expect(session!.messages[0].role).toBe("user");
      expect(session!.messages[0].content).toBe("set up CI pipeline");
      expect(session!.messages[1].role).toBe("assistant");
      expect(session!.messages[1].toolCalls).toBeDefined();
      expect(session!.messages[1].toolCalls![0].name).toBe("read_file");
      expect(session!.messages[2].role).toBe("user");
      expect(session!.messages[3].role).toBe("assistant");
      expect(session!.startedAt).toBe("2026-04-02T10:00:00Z");
      expect(session!.updatedAt).toBe("2026-04-02T10:00:11Z");
    });

    it("handles U+2028/U+2029 Unicode sanitization", () => {
      const jsonlWithUnicode = [
        '{"type":"session.start","data":{"cwd":"/tmp/proj"},"id":"e1","timestamp":"2026-04-02T10:00:00Z","parentId":null}',
        '{"type":"user.message","data":{"content":"hello"},"id":"e2","timestamp":"2026-04-02T10:00:01Z","parentId":"e1"}',
        `{"type":"assistant.message","data":{"content":"line1\u2028line2\u2029line3"},"id":"e3","timestamp":"2026-04-02T10:00:02Z","parentId":"e2"}`,
      ].join("\n");

      const sessionDir = path.join(adapterTmp, "unicode-session");
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, "events.jsonl"), jsonlWithUnicode);

      const adapter = new CopilotCliAdapter();
      adapter.watchPaths = () => [adapterTmp];
      const session = adapter.parse(path.join(sessionDir, "events.jsonl"));

      expect(session).not.toBeNull();
      expect(session!.messages.length).toBe(2);
      expect(session!.messages[1].content).toContain("line1");
    });

    it("tracks parse errors for corrupt JSONL lines", () => {
      const sessionDir = path.join(adapterTmp, "corrupt-session");
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, "events.jsonl"), COPILOT_CLI_JSONL);

      const adapter = new CopilotCliAdapter();
      adapter.watchPaths = () => [adapterTmp];
      const session = adapter.parse(path.join(sessionDir, "events.jsonl"));

      expect(session).not.toBeNull();
      expect(session!.parseErrors).toBeDefined();
      expect(session!.parseErrors!.length).toBe(1);
      expect(session!.parseErrors![0]).toMatch(/Line 10/);
    });

    it("returns null for non-JSONL files", () => {
      const file = path.join(adapterTmp, "chat.json");
      fs.writeFileSync(file, "{}");

      const adapter = new CopilotCliAdapter();
      adapter.watchPaths = () => [adapterTmp];
      expect(adapter.parse(file)).toBeNull();
    });

    it("returns null when no user or assistant messages exist", () => {
      const jsonl = [
        '{"type":"session.start","data":{"cwd":"/tmp"},"id":"e1","timestamp":"2026-04-02T10:00:00Z","parentId":null}',
        '{"type":"session.info","data":{"version":"1.0"},"id":"e2","timestamp":"2026-04-02T10:00:01Z","parentId":"e1"}',
      ].join("\n");

      const sessionDir = path.join(adapterTmp, "empty-session");
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, "events.jsonl"), jsonl);

      const adapter = new CopilotCliAdapter();
      adapter.watchPaths = () => [adapterTmp];
      expect(adapter.parse(path.join(sessionDir, "events.jsonl"))).toBeNull();
    });
  });
```

- [ ] **Step 3: Add Copilot CLI full pipeline test**

Inside the `"Full Pipeline"` describe block, after the Roo Code pipeline test, add:

```typescript
    it("Copilot CLI: file -> watcher -> adapter -> store", async () => {
      const watchDir = path.join(pipelineTmp, "copilot-sessions");
      const sessionDir = path.join(watchDir, "abc123-session-id");
      fs.mkdirSync(sessionDir, { recursive: true });
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
```

- [ ] **Step 4: Add the CopilotCliAdapter import to the test file**

At the top of the test file, after the RooCodeAdapter import, add:

```typescript
import { CopilotCliAdapter } from "../../src/capture/adapters/copilot-cli.js";
```

- [ ] **Step 5: Run E2E tests to verify they fail**

Run: `cd mcp && TEST_E2E=1 npx vitest run test/e2e/capture-pipeline.test.ts`
Expected: FAIL — `CopilotCliAdapter` does not exist yet.

- [ ] **Step 6: Create the Copilot CLI adapter**

Create `mcp/src/capture/adapters/copilot-cli.ts`:

```typescript
import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

interface CopilotEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
}

/**
 * Strip U+2028 (Line Separator) and U+2029 (Paragraph Separator) from a string.
 * Copilot CLI tool output may contain these raw Unicode characters which break
 * JSONL parsing since they are valid line terminators in Unicode but not in JSON.
 */
function sanitizeJsonlLine(line: string): string {
  return line.replace(/[\u2028\u2029]/g, " ");
}

export class CopilotCliAdapter implements ToolAdapter {
  tool = "copilot-cli";

  watchPaths(): string[] {
    return [path.join(os.homedir(), ".copilot", "session-state")];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".jsonl")) return null;
    if (path.basename(filePath) !== "events.jsonl") return null;

    const raw = safeReadFile(filePath);
    if (!raw) return null;

    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    let projectPath: string | null = null;
    let startedAt: string | null = null;
    let updatedAt: string | null = null;
    const messages: SessionMessage[] = [];
    const parseErrors: string[] = [];
    const pendingToolCalls: { name: string; input?: string; output?: string }[] = [];

    for (const [index, rawLine] of lines.entries()) {
      const line = sanitizeJsonlLine(rawLine);

      let event: CopilotEvent;
      try {
        event = JSON.parse(line) as CopilotEvent;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        parseErrors.push(`Line ${index + 1}: ${msg}`);
        continue;
      }

      if (!startedAt && event.timestamp) startedAt = event.timestamp;
      if (event.timestamp) updatedAt = event.timestamp;

      switch (event.type) {
        case "session.start": {
          const cwd = event.data.cwd as string | undefined;
          if (cwd && !projectPath) projectPath = cwd;
          break;
        }

        case "user.message": {
          const content = event.data.content as string | undefined;
          if (content) {
            messages.push({
              role: "user",
              content,
              timestamp: event.timestamp,
            });
          }
          break;
        }

        case "assistant.message": {
          const content = event.data.content as string | undefined;
          if (content) {
            const msg: SessionMessage = {
              role: "assistant",
              content,
              timestamp: event.timestamp,
            };
            if (pendingToolCalls.length > 0) {
              msg.toolCalls = [...pendingToolCalls];
              pendingToolCalls.length = 0;
            }
            messages.push(msg);
          }
          break;
        }

        case "tool.execution_start":
        case "tool.execution_complete": {
          const name = event.data.name as string | undefined;
          if (name) {
            const existing = pendingToolCalls.find((t) => t.name === name);
            if (existing) {
              if (event.type === "tool.execution_complete" && event.data.output) {
                existing.output = String(event.data.output);
              }
            } else {
              pendingToolCalls.push({
                name,
                input: event.data.input ? JSON.stringify(event.data.input) : undefined,
                output: event.data.output ? String(event.data.output) : undefined,
              });
            }
          }
          break;
        }

        default:
          // Skip session.info, session.resume, session.error, assistant.turn_start/end, etc.
          break;
      }
    }

    // Extract session ID from the directory name
    const sessionDirName = path.basename(path.dirname(filePath));
    if (!sessionDirName || messages.length === 0) return null;

    return {
      id: sessionIdFromNative(sessionDirName),
      tool: "copilot-cli",
      projectPath: projectPath ?? "unknown",
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
      messages,
      ...(parseErrors.length > 0 ? { parseErrors } : {}),
    };
  }
}
```

- [ ] **Step 7: Run E2E tests to verify they pass**

Run: `cd mcp && TEST_E2E=1 npx vitest run test/e2e/capture-pipeline.test.ts`
Expected: All Copilot CLI tests pass, all existing tests still pass.

- [ ] **Step 8: Run full test suite**

Run: `cd mcp && npx vitest run`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add mcp/src/capture/adapters/copilot-cli.ts mcp/test/e2e/capture-pipeline.test.ts
git commit -m "feat(capture): add Copilot CLI adapter with E2E tests"
```

---

### Task 5: Register adapters in daemon and update validation test

**Files:**
- Modify: `mcp/src/capture/capture-worker.ts:5-8,24-27` (add imports + registrations)
- Modify: `mcp/test/e2e/capture-pipeline.test.ts:1106-1118` (update validation test)

- [ ] **Step 1: Add imports to capture-worker.ts**

In `mcp/src/capture/capture-worker.ts`, after line 8 (`import { GeminiAdapter }`), add:

```typescript
import { ClineAdapter } from "./adapters/cline.js";
import { RooCodeAdapter } from "./adapters/roo-code.js";
import { CopilotCliAdapter } from "./adapters/copilot-cli.js";
```

- [ ] **Step 2: Register new adapters**

In `mcp/src/capture/capture-worker.ts`, after line 27 (`registry.register(new GeminiAdapter())`), add:

```typescript
  registry.register(new ClineAdapter());
  registry.register(new RooCodeAdapter());
  registry.register(new CopilotCliAdapter());
```

- [ ] **Step 3: Update the validation test**

In `mcp/test/e2e/capture-pipeline.test.ts`, change the test at line 1106 from:

```typescript
    it("all four tools are valid", () => {
      for (const tool of ["claude-code", "cursor", "codex", "gemini"]) {
```

to:

```typescript
    it("all seven tools are valid", () => {
      for (const tool of ["claude-code", "cursor", "codex", "gemini", "copilot-cli", "cline", "roo-code"]) {
```

- [ ] **Step 4: Run full E2E tests**

Run: `cd mcp && TEST_E2E=1 npx vitest run test/e2e/capture-pipeline.test.ts`
Expected: All tests pass including the updated validation test.

- [ ] **Step 5: Run typecheck**

Run: `cd mcp && npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 6: Run lint**

Run: `cd mcp && npx biome check .`
Expected: No new errors (warnings are OK).

- [ ] **Step 7: Run full test suite**

Run: `cd mcp && npx vitest run`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add mcp/src/capture/capture-worker.ts mcp/test/e2e/capture-pipeline.test.ts
git commit -m "feat(capture): register Cline, Roo Code, Copilot CLI adapters in daemon"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full verify pipeline**

Run: `cd mcp && npm run verify`
Expected: lint + typecheck + all tests pass.

- [ ] **Step 2: Verify adapter count in daemon log**

Run: `cd mcp && node -e "
const { AdapterRegistry } = require('./dist/capture/adapter-registry.js');
const { ClaudeCodeAdapter } = require('./dist/capture/adapters/claude-code.js');
const { CursorAdapter } = require('./dist/capture/adapters/cursor.js');
const { CodexAdapter } = require('./dist/capture/adapters/codex.js');
const { GeminiAdapter } = require('./dist/capture/adapters/gemini.js');
const { ClineAdapter } = require('./dist/capture/adapters/cline.js');
const { RooCodeAdapter } = require('./dist/capture/adapters/roo-code.js');
const { CopilotCliAdapter } = require('./dist/capture/adapters/copilot-cli.js');
const r = new AdapterRegistry();
[new ClaudeCodeAdapter(), new CursorAdapter(), new CodexAdapter(), new GeminiAdapter(), new ClineAdapter(), new RooCodeAdapter(), new CopilotCliAdapter()].forEach(a => r.register(a));
console.log('Tools:', r.tools().join(', '));
console.log('Count:', r.tools().length);
console.log('Watch paths:', r.allWatchPaths().length);
"`

Expected output:
```
Tools: claude-code, cursor, codex, gemini, cline, roo-code, copilot-cli
Count: 7
Watch paths: 7
```

(Note: build first with `npm run build` if dist/ is stale)

- [ ] **Step 3: Commit any final fixes if needed, then push**

```bash
git push
```
