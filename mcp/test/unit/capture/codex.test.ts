import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../../../src/capture/adapters/codex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../fixtures/capture/codex/rollout-sample.jsonl");
// Real codex 0.50+ session shape — payload-wrapped lines, content blocks,
// function_call response_items. Bug class: format-drift silently zeroed
// out capture for codex 0.50+ users until this adapter learned v2.
const FIXTURE_V2 = path.join(__dirname, "../../fixtures/capture/codex/rollout-v2-sample.jsonl");

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  it("has tool name 'codex'", () => {
    expect(adapter.tool).toBe("codex");
  });

  it("returns watch paths under ~/.codex/sessions", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain(path.join(".codex", "sessions"));
  });

  it("honors SYNAPSE_TEST_CODEX_PATH override (test-affordance for E2E adapter-roundtrip)", () => {
    const prev = process.env.SYNAPSE_TEST_CODEX_PATH;
    process.env.SYNAPSE_TEST_CODEX_PATH = "/tmp/synapse-test-codex-watch";
    try {
      expect(adapter.watchPaths()).toEqual(["/tmp/synapse-test-codex-watch"]);
    } finally {
      if (prev === undefined) {
        // biome-ignore lint/performance/noDelete: assigning undefined to process.env.X coerces to string "undefined" (truthy), which would leak the override into other tests
        delete process.env.SYNAPSE_TEST_CODEX_PATH;
      } else {
        process.env.SYNAPSE_TEST_CODEX_PATH = prev;
      }
    }
  });

  it("parses a rollout JSONL file into CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.tool).toBe("codex");
    expect(session?.id).toBe("ses_c3d4e5f6a7b89012");
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

  // ── v2 format (codex 0.50+) ─────────────────────────────────────────────

  it("parses a v2 (codex 0.50+) rollout file — same session shape as v1", () => {
    const session = adapter.parse(FIXTURE_V2);
    expect(session).not.toBeNull();
    expect(session?.tool).toBe("codex");
    expect(session?.id).toBe("ses_019e8cfbea957661");
    expect(session?.projectPath).toBe("/Users/test/myproject");
  });

  it("v2: extracts the user prompt from response_item.payload.content blocks", () => {
    const session = adapter.parse(FIXTURE_V2);
    const userMsgs = session?.messages.filter((m) => m.role === "user") ?? [];
    expect(userMsgs.length).toBe(1);
    expect(userMsgs[0].content).toContain("add rate limiting");
  });

  it("v2: extracts the assistant text from output_text content blocks", () => {
    const session = adapter.parse(FIXTURE_V2);
    const assistantMsgs = session?.messages.filter((m) => m.role === "assistant") ?? [];
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0].content).toContain("sliding window");
  });

  it("v2: skips event_msg and turn_context noise lines (no duplicates)", () => {
    const session = adapter.parse(FIXTURE_V2);
    // Fixture has one user response_item AND one event_msg echoing the
    // same prompt. We dedupe by only consuming response_item lines.
    const userMsgs = session?.messages.filter((m) => m.role === "user") ?? [];
    expect(userMsgs.length).toBe(1);
  });

  it("v2: attaches function_call response_items as toolCalls on the next assistant message", () => {
    const session = adapter.parse(FIXTURE_V2);
    const withTools = session?.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0) ?? [];
    expect(withTools.length).toBe(1);
    expect(withTools[0].toolCalls?.[0].name).toBe("shell");
  });

  // ── Regression guard ────────────────────────────────────────────────────

  it("REGRESSION: a fresh codex 0.50 session must parse, not silently return null", () => {
    // This is the bug class the cross-harness experiment surfaced: a real
    // codex 0.50 session was produced on a developer's machine, the watcher
    // fired, the adapter was called — and silently returned null because
    // every line's flat-field parse path failed. If this test ever goes
    // red (e.g. codex 0.60 rev's the format again), capture will silently
    // break on prod machines with no signal. Failing fast here keeps the
    // signal local.
    const session = adapter.parse(FIXTURE_V2);
    expect(session).not.toBeNull();
    expect(session?.messages.length).toBeGreaterThan(0);
  });
});
