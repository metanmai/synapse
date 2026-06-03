// mcp/test/unit/capture/roo-code.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RooCodeAdapter } from "../../../src/capture/adapters/roo-code.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Roo Code is a fork of Cline — same file shape (api_conversation_history.json),
// same content-block structure, just a different VSCode extension ID.
const TASK_ID = "f6a7b8c9-d0e1-2345-fabc-456789012345";
const FIXTURE = path.join(__dirname, "../../fixtures/capture/roo-code", TASK_ID, "api_conversation_history.json");

describe("RooCodeAdapter", () => {
  const adapter = new RooCodeAdapter();

  it("has tool name 'roo-code'", () => {
    expect(adapter.tool).toBe("roo-code");
  });

  it("returns watch paths under the rooveterinaryinc.roo-cline VSCode extension storage", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain("rooveterinaryinc.roo-cline");
  });

  it("parses api_conversation_history.json into a CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.tool).toBe("roo-code");
    expect(session?.id).toBe("ses_f6a7b8c9d0e12345");
  });

  it("skips user messages that contain only tool_result content blocks", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.messages.length).toBe(3);
  });

  it("maps roles correctly and preserves text content", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const roles = session?.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "assistant"]);
    expect(session?.messages[0].content).toContain("add input validation");
  });

  it("extracts tool_use blocks into toolCalls on assistant messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const withTools = session?.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0) ?? [];
    expect(withTools.length).toBe(2);
    const toolNames = withTools.flatMap((m) => m.toolCalls?.map((t) => t.name) ?? []);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("apply_diff");
  });

  it("returns null for files NOT named api_conversation_history.json", () => {
    const wrongName = path.join(__dirname, "../../fixtures/capture/roo-code", TASK_ID, "other.json");
    expect(adapter.parse(wrongName)).toBeNull();
  });

  it("returns null for non-JSON files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});
