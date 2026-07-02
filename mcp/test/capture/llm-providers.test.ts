// mcp/test/capture/llm-providers.test.ts
//
// BUG CLASS: "the killer-feature handoff pipeline is a single point of
// failure on whatever provider the backend's COMPACTION_LLM_KEY points
// at — if that account runs out of credits, gets revoked, or hits a
// rate limit, every user's recompute silently fails."
//
// The fix is the local-compact path in pull-compact.ts which falls back
// to the user's locally-configured LLM key (auto-detected from env)
// when the hosted path fails. These tests guard the auto-detection +
// provider-shape contract so a future env-mutation refactor or a new
// provider addition can't accidentally break the fallback.
//
// Discovered 2026-06-07: Stage 6 of happy-flow-e2e on metanmai/synapse
// timed out because the backend's COMPACTION_LLM_KEY Anthropic account
// had "credit balance is too low to access the Anthropic API." With
// this module, users who have their own keys aren't blocked.

import { describe, expect, it, vi } from "vitest";
import { buildCompactionPrompt, compactLocally, detectLLMProvider } from "../../src/capture/llm-providers.js";

describe("detectLLMProvider — env-based provider selection", () => {
  it("returns null when no provider key is in env", () => {
    expect(detectLLMProvider({})).toBeNull();
  });

  it("prefers Anthropic when ANTHROPIC_API_KEY is set", () => {
    const result = detectLLMProvider({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(result?.provider.name).toBe("anthropic");
    expect(result?.apiKey).toBe("sk-ant-test");
  });

  it("falls through to OpenRouter when ANTHROPIC is absent but OPENROUTER is set", () => {
    const result = detectLLMProvider({ OPENROUTER_API_KEY: "sk-or-test" });
    expect(result?.provider.name).toBe("openrouter");
    expect(result?.apiKey).toBe("sk-or-test");
  });

  it("falls through to DeepSeek as the last-resort provider", () => {
    const result = detectLLMProvider({ DEEPSEEK_API_KEY: "sk-ds-test" });
    expect(result?.provider.name).toBe("deepseek");
    expect(result?.apiKey).toBe("sk-ds-test");
  });

  it("respects priority: Anthropic beats OpenRouter beats DeepSeek when multiple are set", () => {
    // CI configurations often have all three set as GitHub secrets.
    // Stable priority means a future shake-up doesn't silently route
    // captured traffic to a different provider than the user expects.
    const result = detectLLMProvider({
      ANTHROPIC_API_KEY: "sk-ant",
      OPENROUTER_API_KEY: "sk-or",
      DEEPSEEK_API_KEY: "sk-ds",
    });
    expect(result?.provider.name).toBe("anthropic");
  });

  it("ignores empty-string env values (treats them as unset)", () => {
    // GitHub Actions sets undefined secrets as empty strings on the env
    // map; we must NOT pick a provider just because the env var was
    // declared but never assigned. Real bug from 2026-06-07: CI had
    // ANTHROPIC_API_KEY="" but OPENROUTER_API_KEY="<real>"; pre-fix
    // logic would have returned anthropic with an empty key.
    const result = detectLLMProvider({
      ANTHROPIC_API_KEY: "",
      OPENROUTER_API_KEY: "sk-or-real",
    });
    expect(result?.provider.name).toBe("openrouter");
  });
});

describe("buildCompactionPrompt — backend-prompt parity", () => {
  it("formats the transcript with [role] tags and the message count header", () => {
    // Drift between this prompt and backend/src/lib/llm/prompts.ts
    // produces different summaries depending on which path compacted,
    // which means inconsistent handoffs across users. Keep the shape
    // identical.
    const prompt = buildCompactionPrompt(
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
      null,
    );
    expect(prompt).toContain("## Transcript (2 messages)");
    expect(prompt).toContain("[user] hello");
    expect(prompt).toContain("[assistant] hi there");
  });

  it("includes the conversation title when provided", () => {
    const prompt = buildCompactionPrompt([{ role: "user", content: "x" }], "Session about auth");
    expect(prompt).toContain("Conversation title: Session about auth");
  });

  it("substitutes '(empty)' for null content (matching backend `?? '(empty)'` semantics)", () => {
    // backend/src/lib/llm/prompts.ts uses `m.content ?? "(empty)"` — the
    // nullish coalescing only triggers for null/undefined, not for empty
    // strings. Mirror that exact behavior here so a content="null" db row
    // produces the same prompt shape regardless of which path compacted.
    const prompt = buildCompactionPrompt([{ role: "user", content: null as unknown as string }], null);
    expect(prompt).toContain("[user] (empty)");
  });
});

describe("compactLocally — end-to-end provider call", () => {
  it("returns null when no provider key is set (caller falls through to hosted)", async () => {
    const logs: string[] = [];
    const result = await compactLocally([{ role: "user", content: "anything" }], null, {}, (msg) => logs.push(msg));
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes("no provider key in env"))).toBe(true);
  });

  it("calls the detected provider's endpoint and returns the parsed text", async () => {
    // Stub global fetch so the test doesn't make real network calls.
    // Verifying via the URL the provider hit gives us defense against
    // future refactors that accidentally call the wrong endpoint.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      // OpenRouter response shape (OpenAI-compatible).
      json: async () => ({ choices: [{ message: { content: "compacted text here" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await compactLocally(
        [{ role: "user", content: "do thing" }],
        null,
        { OPENROUTER_API_KEY: "sk-or-test" },
        () => {},
      );
      expect(result?.text).toBe("compacted text here");
      expect(result?.provider).toBe("openrouter");
      // Confirm the call landed on the OpenRouter endpoint, not Anthropic's.
      expect(fetchMock).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/chat/completions",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when the provider call throws (caller falls through to hosted)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const logs: string[] = [];
      const result = await compactLocally(
        [{ role: "user", content: "x" }],
        null,
        { DEEPSEEK_API_KEY: "sk-ds-test" },
        (msg) => logs.push(msg),
      );
      expect(result).toBeNull();
      expect(logs.some((l) => l.includes("deepseek") && l.includes("429"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when the provider returns empty text (treats it as failure, not silent success)", async () => {
    // A defensive guard: if the LLM returns 200 with an empty content
    // field (e.g. content filter triggered, max_tokens=0, etc.), we
    // don't want to write an empty handoff_markdown to the backend
    // and call it a day. Fall through to hosted instead.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await compactLocally(
        [{ role: "user", content: "x" }],
        null,
        { OPENROUTER_API_KEY: "sk-or-test" },
        () => {},
      );
      expect(result).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
