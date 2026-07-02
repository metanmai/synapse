import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../../../src/capture/adapters/codex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../fixtures/capture/codex/rollout-sample.jsonl");

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
    expect(session?.tool).toBe("codex");
    expect(session?.id).toBe("ses_codex_001");
    expect(session?.projectPath).toBe("/Users/test/myproject");
  });

  it("extracts user and assistant messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const userMsgs = session?.messages.filter((m) => m.role === "user");
    const assistantMsgs = session?.messages.filter((m) => m.role === "assistant");
    expect(userMsgs?.length).toBe(1);
    expect(assistantMsgs?.length).toBe(2);
  });

  it("extracts tool calls", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const withTools = session?.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0);
    expect(withTools?.length).toBe(1);
    expect(withTools?.[0].toolCalls?.[0].name).toBe("shell");
  });

  it("returns null for non-JSONL files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});
