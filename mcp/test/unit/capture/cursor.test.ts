// mcp/test/unit/capture/cursor.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CursorAdapter } from "../../../src/capture/adapters/cursor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../fixtures/capture/cursor/sample-chat.json");

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
    expect(session?.tool).toBe("cursor");
    expect(session?.id).toBe("ses_cursor_001");
  });

  it("extracts alternating user/assistant messages from requests", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.messages).toHaveLength(4); // 2 user + 2 assistant
    expect(session?.messages[0].role).toBe("user");
    expect(session?.messages[1].role).toBe("assistant");
    expect(session?.messages[2].role).toBe("user");
    expect(session?.messages[3].role).toBe("assistant");
  });

  it("returns null for non-JSON files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});
