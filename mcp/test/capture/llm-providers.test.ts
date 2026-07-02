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

  it("includes the MUST-PRESERVE clause so summarization preserves identifiers verbatim", () => {
    // BUG CLASS: "the LLM paraphrases away exactly the identifiers the
    // next session needs to recall." Stage 6.2 of happy-flow-e2e
    // asserts that TEST_ID and TEST_PHRASE land in handoff_markdown.
    // Without an explicit instruction, summarization-trained models
    // strip out unique IDs / hashes / secrets in favor of a generic
    // narrative. The MUST-PRESERVE list is the load-bearing fix.
    //
    // Discovered 2026-06-07: 424-char OpenRouter summary failed Stage
    // 6.2 because the literal TEST_ID/TEST_PHRASE values were
    // paraphrased out, even though they were explicit in the user
    // turn ("test_id is XXX, secret_phrase is 'YYY'").
    const prompt = buildCompactionPrompt(
      [{ role: "user", content: "remember test_id is abc123 and secret is 'xyz789'" }],
      null,
    );
    expect(prompt).toMatch(/MUST-PRESERVE/i);
    // The "look for phrases like 'remember', 'test_id is'" guidance is
    // the specific anchor that catches the e2e test's fact pattern.
    expect(prompt).toMatch(/test_id is/i);
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
  it("returns null when LONG conversation has no provider key (caller falls through to hosted)", async () => {
    // 11 messages bypasses the passthrough fast-path, so reaching the
    // LLM is gated on a configured provider. Short conversations still
    // succeed via passthrough — see the test below this one.
    const longConversation = Array.from({ length: 11 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));
    const logs: string[] = [];
    const result = await compactLocally(longConversation, null, {}, (msg) => logs.push(msg));
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes("no provider key in env"))).toBe(true);
  });

  it("SHORT conversation passthrough succeeds even with NO provider key (LLM-free path)", async () => {
    // Side benefit of the passthrough threshold: users with no LLM key
    // at all still get a working handoff for short conversations. The
    // only loss is compression — the literal facts are preserved.
    const result = await compactLocally(
      [
        { role: "user", content: "test_id is abc123" },
        { role: "assistant", content: "noted" },
      ],
      null,
      {}, // no env keys
      () => {},
    );
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("passthrough");
    expect(result?.text).toContain("test_id is abc123");
  });

  // ── Short-conversation passthrough (bug class guard) ────────────────────
  //
  // BUG CLASS: "summarization-trained LLMs drop literal identifiers
  // from short conversations because the model has nothing else to do
  // — without compression pressure it abstracts." A 2-message E2E
  // session with "test_id is abc123" became "the user provided test
  // facts" in 3.5-haiku's output on Ubuntu (Windows preserved it; same
  // run, same code — LLM non-determinism). The passthrough fast path
  // eliminates the non-determinism by never invoking the LLM for
  // conversations small enough to package verbatim.

  it("short-circuits to passthrough for ≤10 messages — preserves identifiers verbatim WITHOUT calling any LLM", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await compactLocally(
        [
          { role: "user", content: "Remember: test_id is abc123def, secret is 'xyz789'" },
          { role: "assistant", content: "noted" },
        ],
        null,
        { OPENROUTER_API_KEY: "sk-or-test" },
        () => {},
      );
      // Provider/model are tagged "passthrough" so backend audits show
      // which conversations bypassed the LLM.
      expect(result?.provider).toBe("passthrough");
      expect(result?.model).toBe("passthrough");
      // The literal identifiers MUST appear verbatim.
      expect(result?.text).toContain("test_id is abc123def");
      expect(result?.text).toContain("xyz789");
      // No network call — passthrough never invokes the LLM.
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("calls the detected provider's endpoint and returns the parsed text (long-conversation path)", async () => {
    // Stub global fetch so the test doesn't make real network calls.
    // Verifying via the URL the provider hit gives us defense against
    // future refactors that accidentally call the wrong endpoint.
    // Use 11 messages so the passthrough threshold (10) is exceeded and
    // the LLM path actually executes.
    const longConversation = Array.from({ length: 11 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      // OpenRouter response shape (OpenAI-compatible).
      json: async () => ({ choices: [{ message: { content: "compacted text here" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await compactLocally(longConversation, null, { OPENROUTER_API_KEY: "sk-or-test" }, () => {});
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
    // 11 messages to bypass the passthrough fast path and reach the LLM call.
    const longConversation = Array.from({ length: 11 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const logs: string[] = [];
      const result = await compactLocally(longConversation, null, { DEEPSEEK_API_KEY: "sk-ds-test" }, (msg) =>
        logs.push(msg),
      );
      expect(result).toBeNull();
      expect(logs.some((l) => l.includes("deepseek") && l.includes("429"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // ── Provider base-URL env override (Docker stand-in for outage resilience) ──
  //
  // BUG CLASS guarded: "the killer-feature handoff pipeline is bound to
  // hard-coded provider URLs, so a hosted provider outage / credit-balance
  // exhaustion (observed 2026-06-10 against api.anthropic.com) takes the
  // whole pipeline red". With per-provider *_BASE_URL env overrides, an
  // operator can point compaction at a docker'd stand-in (or the repo's
  // fake-LLM helper) to keep the gate honest while the external provider
  // is degraded. Test stubs fetch so it works offline.

  it("honors ANTHROPIC_BASE_URL — Docker / fake-LLM redirection without code changes", async () => {
    const longConversation = Array.from({ length: 11 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "from-local-stub" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9099");

    try {
      const result = await compactLocally(longConversation, null, { ANTHROPIC_API_KEY: "sk-ant-test" }, () => {});
      expect(result?.text).toBe("from-local-stub");
      expect(result?.provider).toBe("anthropic");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:9099/v1/messages",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("trailing slashes on *_BASE_URL don't produce double slashes in the request URL", async () => {
    const longConversation = Array.from({ length: 11 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENROUTER_BASE_URL", "http://127.0.0.1:9099/api///");

    try {
      await compactLocally(longConversation, null, { OPENROUTER_API_KEY: "sk-or-test" }, () => {});
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:9099/api/v1/chat/completions",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("returns null when the provider returns empty text (treats it as failure, not silent success)", async () => {
    // A defensive guard: if the LLM returns 200 with an empty content
    // field (e.g. content filter triggered, max_tokens=0, etc.), we
    // don't want to write an empty handoff_markdown to the backend
    // and call it a day. Fall through to hosted instead.
    // 11 messages to bypass the passthrough fast path.
    const longConversation = Array.from({ length: 11 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await compactLocally(longConversation, null, { OPENROUTER_API_KEY: "sk-or-test" }, () => {});
      expect(result).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
