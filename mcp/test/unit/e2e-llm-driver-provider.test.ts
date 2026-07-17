// mcp/test/unit/e2e-llm-driver-provider.test.ts
//
// Cost-guard for the E2E LLM driver's provider precedence.
//
// Bug class under guard: "the PROVIDERS order drifts so that OpenRouter is
// picked ahead of DeepSeek again, silently making every CI e2e run ~100×
// more expensive." metanmai CI carries BOTH DEEPSEEK_API_KEY and
// OPENROUTER_API_KEY, so the precedence is the only thing deciding cost.
//
// Hosted in mcp/test/unit/ (not scripts/) for the same reason as
// stale-projects.test.ts: the scripts/ tree has no test runner of its own,
// and the mcp workspace's `npm test` picks this up. detectProvider takes an
// explicit `env` object, so no process.env mutation is needed. Importing the
// driver is side-effect-free (no top-level main run).

import { describe, expect, it } from "vitest";
import { detectProvider, toWellFormedUnicode } from "../../../scripts/e2e-llm-driver.mjs";

describe("e2e-llm-driver detectProvider — precedence (cost guard)", () => {
  it("prefers DeepSeek over OpenRouter when BOTH keys are set (the cost guard)", () => {
    // This is the assertion that keeps CI cheap. If precedence ever flips
    // back to OpenRouter-first, this fails loudly instead of quietly billing.
    const { provider, apiKey } = detectProvider({
      OPENROUTER_API_KEY: "or-key",
      DEEPSEEK_API_KEY: "ds-key",
    });
    expect(provider?.name).toBe("DeepSeek");
    expect(apiKey).toBe("ds-key");
  });

  it("still prefers Anthropic when ANTHROPIC_API_KEY is explicitly set", () => {
    // Anthropic stays index 0: an explicit Anthropic key means someone wants
    // the real target model, so it outranks the cheap default.
    const { provider } = detectProvider({
      ANTHROPIC_API_KEY: "an-key",
      DEEPSEEK_API_KEY: "ds-key",
      OPENROUTER_API_KEY: "or-key",
    });
    expect(provider?.name).toBe("Anthropic");
  });

  it("uses OpenRouter when it is the only key present (still a valid fallback)", () => {
    const { provider, apiKey } = detectProvider({ OPENROUTER_API_KEY: "or-key" });
    expect(provider?.name).toBe("OpenRouter");
    expect(apiKey).toBe("or-key");
  });

  it("uses DeepSeek when it is the only key present", () => {
    const { provider } = detectProvider({ DEEPSEEK_API_KEY: "ds-key" });
    expect(provider?.name).toBe("DeepSeek");
  });

  it("returns null provider/apiKey when no provider key is set", () => {
    const { provider, apiKey } = detectProvider({});
    expect(provider).toBeNull();
    expect(apiKey).toBeNull();
  });
});

describe("e2e-llm-driver provider payload Unicode", () => {
  it("replaces lone UTF-16 surrogates while preserving valid pairs", () => {
    const input = "before\ud800 middle \ud83d\ude80 after\udfff";

    expect(toWellFormedUnicode(input)).toBe("before� middle 🚀 after�");
  });

  it("leaves ordinary multiline brief content unchanged", () => {
    const input = "<synapse-brief>\ntest_id=HAPPY-FLOW-1\nsecret_phrase=butterfly mountain seven\n</synapse-brief>";

    expect(toWellFormedUnicode(input)).toBe(input);
  });
});
