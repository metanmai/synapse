import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../../../src/capture/adapters/claude-code.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../fixtures/capture/claude-code/sample-session.jsonl");

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
    expect(session?.tool).toBe("claude-code");
    expect(session?.id).toBe("ses_a1b2c3d4e5f67890");
    expect(session?.projectPath).toBe("/Users/test/myproject");
  });

  it("extracts user and assistant messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const userMsgs = session?.messages.filter((m) => m.role === "user");
    const assistantMsgs = session?.messages.filter((m) => m.role === "assistant");
    expect(userMsgs?.length).toBeGreaterThan(0);
    expect(assistantMsgs?.length).toBeGreaterThan(0);
  });

  it("extracts tool calls from assistant messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const withTools = session?.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0);
    expect(withTools?.length).toBeGreaterThan(0);
    expect(withTools?.[0].toolCalls?.[0].name).toBe("Read");
  });

  it("returns null for non-JSONL files", () => {
    expect(adapter.parse("/some/random/file.txt")).toBeNull();
  });

  it("skips sidechain messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.messages.length).toBeGreaterThan(0);
  });
});
