---
quick_id: 260621-jig
slug: ci-e2e-driver-prefer-deepseek-over-openr
status: complete
date: 2026-06-21
---

# Summary — CI e2e driver prefers DeepSeek over OpenRouter

## What shipped

| Change | File |
|---|---|
| `PROVIDERS` reordered `[Anthropic, DeepSeek, OpenRouter]` (DeepSeek now beats OpenRouter; Anthropic stays index 0) + precedence comments | `scripts/e2e-llm-driver.mjs` |
| Cost-guard unit test (5 cases) so precedence can't silently drift back | `mcp/test/unit/e2e-llm-driver-provider.test.ts` |
| Comment-only: production precedence INTENTIONALLY diverges (quality vs cost) | `mcp/src/capture/llm-providers.ts` |

## Why / scope

CI passes all three provider keys; with Anthropic unset on metanmai, `detectProvider` was picking OpenRouter (array index 1) over DeepSeek (index 2) — ~100× pricier for no test benefit. Reordering makes DeepSeek the default while keeping Anthropic top-priority if explicitly configured.

Per the user's choice (AskUserQuestion), **production local-compact is unchanged** — only the e2e driver. The production file's comments were updated so they no longer falsely claim lockstep with the driver.

## Result

- New guard test 5/5 green; mcp typecheck + biome clean.
- The driver is e2e-only (not imported by production) — confirmed before editing.
- **Caveat:** the cost saving only takes effect once the e2e jobs run again. They're currently cascade-skipped behind the stale `SYNAPSE_E2E_API_KEY` (owner must rotate that secret — separate issue).
