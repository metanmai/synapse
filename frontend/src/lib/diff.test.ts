import { describe, it, expect } from "vitest";
import { computeDiff, type DiffLine } from "./diff";

/** Helper to extract only specific diff types */
function ofType(lines: DiffLine[], type: DiffLine["type"]) {
  return lines.filter((l) => l.type === type);
}

describe("computeDiff", () => {
  describe("no changes", () => {
    it("returns all 'same' when inputs are identical", () => {
      const text = "line 1\nline 2\nline 3";
      const result = computeDiff(text, text);
      expect(result).toEqual([
        { type: "same", text: "line 1" },
        { type: "same", text: "line 2" },
        { type: "same", text: "line 3" },
      ]);
    });

    it("returns single 'same' for identical single-line strings", () => {
      const result = computeDiff("hello", "hello");
      expect(result).toEqual([{ type: "same", text: "hello" }]);
    });
  });

  describe("additions", () => {
    it("detects a single line addition", () => {
      const oldText = "line 1\nline 2";
      const newText = "line 1\nline 2\nline 3";
      const result = computeDiff(oldText, newText);
      const adds = ofType(result, "add");
      expect(adds).toHaveLength(1);
      expect(adds[0].text).toBe("line 3");
    });

    it("detects addition in the middle", () => {
      const oldText = "a\nc";
      const newText = "a\nb\nc";
      const result = computeDiff(oldText, newText);
      expect(result).toEqual([
        { type: "same", text: "a" },
        { type: "add", text: "b" },
        { type: "same", text: "c" },
      ]);
    });

    it("detects addition at the beginning", () => {
      const oldText = "b\nc";
      const newText = "a\nb\nc";
      const result = computeDiff(oldText, newText);
      const adds = ofType(result, "add");
      expect(adds).toHaveLength(1);
      expect(adds[0].text).toBe("a");
    });
  });

  describe("deletions", () => {
    it("detects a single line deletion", () => {
      const oldText = "line 1\nline 2\nline 3";
      const newText = "line 1\nline 3";
      const result = computeDiff(oldText, newText);
      const removes = ofType(result, "remove");
      expect(removes).toHaveLength(1);
      expect(removes[0].text).toBe("line 2");
    });

    it("detects deletion at the end", () => {
      const oldText = "a\nb\nc";
      const newText = "a\nb";
      const result = computeDiff(oldText, newText);
      const removes = ofType(result, "remove");
      expect(removes).toHaveLength(1);
      expect(removes[0].text).toBe("c");
    });
  });

  describe("mixed changes", () => {
    it("detects multiple additions and deletions", () => {
      const oldText = "a\nb\nc\nd";
      const newText = "a\nx\nc\ny";
      const result = computeDiff(oldText, newText);
      const adds = ofType(result, "add");
      const removes = ofType(result, "remove");
      // b removed, x added; d removed, y added
      expect(adds.length).toBeGreaterThanOrEqual(2);
      expect(removes.length).toBeGreaterThanOrEqual(2);
      // a and c should be preserved
      const sames = ofType(result, "same");
      expect(sames.map((s) => s.text)).toContain("a");
      expect(sames.map((s) => s.text)).toContain("c");
    });

    it("handles complete replacement", () => {
      const oldText = "old line 1\nold line 2";
      const newText = "new line 1\nnew line 2";
      const result = computeDiff(oldText, newText);
      // All old lines removed, all new lines added
      const adds = ofType(result, "add");
      const removes = ofType(result, "remove");
      expect(removes.map((r) => r.text)).toContain("old line 1");
      expect(removes.map((r) => r.text)).toContain("old line 2");
      expect(adds.map((a) => a.text)).toContain("new line 1");
      expect(adds.map((a) => a.text)).toContain("new line 2");
    });
  });

  describe("empty inputs", () => {
    it("handles both sides empty", () => {
      const result = computeDiff("", "");
      // Splitting "" gives [""], so one "same" entry
      expect(result).toEqual([{ type: "same", text: "" }]);
    });

    it("handles old side empty (all additions)", () => {
      const result = computeDiff("", "line 1\nline 2");
      const adds = ofType(result, "add");
      expect(adds.map((a) => a.text)).toContain("line 1");
      expect(adds.map((a) => a.text)).toContain("line 2");
    });

    it("handles new side empty (all deletions)", () => {
      const result = computeDiff("line 1\nline 2", "");
      const removes = ofType(result, "remove");
      expect(removes.map((r) => r.text)).toContain("line 1");
      expect(removes.map((r) => r.text)).toContain("line 2");
    });
  });

  describe("large documents", () => {
    it("handles a large document with no changes efficiently", () => {
      const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
      const text = lines.join("\n");
      const result = computeDiff(text, text);
      expect(result).toHaveLength(500);
      expect(result.every((r) => r.type === "same")).toBe(true);
    });

    it("detects a minor single-character change in a large document", () => {
      const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
      const oldText = lines.join("\n");
      const modifiedLines = [...lines];
      modifiedLines[100] = "line 100 MODIFIED";
      const newText = modifiedLines.join("\n");

      const result = computeDiff(oldText, newText);
      const sames = ofType(result, "same");
      const removes = ofType(result, "remove");
      const adds = ofType(result, "add");

      // 199 lines unchanged, 1 removed, 1 added
      expect(sames).toHaveLength(199);
      expect(removes).toHaveLength(1);
      expect(removes[0].text).toBe("line 100");
      expect(adds).toHaveLength(1);
      expect(adds[0].text).toBe("line 100 MODIFIED");
    });
  });

  describe("ordering", () => {
    it("preserves line order in the result", () => {
      const oldText = "a\nb\nc";
      const newText = "a\nx\nc";
      const result = computeDiff(oldText, newText);
      const texts = result.map((r) => r.text);
      // 'a' should come before 'x'/'b' which should come before 'c'
      expect(texts.indexOf("a")).toBeLessThan(texts.indexOf("c"));
    });
  });
});
