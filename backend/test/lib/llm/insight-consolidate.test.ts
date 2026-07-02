import { describe, expect, it } from "vitest";
import { parseConsolidationResponse } from "../../../src/lib/llm/insight-consolidate";

/**
 * Bug class under test (Phase 03-04):
 *  - The LLM's response is unstructured text from a remote model; the
 *    parser is the contract gatekeeper. Failures here would either
 *    crash the consolidation pass (if it threw) or silently produce
 *    bogus insights (if it accepted malformed input).
 *  - Tests guard the parsing CONTRACT (clean JSON, fenced JSON, invalid
 *    JSON, malformed items, missing fields) — not specific LLM outputs.
 */

describe("parseConsolidationResponse", () => {
  it("parses a clean JSON array of valid items", () => {
    const raw = `[
      {"type": "decision", "summary": "Chose Postgres over DynamoDB", "detail": "Need joins."},
      {"type": "learning", "summary": "RLS does not apply to service role keys"}
    ]`;
    const r = parseConsolidationResponse(raw);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ type: "decision", summary: "Chose Postgres over DynamoDB", detail: "Need joins." });
    expect(r[1]).toMatchObject({ type: "learning", summary: "RLS does not apply to service role keys" });
    expect(r[1].detail).toBeUndefined();
  });

  it("strips a leading ```json code fence (LLMs sometimes leak markdown)", () => {
    const raw = '```json\n[{"type":"decision","summary":"x"}]\n```';
    const r = parseConsolidationResponse(raw);
    expect(r).toHaveLength(1);
    expect(r[0].summary).toBe("x");
  });

  it("strips a leading ``` (no language tag) code fence", () => {
    const raw = '```\n[{"type":"learning","summary":"y"}]\n```';
    const r = parseConsolidationResponse(raw);
    expect(r).toHaveLength(1);
  });

  it("returns [] on unparseable JSON (caller treats as skip-eviction)", () => {
    expect(parseConsolidationResponse("not json")).toEqual([]);
    expect(parseConsolidationResponse("[")).toEqual([]);
    expect(parseConsolidationResponse("")).toEqual([]);
  });

  it("returns [] when JSON parses to a non-array (caller treats as skip-eviction)", () => {
    expect(parseConsolidationResponse('{"not": "array"}')).toEqual([]);
    expect(parseConsolidationResponse('"just a string"')).toEqual([]);
    expect(parseConsolidationResponse("42")).toEqual([]);
    expect(parseConsolidationResponse("null")).toEqual([]);
  });

  it("filters out items with invalid type (forward-compat: unknown type → drop)", () => {
    const raw = `[
      {"type": "bug", "summary": "invalid type"},
      {"type": "decision", "summary": "good"},
      {"type": "PROCESS", "summary": "case-sensitive — drops"}
    ]`;
    const r = parseConsolidationResponse(raw);
    expect(r).toHaveLength(1);
    expect(r[0].summary).toBe("good");
  });

  it("filters out items missing required fields", () => {
    const raw = `[
      {"type": "decision"},
      {"summary": "no type"},
      {"type": "decision", "summary": ""},
      {"type": "decision", "summary": "   "},
      {"type": "decision", "summary": "valid"}
    ]`;
    const r = parseConsolidationResponse(raw);
    expect(r).toHaveLength(1);
    expect(r[0].summary).toBe("valid");
  });

  it("filters out items with non-string detail (must be string OR omitted)", () => {
    const raw = `[
      {"type": "decision", "summary": "x", "detail": 42},
      {"type": "decision", "summary": "y", "detail": null},
      {"type": "decision", "summary": "z", "detail": "ok"}
    ]`;
    const r = parseConsolidationResponse(raw);
    expect(r).toHaveLength(1);
    expect(r[0].summary).toBe("z");
    expect(r[0].detail).toBe("ok");
  });

  it("trims whitespace from summary and detail", () => {
    const raw = `[{"type": "decision", "summary": "  trim me  ", "detail": "  and me  "}]`;
    const r = parseConsolidationResponse(raw);
    expect(r[0].summary).toBe("trim me");
    expect(r[0].detail).toBe("and me");
  });

  it("accepts all five valid types", () => {
    const raw = `[
      {"type": "decision", "summary": "a"},
      {"type": "learning", "summary": "b"},
      {"type": "preference", "summary": "c"},
      {"type": "architecture", "summary": "d"},
      {"type": "action_item", "summary": "e"}
    ]`;
    const r = parseConsolidationResponse(raw);
    expect(r).toHaveLength(5);
  });

  it("tolerates trailing/leading whitespace and newlines on the outer JSON", () => {
    const raw = '\n\n  [{"type":"decision","summary":"ok"}]  \n\n';
    expect(parseConsolidationResponse(raw)).toHaveLength(1);
  });
});
