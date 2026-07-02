---
quick_id: 260621-jig
slug: ci-e2e-driver-prefer-deepseek-over-openr
status: complete
date: 2026-06-21
---

# Quick Task 260621-jig: CI e2e driver prefers DeepSeek over OpenRouter

## Problem

metanmai CI carries both `OPENROUTER_API_KEY` and `DEEPSEEK_API_KEY`. The e2e driver's `detectProvider` returns the first match in `PROVIDERS` order `[Anthropic, OpenRouter, DeepSeek]`, so OpenRouter wins — ~100× more expensive than DeepSeek for zero test-quality benefit (the driver just needs *some* working LLM to drive a session).

## Decision / scope

User chose **CI only** (AskUserQuestion). Production local-compact (`mcp/src/capture/llm-providers.ts`) keeps `Anthropic > OpenRouter > DeepSeek` for compaction quality — NOT changed, only its now-divergent comments updated.

## Tasks

1. `scripts/e2e-llm-driver.mjs` — reorder `PROVIDERS` to `[Anthropic, DeepSeek, OpenRouter]` (Anthropic stays index 0 so `PROVIDERS[0]` legacy refs are unchanged; explicit Anthropic key still wins). Update precedence doc comments.
2. `mcp/test/unit/e2e-llm-driver-provider.test.ts` — cost-guard unit test (imports the driver, side-effect-free): DeepSeek beats OpenRouter when both set; Anthropic still wins when set; single-key cases; null when none.
3. `mcp/src/capture/llm-providers.ts` — comment-only: note the production precedence INTENTIONALLY diverges from the e2e driver (quality vs cost). No behavior change.

## Verify

Guard test green; mcp typecheck + biome clean; full verify green on push. Note: the savings only materialize once the e2e jobs actually run again (currently cascade-skipped behind the stale `SYNAPSE_E2E_API_KEY` — owner-side).
