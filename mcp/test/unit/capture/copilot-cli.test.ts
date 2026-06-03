// mcp/test/unit/capture/copilot-cli.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CopilotCliAdapter } from "../../../src/capture/adapters/copilot-cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Copilot CLI derives the session id from the PARENT DIRECTORY name and
// requires the file to be named events.jsonl. Each line is a CopilotEvent
// with {type, data, id, timestamp, parentId}.
const SESSION_DIR = "a7b8c9d0-e1f2-3456-abcd-567890123456";
const FIXTURE = path.join(__dirname, "../../fixtures/capture/copilot-cli", SESSION_DIR, "events.jsonl");

describe("CopilotCliAdapter", () => {
  const adapter = new CopilotCliAdapter();

  it("has tool name 'copilot-cli'", () => {
    expect(adapter.tool).toBe("copilot-cli");
  });

  it("returns watch paths under ~/.copilot/session-state", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain(path.join(".copilot", "session-state"));
  });

  it("parses events.jsonl into a CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.tool).toBe("copilot-cli");
    expect(session?.id).toBe("ses_a7b8c9d0e1f23456");
  });

  it("derives projectPath from the session.start event's cwd field", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.projectPath).toBe("/Users/test/copilot-project");
  });

  it("extracts user.message + assistant.message events into messages, ignoring session.start and tool events", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    // Fixture has 6 events total: 1 session.start + 1 user.message +
    // 2 assistant.message + 1 tool.execution_start + 1 tool.execution_complete.
    // The tool events do NOT add messages — they only attach toolCalls to
    // the NEXT assistant.message.
    expect(session?.messages.length).toBe(3);
    const roles = session?.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "assistant"]);
  });

  it("attaches pending tool calls to the next assistant.message (execution_start + execution_complete merged)", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    // First assistant message fires BEFORE the tool events → no toolCalls.
    // Second assistant message fires AFTER → consumes the merged tool call.
    const withTools = session?.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0) ?? [];
    expect(withTools.length).toBe(1);
    expect(withTools[0].toolCalls?.[0].name).toBe("shell");
    expect(withTools[0].toolCalls?.[0].input).toContain("cat src/api/client.ts");
    expect(withTools[0].toolCalls?.[0].output).toContain("ApiClient");
  });

  it("preserves session start/end timestamps from the first and last event", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.startedAt).toBe("2026-04-02T11:00:00Z");
    expect(session?.updatedAt).toBe("2026-04-02T11:00:20Z");
  });

  it("returns null for files NOT named events.jsonl", () => {
    const wrongName = path.join(__dirname, "../../fixtures/capture/copilot-cli", SESSION_DIR, "other.jsonl");
    expect(adapter.parse(wrongName)).toBeNull();
  });

  it("returns null for non-JSONL files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});
