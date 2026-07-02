// mcp/test/unit/capture/gemini.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GeminiAdapter } from "../../../src/capture/adapters/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../fixtures/capture/gemini/sample-chat.json");

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

  it("honors SYNAPSE_TEST_GEMINI_PATH override (test-affordance for E2E adapter-roundtrip)", () => {
    const prev = process.env.SYNAPSE_TEST_GEMINI_PATH;
    process.env.SYNAPSE_TEST_GEMINI_PATH = "/tmp/synapse-test-gemini-watch";
    try {
      expect(adapter.watchPaths()).toEqual(["/tmp/synapse-test-gemini-watch"]);
    } finally {
      if (prev === undefined) {
        // biome-ignore lint/performance/noDelete: assigning undefined to process.env.X coerces to string "undefined" (truthy), which would leak the override into other tests
        delete process.env.SYNAPSE_TEST_GEMINI_PATH;
      } else {
        process.env.SYNAPSE_TEST_GEMINI_PATH = prev;
      }
    }
  });

  it("parses a JSON chat file into CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.tool).toBe("gemini");
    expect(session?.id).toBe("ses_d4e5f6a7b8c90123");
  });

  it("maps 'model' role to 'assistant'", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const roles = session?.messages.map((m) => m.role);
    expect(roles).not.toContain("model");
    expect(roles?.filter((r) => r === "assistant").length).toBe(2);
  });

  it("extracts tool calls from model messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const withTools = session?.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0);
    expect(withTools?.length).toBe(1);
    expect(withTools?.[0].toolCalls?.[0].name).toBe("code_execution");
  });

  it("returns null for non-JSON files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});
