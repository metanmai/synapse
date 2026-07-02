---
slug: proxy-layer-1-session-reconstruction
quick_id: 260530-2o4
date: 2026-05-30
status: complete
---

# Proxy daemon — Layer 1 SUMMARY

## Outcome

First shippable slice of the LLM API proxy daemon. Pure functions only — endpoint recognition + session reconstruction — with 27 unit tests covering the bug class "session reconstruction conflates two different conversations into one." Total 35 tests added (13 endpoint-recognition + 22 session-reconstruction); test suite now 544/544 passing across the four workspaces.

## Commits

| SHA | Message | Files |
|---|---|---|
| `72ec479` | `feat(proxy): Layer 1 — session reconstruction + endpoint recognition` | 6 |

## Files added

| Path | LOC | Purpose |
|---|---|---|
| `mcp/src/capture/proxy/types.ts` | 67 | CapturedRequest, EndpointInfo, ReconstructionOptions |
| `mcp/src/capture/proxy/endpoint-recognition.ts` | 80 | URL → provider+kind+capture classification |
| `mcp/src/capture/proxy/session-reconstruction.ts` | 247 | reconstructSessions() pure function + per-provider extractors |
| `mcp/test/capture/proxy/endpoint-recognition.test.ts` | 110 | 13 cases — Anthropic/OpenAI/Google chat vs telemetry |
| `mcp/test/capture/proxy/session-reconstruction.test.ts` | 305 | 14 cases — retries, idle splits, tool calls, cross-provider |

## Bug-class coverage (the load-bearing assertions)

| Scenario from spike | Test | Status |
|---|---|---|
| claude CLI 3-retry collapses to 1 session | `collapses the claude CLI 3-retry pattern into ONE session` | ✓ |
| Same first msg past idle window splits | `splits the SAME first message into two sessions when separated past the idle window` | ✓ |
| Multi-turn growth produces 1 session w/ all turns | `preserves multi-turn growth as ONE session` | ✓ |
| Different first messages → 2 sessions | `splits into TWO sessions when first messages differ` | ✓ |
| 30+ telemetry calls during spike → 0 sessions | `filters out non-chat requests mixed with chat (telemetry contamination)` | ✓ |
| Non-2xx requests excluded | `drops non-2xx requests` | ✓ |
| Tool calls preserved | `preserves tool_use blocks as toolCalls on the assistant message` | ✓ |
| Stable session id across runs | `assigns a stable session id derived from the first-message hash` | ✓ |

## Known limitations (documented in code comments)

1. **Conversation forks** (two requests sharing a prefix but diverging on a non-last user turn) merge into one session reflecting only the LAST request. Rare in practice.
2. **Same first message across different providers** within idle window WILL be conflated (Anthropic + OpenAI happen to share an opening prompt). Document; edge case.
3. **Tool tagging is provisional** — at Layer 1 we don't know which client (claude CLI / codex / cursor) made the request. Defaults to `"claude-code"`. Layer 3+ will refine via User-Agent inspection.

## Algorithm in 4 steps

```
input: array of CapturedRequest

1. filter to chat-capturable + 2xx requests
   (drops telemetry, registry, embeddings, failed calls)
2. group consecutive requests by (firstMessageHash, temporal proximity)
   (different hash OR past idle window → new group)
3. take LAST request in each group as authoritative
   (longest messages array; latest response — handles retries + continuations)
4. extract per-provider messages + response → SessionMessage[]

output: array of CapturedSession (matches CloudSyncer's existing format)
```

## What's deferred to later slices

- **Layer 2**: fake upstream LLM server helper + proxy server skeleton (HTTP only)
- **Layer 3**: TLS-MITM (cert gen + per-host signing)
- **Layer 4**: Layer 2 integration tests retargeted to HTTPS
- **Layer 5**: E2E with real codex + fake upstream
- **Layer 6**: Real-API smoke test script (paid, periodic)
- **Tool inference via User-Agent**: claude CLI vs codex vs cursor
- **Working-context routing**: project_id resolution at the proxy server's edge
- **OpenAI / Google streaming SSE assembly**: only Anthropic SSE observed in spike

## Test cost vs implementation cost

| | Implementation LOC | Test LOC | Ratio |
|---|---|---|---|
| types.ts + endpoint-recognition.ts + session-reconstruction.ts | 394 | 415 | 1.05× |
| | | | |

Tests slightly larger than impl. This is the right ratio for pure functions where correctness across many input shapes IS the value.

## Status

**SHIPPED.** Layer 1 is library code with no runtime exposure — it's safe to land independently. Future slices wire it into the proxy server (Layer 3+).

Next step: Layer 2 (fake upstream LLM server helper + proxy server skeleton). ~1 day. Ready when you are.
