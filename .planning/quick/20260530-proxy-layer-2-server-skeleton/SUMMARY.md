---
slug: proxy-layer-2-server-skeleton
quick_id: 260530-layer2
date: 2026-05-30
status: complete
---

# Proxy daemon — Layer 2 SUMMARY

## Outcome

Layer 2 of the LLM proxy daemon shipped. The Layer 1 brain (pure session reconstruction + endpoint recognition) is now wired into a real running HTTP forward-proxy server. Plus a reusable fake-LLM-server helper for tests so all subsequent layers can be exercised in CI for $0.

## Commits

| SHA | Message | Files |
|---|---|---|
| `f724981` | `feat(proxy): Layer 2 — HTTP forward-proxy server + fake LLM upstream helper` | 4 |

## Files added

| Path | LOC | Purpose |
|---|---|---|
| `mcp/test/helpers/fake-llm-server.ts` | 153 | Canned-response LLM server — handlers per path + request history |
| `mcp/src/capture/proxy/server.ts` | 232 | `createProxyServer()` — HTTP forward-proxy with capture+forward |
| `mcp/test/capture/proxy/proxy-integration.test.ts` | 322 | 8 integration tests over real HTTP sockets |

## Bug-class coverage

| Concern | Test | Status |
|---|---|---|
| Passthrough fidelity (request body) | `forwards a chat request through to upstream and returns the upstream response verbatim` | ✓ |
| onCaptured fires once with parsed bodies | `emits onCaptured exactly once for a chat request` | ✓ |
| Telemetry NOT captured but forwarded | `does NOT emit onCaptured for non-chat endpoints (telemetry passthrough)` | ✓ |
| Upstream 5xx forwards transparently | `forwards an upstream 500 transparently` | ✓ |
| Unreachable upstream → 502 to client | `returns 502 to the client when the upstream is unreachable` | ✓ |
| Concurrent requests don't cross | `handles two concurrent in-flight requests without crossing responses` | ✓ |
| Bad request line rejected | `rejects requests without an absolute URL on the request line` | ✓ |
| Hop-by-hop headers stripped | `strips client-set hop-by-hop headers while forwarding end-to-end headers` | ✓ |

## What's now runnable

```typescript
import { createProxyServer } from "./capture/proxy/server.js";
import { reconstructSessions } from "./capture/proxy/session-reconstruction.js";

const captured = [];
const proxy = await createProxyServer({
  port: 7777,
  onCaptured: (req) => captured.push(req),
});

// Tool runs with HTTP_PROXY=http://localhost:7777
// ... time passes; requests pile up in `captured` ...

const sessions = reconstructSessions(captured, { idleMs: 5 * 60 * 1000 });
// → sessions ready to push via CloudSyncer
```

End-to-end pipeline works for HTTP traffic. The only thing missing for a real Anthropic capture: TLS (Layer 5).

## What's deferred to later slices

| Layer | What | Why deferred |
|---|---|---|
| 3 | TLS-MITM (cert gen + per-host signing) | Hardest piece; do it after simpler layers are proven |
| 4 | Streaming response (SSE) handling | Buffered-then-forward works for canned tests; live UX needs stream-pipe |
| 5 | E2E with real codex + fake upstream | Validates full plumbing with a real tool |
| 6 | Real-API smoke test | Periodic upstream-drift detection |
| | User-Agent → tool inference | Currently every captured session tagged `claude-code`; UA-based refinement later |
| | Working-context routing (project_id resolution) | Proxy doesn't know cwd; needs sidecar metadata source |

## Stats

| | Before this slice | After |
|---|---|---|
| Test files | 64 | 65 |
| Tests passing | 544 | **552** (+8) |
| Lint | clean | clean |
| Typecheck | clean | clean |

## Status

**SHIPPED.** Layers 1+2 are now a runnable HTTP-traffic capture pipeline. Layer 3 (TLS-MITM) is the next gate — without it, we can't capture real Anthropic traffic, which is the whole point. Estimated effort: ~2 days for cert gen + per-host signing.
