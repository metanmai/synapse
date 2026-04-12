import { describe, expect, it, vi } from "vitest";
import { embedTexts, type EmbeddingConfig } from "../../src/lib/embeddings";

const FAKE_VECTOR = Array.from({ length: 768 }, (_, i) => i / 768);

function makeConfig(overrides?: Partial<EmbeddingConfig>): EmbeddingConfig {
  return {
    url: "http://fake-embed:8080",
    key: "test-key",
    timeoutMs: 3000,
    ...overrides,
  };
}

describe("embedTexts", () => {
  it("returns embeddings on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embeddings: [FAKE_VECTOR] }),
    });

    const result = await embedTexts(
      ["hello world"],
      "search_query",
      makeConfig(),
      mockFetch,
    );

    expect(result).toEqual([FAKE_VECTOR]);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://fake-embed:8080/embed");
    expect(opts.headers["Authorization"]).toBe("Bearer test-key");
    expect(JSON.parse(opts.body)).toEqual({
      texts: ["hello world"],
      type: "search_query",
    });
  });

  it("returns null when service returns non-ok status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error"),
    });

    const result = await embedTexts(
      ["hello"],
      "search_query",
      makeConfig(),
      mockFetch,
    );

    expect(result).toBeNull();
  });

  it("returns null when fetch throws (network error)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const result = await embedTexts(
      ["hello"],
      "search_query",
      makeConfig(),
      mockFetch,
    );

    expect(result).toBeNull();
  });

  it("returns null when config has no URL", async () => {
    const mockFetch = vi.fn();

    const result = await embedTexts(
      ["hello"],
      "search_query",
      makeConfig({ url: undefined }),
      mockFetch,
    );

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
