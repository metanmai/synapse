import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../../../src/distill/providers/anthropic.js";
import { getProvider } from "../../../src/distill/providers/registry.js";

describe("AnthropicProvider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends correct headers and body to Anthropic API", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "[]" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new AnthropicProvider("sk-ant-test", "claude-sonnet-4-6");
    await provider.complete("test prompt");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((opts as RequestInit).method).toBe("POST");

    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBeDefined();

    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.messages[0].content).toBe("test prompt");
  });

  it("extracts text from response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: '[{"path":"decisions/x.md","content":"# X","tags":[]}]' }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new AnthropicProvider("sk-ant-test", "claude-sonnet-4-6");
    const result = await provider.complete("test");
    expect(result).toContain("decisions/x.md");
  });

  it("throws on API error", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const provider = new AnthropicProvider("bad-key", "claude-sonnet-4-6");
    await expect(provider.complete("test")).rejects.toThrow();
  });
});

describe("getProvider", () => {
  it("returns AnthropicProvider for 'anthropic'", () => {
    const provider = getProvider("anthropic", "test-key", "claude-sonnet-4-6");
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("throws for unknown provider", () => {
    expect(() => getProvider("unknown", "key", "model")).toThrow();
  });
});
