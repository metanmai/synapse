# Distiller (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract structured knowledge (decisions, architecture, learnings) from captured sessions using an LLM, and write the results to the Synapse workspace via the existing write API.

**Architecture:** The distiller reads a `CapturedSession` from the local store, builds a prompt, calls an LLM (Anthropic, OpenAI, or Google), parses the structured JSON response into markdown files, and writes them via the Synapse API. Provider abstraction lets users choose their preferred LLM. The distiller is a pure function: session in, knowledge files out.

**Tech Stack:** TypeScript, Node.js native fetch, Anthropic/OpenAI/Google REST APIs, vitest

---

## File Structure

```
mcp/src/distill/
  index.ts              — distill() entry point, orchestrates prompt → LLM → parse → write
  prompt.ts             — builds the extraction prompt from a CapturedSession
  parser.ts             — parses structured JSON from LLM response into file objects
  providers/
    types.ts            — LLMProvider interface
    anthropic.ts        — Anthropic Messages API client
    openai.ts           — OpenAI Chat Completions API client
    google.ts           — Google Gemini API client
    registry.ts         — provider lookup by name
  writer.ts             — writes extracted files to Synapse via existing API
mcp/src/distill/cli.ts  — distill CLI subcommand handler

mcp/test/unit/distill/
  prompt.test.ts        — prompt construction tests
  parser.test.ts        — response parsing tests
  providers.test.ts     — provider tests (mocked fetch)
  writer.test.ts        — writer tests (mocked fetch)
  index.test.ts         — integration test of the full distill pipeline (all mocked)
```

---

### Task 1: Distill Types and Prompt Builder

**Files:**
- Create: `mcp/src/distill/prompt.ts`
- Create: `mcp/test/unit/distill/prompt.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// mcp/test/unit/distill/prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../../src/distill/prompt.js";
import type { CapturedSession } from "../../../src/capture/types.js";

function makeSession(messageCount: number): CapturedSession {
  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    messages.push({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i + 1} content here`,
      timestamp: `2026-04-02T10:${String(i).padStart(2, "0")}:00Z`,
    });
  }
  return {
    id: "ses_test1234567890",
    tool: "claude-code",
    projectPath: "/tmp/project",
    startedAt: "2026-04-02T10:00:00Z",
    updatedAt: "2026-04-02T10:30:00Z",
    messages,
  };
}

describe("buildPrompt", () => {
  it("includes the session transcript in the prompt", () => {
    const session = makeSession(4);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("Message 1 content here");
    expect(prompt).toContain("Message 4 content here");
  });

  it("includes role labels for each message", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("[user]");
    expect(prompt).toContain("[assistant]");
  });

  it("instructs extraction of decisions, architecture, and learnings", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("decision");
    expect(prompt).toContain("architecture");
    expect(prompt).toContain("learning");
  });

  it("requests JSON output format", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("JSON");
  });

  it("includes existing workspace files when provided", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session, ["decisions/chose-redis.md", "architecture/auth.md"]);
    expect(prompt).toContain("chose-redis.md");
    expect(prompt).toContain("auth.md");
  });

  it("includes session metadata", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("claude-code");
    expect(prompt).toContain("/tmp/project");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write the prompt builder**

```typescript
// mcp/src/distill/prompt.ts
import type { CapturedSession } from "../capture/types.js";

export function buildPrompt(session: CapturedSession, existingFiles?: string[]): string {
  const transcript = session.messages
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n\n");

  const existingSection = existingFiles?.length
    ? `\n## Existing workspace files (do not duplicate these):\n${existingFiles.map((f) => `- ${f}`).join("\n")}\n`
    : "";

  return `You are analyzing an AI coding session to extract valuable knowledge.

## Session metadata
- Tool: ${session.tool}
- Project: ${session.projectPath}
- Started: ${session.startedAt}
- Messages: ${session.messages.length}
${existingSection}
## Task

Read the transcript below and extract any non-trivial insights into structured files. Only extract things worth remembering — skip trivial exchanges, small fixes, and routine operations.

Extract into three categories:

1. **Decisions** — choices made and their reasoning. Path: \`decisions/<topic-slug>.md\`
2. **Architecture** — system design, data flow, component descriptions. Path: \`architecture/<topic-slug>.md\`
3. **Learnings** — gotchas, debugging insights, surprising discoveries. Path: \`learnings/<topic-slug>.md\`

If the session contains nothing worth extracting in a category, omit it.

## Output format

Respond with ONLY a JSON array. No markdown fencing, no explanation. Each element:

\`\`\`
{
  "path": "decisions/chose-session-cookies.md",
  "content": "# Chose Session Cookies\\n\\nWe chose session cookies over JWT because...",
  "tags": ["decision", "auth"]
}
\`\`\`

If nothing is worth extracting, respond with an empty array: \`[]\`

## Transcript

${transcript}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```
feat(distill): add prompt builder for knowledge extraction
```

---

### Task 2: Response Parser

**Files:**
- Create: `mcp/src/distill/parser.ts`
- Create: `mcp/test/unit/distill/parser.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// mcp/test/unit/distill/parser.test.ts
import { describe, expect, it } from "vitest";
import { parseResponse } from "../../../src/distill/parser.js";

describe("parseResponse", () => {
  it("parses a valid JSON array of files", () => {
    const raw = JSON.stringify([
      { path: "decisions/chose-redis.md", content: "# Chose Redis\n\nBecause...", tags: ["decision"] },
      { path: "learnings/cf-cookies.md", content: "# CF Workers Cookies\n\nGotcha...", tags: ["learning"] },
    ]);
    const result = parseResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("decisions/chose-redis.md");
    expect(result[0].content).toContain("Chose Redis");
    expect(result[0].tags).toEqual(["decision"]);
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseResponse("[]")).toEqual([]);
  });

  it("strips markdown code fencing if present", () => {
    const raw = "```json\n" + JSON.stringify([{ path: "decisions/x.md", content: "# X", tags: [] }]) + "\n```";
    const result = parseResponse(raw);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for unparseable response", () => {
    expect(parseResponse("This is not JSON at all")).toEqual([]);
  });

  it("filters out entries with missing path or content", () => {
    const raw = JSON.stringify([
      { path: "decisions/good.md", content: "# Good", tags: [] },
      { path: "", content: "no path", tags: [] },
      { content: "also no path", tags: [] },
      { path: "learnings/no-content.md", tags: [] },
    ]);
    const result = parseResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("decisions/good.md");
  });

  it("defaults tags to empty array if missing", () => {
    const raw = JSON.stringify([{ path: "decisions/x.md", content: "# X" }]);
    const result = parseResponse(raw);
    expect(result[0].tags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write the parser**

```typescript
// mcp/src/distill/parser.ts

export interface ExtractedFile {
  path: string;
  content: string;
  tags: string[];
}

export function parseResponse(raw: string): ExtractedFile[] {
  // Strip markdown code fencing if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return typeof e.path === "string" && e.path.length > 0 && typeof e.content === "string" && e.content.length > 0;
    })
    .map((entry: unknown) => {
      const e = entry as Record<string, unknown>;
      return {
        path: e.path as string,
        content: e.content as string,
        tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
      };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```
feat(distill): add response parser for LLM extraction output
```

---

### Task 3: LLM Provider Interface and Anthropic Provider

**Files:**
- Create: `mcp/src/distill/providers/types.ts`
- Create: `mcp/src/distill/providers/anthropic.ts`
- Create: `mcp/src/distill/providers/registry.ts`
- Create: `mcp/test/unit/distill/providers.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// mcp/test/unit/distill/providers.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../../../src/distill/providers/anthropic.js";
import { getProvider } from "../../../src/distill/providers/registry.js";

describe("AnthropicProvider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends correct headers and body to Anthropic API", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "[]" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new AnthropicProvider("sk-ant-test", "claude-sonnet-4-6");
    await provider.complete("test prompt");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((opts as RequestInit).method).toBe("POST");

    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBeDefined();

    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.messages[0].content).toBe("test prompt");
  });

  it("extracts text from response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: '[{"path":"decisions/x.md","content":"# X","tags":[]}]' }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new AnthropicProvider("sk-ant-test", "claude-sonnet-4-6");
    const result = await provider.complete("test");
    expect(result).toContain("decisions/x.md");
  });

  it("throws on API error", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const provider = new AnthropicProvider("bad-key", "claude-sonnet-4-6");
    await expect(provider.complete("test")).rejects.toThrow();
  });
});

describe("getProvider", () => {
  it("returns AnthropicProvider for 'anthropic'", () => {
    const provider = getProvider("anthropic", "test-key", "claude-sonnet-4-6");
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("throws for unknown provider", () => {
    expect(() => getProvider("unknown", "key", "model")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write the provider types**

```typescript
// mcp/src/distill/providers/types.ts
export interface LLMProvider {
  complete(prompt: string): Promise<string>;
}
```

- [ ] **Step 4: Write the Anthropic provider**

```typescript
// mcp/src/distill/providers/anthropic.ts
import type { LLMProvider } from "./types.js";

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(prompt: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { content: { type: string; text: string }[] };
    const textBlock = data.content.find((c) => c.type === "text");
    return textBlock?.text ?? "";
  }
}
```

- [ ] **Step 5: Write the OpenAI provider**

```typescript
// mcp/src/distill/providers/openai.ts
import type { LLMProvider } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(prompt: string): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? "";
  }
}
```

- [ ] **Step 6: Write the Google provider**

```typescript
// mcp/src/distill/providers/google.ts
import type { LLMProvider } from "./types.js";

export class GoogleProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google AI API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
    return data.candidates[0]?.content?.parts[0]?.text ?? "";
  }
}
```

- [ ] **Step 7: Write the provider registry**

```typescript
// mcp/src/distill/providers/registry.ts
import type { LLMProvider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { GoogleProvider } from "./google.js";
import { OpenAIProvider } from "./openai.js";

export function getProvider(name: string, apiKey: string, model: string): LLMProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider(apiKey, model);
    case "openai":
      return new OpenAIProvider(apiKey, model);
    case "google":
      return new GoogleProvider(apiKey, model);
    default:
      throw new Error(`Unknown LLM provider: ${name}. Supported: anthropic, openai, google`);
  }
}
```

- [ ] **Step 8: Run tests, fix lint, commit**

```
feat(distill): add LLM provider abstraction (Anthropic, OpenAI, Google)
```

---

### Task 4: Writer (Synapse API Integration)

**Files:**
- Create: `mcp/src/distill/writer.ts`
- Create: `mcp/test/unit/distill/writer.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// mcp/test/unit/distill/writer.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DistillWriter } from "../../../src/distill/writer.js";
import type { ExtractedFile } from "../../../src/distill/parser.js";

describe("DistillWriter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    process.env.SYNAPSE_API_KEY = "test-key";
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env.SYNAPSE_API_KEY = undefined;
  });

  it("writes each extracted file via the Synapse API", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const writer = new DistillWriter("test-key", "my-project");
    const files: ExtractedFile[] = [
      { path: "decisions/chose-redis.md", content: "# Chose Redis", tags: ["decision"] },
      { path: "learnings/gotcha.md", content: "# Gotcha", tags: ["learning"] },
    ];

    const count = await writer.writeAll(files);
    expect(count).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Verify API call structure
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/context/save");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.path).toBe("decisions/chose-redis.md");
    expect(body.content).toContain("Chose Redis");
    expect(body.project).toBe("my-project");
    expect(body.tags).toEqual(["decision"]);
  });

  it("returns 0 for empty file list", async () => {
    const writer = new DistillWriter("test-key", "my-project");
    const count = await writer.writeAll([]);
    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("continues writing remaining files if one fails", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("Error", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const logs: string[] = [];
    const writer = new DistillWriter("test-key", "my-project", (msg) => logs.push(msg));
    const files: ExtractedFile[] = [
      { path: "decisions/fail.md", content: "# Fail", tags: [] },
      { path: "decisions/ok.md", content: "# OK", tags: [] },
    ];

    const count = await writer.writeAll(files);
    expect(count).toBe(1);
    expect(logs.some((l) => l.includes("fail.md"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write the writer**

```typescript
// mcp/src/distill/writer.ts
import { API_URL } from "../cli/config.js";
import type { ExtractedFile } from "./parser.js";

export class DistillWriter {
  private apiKey: string;
  private project: string;
  private log: (msg: string) => void;

  constructor(apiKey: string, project: string, log?: (msg: string) => void) {
    this.apiKey = apiKey;
    this.project = project;
    this.log = log ?? (() => {});
  }

  async writeAll(files: ExtractedFile[]): Promise<number> {
    let written = 0;
    for (const file of files) {
      try {
        const res = await fetch(`${API_URL}/api/context/save`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project: this.project,
            path: file.path,
            content: file.content,
            source: "distill",
            tags: file.tags,
          }),
        });

        if (res.ok) {
          written++;
        } else {
          this.log(`Failed to write ${file.path}: ${res.status}`);
        }
      } catch (err) {
        this.log(`Failed to write ${file.path}: ${err}`);
      }
    }
    return written;
  }
}
```

- [ ] **Step 4: Run tests, fix lint, commit**

```
feat(distill): add writer for pushing extracted files to Synapse API
```

---

### Task 5: Distill Entry Point

**Files:**
- Create: `mcp/src/distill/index.ts`
- Create: `mcp/test/unit/distill/index.test.ts`

- [ ] **Step 1: Write the test file**

Tests the full pipeline with all dependencies mocked: prompt builder → provider → parser → writer.

```typescript
// mcp/test/unit/distill/index.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { distillSession } from "../../../src/distill/index.js";
import type { CapturedSession } from "../../../src/capture/types.js";

describe("distillSession", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const session: CapturedSession = {
    id: "ses_test1234567890",
    tool: "claude-code",
    projectPath: "/tmp/project",
    startedAt: "2026-04-02T10:00:00Z",
    updatedAt: "2026-04-02T10:30:00Z",
    messages: [
      { role: "user", content: "Should we use Redis or Memcached?", timestamp: "2026-04-02T10:00:00Z" },
      { role: "assistant", content: "Redis is better here because of pub/sub support.", timestamp: "2026-04-02T10:00:05Z" },
    ],
  };

  it("runs the full pipeline: prompt → LLM → parse → write", async () => {
    // Mock Anthropic API
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify([
                  { path: "decisions/chose-redis.md", content: "# Chose Redis\n\nBecause pub/sub.", tags: ["decision"] },
                ]),
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      // Mock Synapse write API
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await distillSession(session, {
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      synapseApiKey: "synapse-key",
      project: "my-project",
    });

    expect(result.filesWritten).toBe(1);
    expect(result.files[0].path).toBe("decisions/chose-redis.md");
  });

  it("returns 0 files when LLM extracts nothing", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "[]" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await distillSession(session, {
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      synapseApiKey: "synapse-key",
      project: "my-project",
    });

    expect(result.filesWritten).toBe(0);
    expect(result.files).toEqual([]);
  });

  it("throws when LLM provider fails", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(
      distillSession(session, {
        provider: "anthropic",
        apiKey: "bad-key",
        model: "claude-sonnet-4-6",
        synapseApiKey: "synapse-key",
        project: "my-project",
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write the entry point**

```typescript
// mcp/src/distill/index.ts
import type { CapturedSession } from "../capture/types.js";
import { type ExtractedFile, parseResponse } from "./parser.js";
import { buildPrompt } from "./prompt.js";
import { getProvider } from "./providers/registry.js";
import { DistillWriter } from "./writer.js";

export interface DistillOptions {
  provider: string;
  apiKey: string;
  model: string;
  synapseApiKey: string;
  project: string;
  existingFiles?: string[];
  log?: (msg: string) => void;
}

export interface DistillResult {
  files: ExtractedFile[];
  filesWritten: number;
}

export async function distillSession(session: CapturedSession, opts: DistillOptions): Promise<DistillResult> {
  const log = opts.log ?? (() => {});

  // 1. Build prompt
  const prompt = buildPrompt(session, opts.existingFiles);
  log(`Built prompt (${prompt.length} chars) for session ${session.id}`);

  // 2. Call LLM
  const provider = getProvider(opts.provider, opts.apiKey, opts.model);
  const rawResponse = await provider.complete(prompt);
  log(`LLM responded (${rawResponse.length} chars)`);

  // 3. Parse response
  const files = parseResponse(rawResponse);
  log(`Extracted ${files.length} file(s)`);

  if (files.length === 0) {
    return { files: [], filesWritten: 0 };
  }

  // 4. Write to Synapse
  const writer = new DistillWriter(opts.synapseApiKey, opts.project, log);
  const filesWritten = await writer.writeAll(files);
  log(`Wrote ${filesWritten}/${files.length} file(s) to Synapse`);

  return { files, filesWritten };
}
```

- [ ] **Step 4: Run tests, fix lint, commit**

```
feat(distill): add distill entry point orchestrating prompt → LLM → parse → write
```

---

### Task 6: CLI Subcommand

**Files:**
- Create: `mcp/src/distill/cli.ts`
- Modify: `mcp/src/index.ts` (add `distill` to CLI_SUBCOMMANDS and handleCli)

- [ ] **Step 1: Write the CLI handler**

```typescript
// mcp/src/distill/cli.ts
import { SessionStore } from "../capture/store.js";
import { accent, bold, muted } from "../cli/theme.js";
import { distillSession } from "./index.js";

const store = new SessionStore();

export async function runDistill(args: string[]): Promise<void> {
  const sessionId = args[0];

  if (!sessionId && !args.includes("--latest")) {
    console.log(`${bold("Usage:")}`);
    console.log("  npx synapsesync-mcp distill <session-id>   Distill a specific session");
    console.log("  npx synapsesync-mcp distill --latest       Distill the most recent session");
    return;
  }

  // Resolve session
  let session;
  if (args.includes("--latest")) {
    const sessions = store.list();
    if (sessions.length === 0) {
      console.log(muted("No captured sessions. Run 'capture start' first."));
      return;
    }
    session = sessions[0];
  } else {
    session = store.load(sessionId);
    if (!session) {
      console.log(`Session not found: ${sessionId}`);
      return;
    }
  }

  // Resolve config
  const provider = process.env.SYNAPSE_DISTILL_PROVIDER ?? "anthropic";
  const model = process.env.SYNAPSE_DISTILL_MODEL ?? "claude-sonnet-4-6";
  const apiKey = process.env.SYNAPSE_DISTILL_API_KEY;
  const synapseApiKey = process.env.SYNAPSE_API_KEY;
  const project = process.env.SYNAPSE_PROJECT ?? "My Workspace";

  if (!apiKey) {
    console.log("Set SYNAPSE_DISTILL_API_KEY to your LLM provider API key.");
    console.log(`  export SYNAPSE_DISTILL_API_KEY=sk-ant-...`);
    console.log(`  export SYNAPSE_DISTILL_PROVIDER=${provider}`);
    console.log(`  export SYNAPSE_DISTILL_MODEL=${model}`);
    return;
  }

  if (!synapseApiKey) {
    console.log("Set SYNAPSE_API_KEY to write results to your workspace.");
    return;
  }

  console.log(`${accent("Distilling")} session ${session.id} (${session.messages.length} messages)...`);
  console.log(muted(`Provider: ${provider} / ${model}`));

  try {
    const result = await distillSession(session, {
      provider,
      apiKey,
      model,
      synapseApiKey,
      project,
      log: (msg) => console.log(muted(`  ${msg}`)),
    });

    if (result.filesWritten === 0) {
      console.log(muted("No insights extracted from this session."));
    } else {
      console.log(`\n${accent(`${result.filesWritten} file(s) written to workspace:`)}`);
      for (const f of result.files) {
        console.log(`  ${f.path}`);
      }
    }
  } catch (err) {
    console.log(`Distill failed: ${err}`);
  }
}
```

- [ ] **Step 2: Wire into index.ts**

Add `"distill"` to `CLI_SUBCOMMANDS`, add import, add handler, add help section. Same pattern as `capture` was added.

- [ ] **Step 3: Build, lint, test, commit**

```
feat(distill): add CLI subcommand and wire into main entry point
```

---

### Task 7: Integration Test

- [ ] **Step 1: Run full verify**

```bash
cd /Users/Tanmai.N/Documents/synapse && npm run verify
```

- [ ] **Step 2: Test CLI help**

```bash
cd /Users/Tanmai.N/Documents/synapse/mcp && node dist/index.js --help
```

Verify "Distill" section appears.

- [ ] **Step 3: Test CLI usage**

```bash
node dist/index.js distill
node dist/index.js distill --latest
```

- [ ] **Step 4: Commit and push**

```
feat(distill): complete phase 2 — knowledge extraction from captured sessions
```
