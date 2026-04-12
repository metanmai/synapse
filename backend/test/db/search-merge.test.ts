import { describe, expect, it } from "vitest";
import { mergeSearchResults, buildIlikeWords } from "../../src/db/search-helpers";
import type { Entry } from "../../src/db/types";

const BASE_ENTRY: Entry = {
  id: "aaa",
  project_id: "proj1",
  path: "test/doc.md",
  content: "test content",
  content_type: "markdown",
  author_id: null,
  source: "human",
  tags: [],
  google_doc_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function entry(overrides: Partial<Entry>): Entry {
  return { ...BASE_ENTRY, ...overrides };
}

describe("mergeSearchResults", () => {
  it("deduplicates entries by id, keeping highest score", () => {
    const semantic = [{ entry: entry({ id: "a" }), score: 0.9 }];
    const fulltext = [{ entry: entry({ id: "a" }), score: 0.5 }];
    const ilike = [{ entry: entry({ id: "a" }), score: 0.1 }];

    const result = mergeSearchResults(semantic, fulltext, ilike);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("sorts by score descending", () => {
    const semantic = [{ entry: entry({ id: "a" }), score: 0.9 }];
    const fulltext = [{ entry: entry({ id: "b" }), score: 0.7 }];
    const ilike = [{ entry: entry({ id: "c" }), score: 0.1 }];

    const result = mergeSearchResults(semantic, fulltext, ilike);
    expect(result.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("handles empty inputs", () => {
    const result = mergeSearchResults([], [], []);
    expect(result).toEqual([]);
  });

  it("merges across all three tiers", () => {
    const semantic = [{ entry: entry({ id: "a" }), score: 0.8 }];
    const fulltext = [{ entry: entry({ id: "b" }), score: 0.6 }];
    const ilike = [{ entry: entry({ id: "c" }), score: 0.1 }];

    const result = mergeSearchResults(semantic, fulltext, ilike);
    expect(result).toHaveLength(3);
  });
});

describe("buildIlikeWords", () => {
  it("splits on whitespace and filters short words", () => {
    expect(buildIlikeWords("code structure a overview")).toEqual([
      "code",
      "structure",
      "overview",
    ]);
  });

  it("returns empty array for empty/whitespace input", () => {
    expect(buildIlikeWords("")).toEqual([]);
    expect(buildIlikeWords("   ")).toEqual([]);
  });

  it("filters single-char words", () => {
    expect(buildIlikeWords("a b cd ef")).toEqual(["cd", "ef"]);
  });
});
