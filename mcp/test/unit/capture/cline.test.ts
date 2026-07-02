// mcp/test/unit/capture/cline.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClineAdapter } from "../../../src/capture/adapters/cline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Cline derives the task id from the PARENT DIRECTORY name and requires
// the file to be named api_conversation_history.json — both are part of
// the bug-class assertions below.
const TASK_ID = "e5f6a7b8-c9d0-1234-efab-345678901234";
const FIXTURE = path.join(__dirname, "../../fixtures/capture/cline", TASK_ID, "api_conversation_history.json");

describe("ClineAdapter", () => {
  const adapter = new ClineAdapter();

  it("has tool name 'cline'", () => {
    expect(adapter.tool).toBe("cline");
  });

  it("returns watch paths under the saoudrizwan.claude-dev VSCode extension storage", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain("saoudrizwan.claude-dev");
  });

  it("parses api_conversation_history.json into a CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.tool).toBe("cline");
    // sessionIdFromNative strips dashes from TASK_ID and takes first 16 hex chars.
    expect(session?.id).toBe("ses_e5f6a7b8c9d01234");
  });

  it("skips messages that are user role with only tool_result content blocks", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    // Fixture has 4 messages; one of them is a user message containing
    // only a tool_result — that one is the "robot speaking back to the
    // agent" entry, not a real human turn, and gets filtered.
    expect(session?.messages.length).toBe(3);
  });

  it("extracts text content and maps roles correctly (anthropic-style content blocks)", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const roles = session?.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "assistant"]);
    expect(session?.messages[0].content).toContain("refactor the auth module");
  });

  it("extracts tool_use blocks into toolCalls on assistant messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const withTools = session?.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0) ?? [];
    expect(withTools.length).toBe(2);
    const toolNames = withTools.flatMap((m) => m.toolCalls?.map((t) => t.name) ?? []);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("write_to_file");
  });

  it("returns null for files NOT named api_conversation_history.json", () => {
    const wrongName = path.join(__dirname, "../../fixtures/capture/cline", TASK_ID, "other.json");
    expect(adapter.parse(wrongName)).toBeNull();
  });

  it("returns null for non-JSON files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});
