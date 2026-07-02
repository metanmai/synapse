---
slug: proxy-layer-1-session-reconstruction
quick_id: 260530-2o4
date: 2026-05-30
status: in-progress
---

# Proxy daemon — Layer 1: session reconstruction + endpoint recognition (pure)

## Goal

First shippable slice of the LLM API proxy daemon. Layer 1 from the build plan:
- **Endpoint recognition** — URL → (provider, kind, captureBool) classification with explicit allowlist of chat endpoints (filters out the 30+ telemetry/registry calls the spike showed claude CLI makes).
- **Session reconstruction** — pure function `reconstructSessions(requests, opts) → CapturedSession[]` that converts a stream of captured HTTP requests into CapturedSession entries usable by the existing CloudSyncer.
- **Bug-class guarded**: "the daemon conflates two different conversations into one." Tests target this directly — the claude CLI 3-retry pattern surfaced by the spike, idle-window splits, and mixed chat+telemetry streams.

No proxy server, no TLS, no integration tests in this slice. Pure functions only — shippable as library code that future slices wire into the actual proxy server.

## Files added

```
mcp/src/capture/proxy/
├── types.ts                              ← CapturedRequest, EndpointInfo, ReconstructionOptions
├── endpoint-recognition.ts               ← URL → EndpointInfo
└── session-reconstruction.ts             ← reconstructSessions() pure function

mcp/test/capture/proxy/
├── endpoint-recognition.test.ts          ← ~10 cases: anthropic/openai/google chat vs telemetry
└── session-reconstruction.test.ts        ← ~12 cases: single-turn, multi-turn, retries, idle splits, tool calls
```

## Bug class under test

> The proxy daemon's session reconstruction conflates two different conversations into one — OR splits one conversation into many — OR captures telemetry as if it were a session.

Specific scenarios that surfaced from the spike:
- **Retry collapse**: claude CLI makes 3 `/v1/messages` calls with identical `messages[0]` for a single user prompt. Must produce ONE session, not three.
- **Idle resumption**: same first message ~10 min later means the user resumed an old conversation in a new context. Should produce two sessions (new conversation).
- **Telemetry contamination**: 30+ non-chat API calls happen alongside the chat. None should become a session.

## Out of scope (deferred to later slices)

- The actual proxy server (Layer 3+)
- TLS-MITM (Layer 5)
- Integration / E2E tests (Layer 2+, requires a running server)
- OpenAI and Google streaming response assembly (only Anthropic SSE format seen in spike; others added per-provider as we observe them)
- Tool identification (claude vs codex vs cursor) via User-Agent — placeholder "proxy" used; refinement in later slice

## Definition of done

- Both `.ts` source files build (`npm run typecheck` passes)
- Both `.test.ts` test files pass (`npm run test` reports green delta)
- Lint clean (`npx biome check` zero errors)
- Pre-push hook passes
- Atomic commit, pushed to main
