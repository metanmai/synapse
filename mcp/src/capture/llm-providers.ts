/**
 * Local LLM provider detection + chat-completion caller for MCP-side
 * compaction. When the production backend's hosted /compact endpoint
 * can't reach an LLM (credit balance depleted, key revoked, rate limit,
 * etc.), pull-compact falls back to this module: if the user has an
 * LLM API key in env (the same keys the e2e harness uses), we compact
 * the conversation locally and POST the precomputed result.
 *
 * Bug class this guards: "the killer-feature handoff pipeline becomes
 * a single point of failure on the backend's Anthropic billing." Real
 * users with their own keys shouldn't be blocked by a transient outage
 * on the hosted compaction provider.
 *
 * Order of precedence (matches scripts/e2e-llm-driver.mjs PROVIDERS):
 *   1. Anthropic    (ANTHROPIC_API_KEY)    — provider's own /v1/messages
 *   2. OpenRouter   (OPENROUTER_API_KEY)   — OpenAI-shaped on /api/v1
 *   3. DeepSeek     (DEEPSEEK_API_KEY)     — OpenAI-shaped on /v1
 *
 * Returns null when no provider is configured; caller falls back to the
 * hosted /compact endpoint. Never throws — every error is logged and
 * surfaced via a null return, so the slow recompute path stays
 * self-healing.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMCallResult {
  text: string;
  provider: string;
  model: string;
}

export interface LLMProvider {
  /** Display name. Goes into compaction_model so the user can audit which provider compacted what. */
  name: string;
  /** Env var that holds the API key. */
  envKey: string;
  /** Default model id. Each provider's docs list these. */
  defaultModel: string;
  /**
   * Build a single fetch call that POSTs the prompt and returns the
   * response text. Implementations encapsulate provider-specific request
   * shape (Anthropic vs. OpenAI-compatible) + response parsing.
   */
  call(prompt: string, apiKey: string, maxTokens: number): Promise<string>;
}

const PROVIDERS: LLMProvider[] = [
  {
    name: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-haiku-4-5-20251001",
    async call(prompt, apiKey, maxTokens) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.defaultModel,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const block = (data.content ?? []).find((c) => c.type === "text");
      return block?.text ?? "";
    },
  },
  {
    name: "openrouter",
    envKey: "OPENROUTER_API_KEY",
    // Match scripts/e2e-llm-driver.mjs PROVIDERS — known to be available
    // on OpenRouter's catalog and cheap enough for repeated CI runs.
    // Stay in lockstep with the harness model; drift would mean local-
    // compact uses a different (potentially unavailable) model than the
    // Stage-3 chat call that already exercised the same provider.
    defaultModel: "anthropic/claude-3.5-haiku",
    async call(prompt, apiKey, maxTokens) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.defaultModel,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    },
  },
  {
    name: "deepseek",
    envKey: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    async call(prompt, apiKey, maxTokens) {
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.defaultModel,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        throw new Error(`deepseek ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    },
  },
];

/**
 * Auto-detect the first provider whose API key is set in env. Mirrors the
 * priority order in scripts/e2e-llm-driver.mjs so a user with multiple
 * keys configured gets predictable routing (Anthropic > OpenRouter > DeepSeek).
 *
 * Returns null when no key is configured — caller falls back to hosted
 * compaction. Pure function: takes env explicitly so tests can pass any
 * env shape without process.env mutation.
 */
export function detectLLMProvider(env: NodeJS.ProcessEnv): { provider: LLMProvider; apiKey: string } | null {
  for (const p of PROVIDERS) {
    const key = env[p.envKey];
    if (typeof key === "string" && key.length > 0) {
      return { provider: p, apiKey: key };
    }
  }
  return null;
}

/**
 * Build a compaction prompt that asks the LLM for a dense, fact-preserving
 * handoff document. The MUST-PRESERVE list is the load-bearing instruction
 * — without it, summarization-trained models tend to paraphrase away
 * exactly the identifiers (test ids, hash prefixes, secret values, error
 * codes) that the next session needs to recall.
 *
 * Mirrors backend/src/lib/llm/prompts.ts at the high level so the handoff
 * shape is consistent across local and hosted paths. If you change one,
 * change both — drift produces different handoffs depending on which
 * path compacted, which is a confusing user experience.
 */
export function buildCompactionPrompt(messages: ChatMessage[], title: string | null): string {
  const transcript = messages.map((m) => `[${m.role}] ${m.content ?? "(empty)"}`).join("\n\n");
  const titleLine = title ? `\nConversation title: ${title}\n` : "";
  return `Summarize this AI coding session into a dense context document. An AI agent will read this to continue the work.

MUST-PRESERVE (copy verbatim, do not paraphrase):
- All literal identifiers, IDs, hashes, version numbers, error codes.
- All quoted strings, file paths, function names, URLs.
- Any fact the user explicitly asked to remember (look for phrases like "remember", "note that", "the secret is", "test_id is").

INCLUDE: what was built, key decisions made, current state, and any unfinished work. Be specific — include file paths, function names, and technical details. Omit pleasantries and routine exchanges, but keep the must-preserve items even when they appear in routine-looking lines.
${titleLine}
## Transcript (${messages.length} messages)

${transcript}`;
}

/**
 * Call the auto-detected local LLM to compact a conversation. Returns the
 * summary text on success; null on any failure (no provider configured,
 * API error, parse error, etc.). All errors are logged but never thrown
 * — callers should always have a hosted-fallback path so a local LLM
 * outage doesn't break the handoff pipeline.
 */
export async function compactLocally(
  messages: ChatMessage[],
  title: string | null,
  env: NodeJS.ProcessEnv,
  log: (msg: string) => void,
  maxTokens = 1024,
): Promise<LLMCallResult | null> {
  const detected = detectLLMProvider(env);
  if (!detected) {
    log("local-compact: no provider key in env, skipping local path");
    return null;
  }
  const { provider, apiKey } = detected;
  log(`local-compact: using ${provider.name} model=${provider.defaultModel}`);
  const prompt = buildCompactionPrompt(messages, title);
  try {
    const text = await provider.call(prompt, apiKey, maxTokens);
    if (!text || text.trim().length === 0) {
      log(`local-compact: ${provider.name} returned empty text`);
      return null;
    }
    return { text, provider: provider.name, model: provider.defaultModel };
  } catch (err) {
    log(`local-compact: ${provider.name} call failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
