import { describe, expect, it } from "vitest";
import { parseResponse } from "../../../src/distill/parser.js";

describe("parseResponse", () => {
  it("parses a valid JSON array of files", () => {
    const raw = JSON.stringify([
      { path: "decisions/chose-redis.md", content: "# Chose Redis\n\nBecause...", tags: ["decision"] },
      { path: "learnings/cf-cookies.md", content: "# CF Workers Cookies\n\nGotcha...", tags: ["learning"] },
    ]);
    const result = parseResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("decisions/chose-redis.md");
    expect(result[0].content).toContain("Chose Redis");
    expect(result[0].tags).toEqual(["decision"]);
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseResponse("[]")).toEqual([]);
  });

  it("strips markdown code fencing if present", () => {
    const raw = "```json\n" + JSON.stringify([{ path: "decisions/x.md", content: "# X", tags: [] }]) + "\n```";
    const result = parseResponse(raw);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for unparseable response", () => {
    expect(parseResponse("This is not JSON at all")).toEqual([]);
  });

  it("filters out entries with missing path or content", () => {
    const raw = JSON.stringify([
      { path: "decisions/good.md", content: "# Good", tags: [] },
      { path: "", content: "no path", tags: [] },
      { content: "also no path", tags: [] },
      { path: "learnings/no-content.md", tags: [] },
    ]);
    const result = parseResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("decisions/good.md");
  });

  it("defaults tags to empty array if missing", () => {
    const raw = JSON.stringify([{ path: "decisions/x.md", content: "# X" }]);
    const result = parseResponse(raw);
    expect(result[0].tags).toEqual([]);
  });
});
