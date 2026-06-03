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

  it("honors SYNAPSE_TEST_CURSOR_PATH override (test-affordance for E2E adapter-roundtrip)", () => {
    const prev = process.env.SYNAPSE_TEST_CURSOR_PATH;
    process.env.SYNAPSE_TEST_CURSOR_PATH = "/tmp/synapse-test-cursor-watch";
    try {
      expect(adapter.watchPaths()).toEqual(["/tmp/synapse-test-cursor-watch"]);
    } finally {
      if (prev === undefined) {
        // biome-ignore lint/performance/noDelete: assigning undefined to process.env.X coerces to string "undefined" (truthy), which would leak the override into other tests
        delete process.env.SYNAPSE_TEST_CURSOR_PATH;
      } else {
        process.env.SYNAPSE_TEST_CURSOR_PATH = prev;
      }
    }
  });

  it("parses a JSON chat file into CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.tool).toBe("cursor");
    expect(session?.id).toBe("ses_b2c3d4e5f6a78901");
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
