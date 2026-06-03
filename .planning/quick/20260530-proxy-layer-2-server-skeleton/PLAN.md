---
slug: proxy-layer-2-server-skeleton
quick_id: 260530-layer2
date: 2026-05-30
status: in-progress
---

# Proxy daemon — Layer 2: fake LLM server + HTTP proxy skeleton + integration tests

## Goal

Wire up the **body** of the proxy daemon: a real `http.Server` that accepts forward-proxy traffic (clients pointed via `HTTP_PROXY=localhost:port`), applies the Layer 1 endpoint-recognition + session-reconstruction logic, and forwards transparently to upstream. Plus a reusable fake-LLM-server helper for tests so we can exercise the full proxy without burning real Anthropic tokens.

**HTTP only in this slice.** TLS-MITM is Layer 5 — same proxy code path; just an HTTPS wrapper around the existing core.

## Files

```
mcp/test/helpers/
└── fake-llm-server.ts                ← NEW: spins up a fake upstream with canned handlers

mcp/src/capture/proxy/
└── server.ts                          ← NEW: createProxyServer() — http.Server that
                                              captures + forwards. Uses Layer 1 modules.

mcp/test/capture/proxy/
└── proxy-integration.test.ts          ← NEW: real HTTP sockets, end-to-end roundtrip
```

## Bug class under test

> The proxy server mishandles HTTP forwarding (drops bytes, mangles headers, buffers responses wrongly) OR fails to capture chat endpoints OR captures non-chat endpoints by accident OR breaks the client's request when forwarding.

Tests target:
- **Passthrough fidelity** — client sends a request, gets back EXACTLY what upstream returned (status, headers (modulo proxy hops), body)
- **Capture trigger** — chat requests produce an `onCaptured` callback exactly once with the right CapturedRequest shape
- **Telemetry filter** — non-chat requests (mock `/event_logging`) DO get forwarded normally but DO NOT trigger `onCaptured`
- **Failure forwarding** — when upstream returns 500, the proxy forwards 500 to the client and does NOT call `onCaptured`
- **Concurrent requests** — two simultaneous clients don't get their responses crossed

## Architecture

```
Client                Proxy server                       Upstream
  │                         │                                │
  ├──── HTTP request ──────►│                                │
  │  (absolute URL in path) │                                │
  │                         │ 1. parse host+path             │
  │                         │ 2. recognizeEndpoint()         │
  │                         │ 3. resolve upstream via        │
  │                         │    upstreamMap (test) or DNS   │
  │                         ├────── HTTP request ───────────►│
  │                         │ 4. buffer req body if capture  │
  │                         │                                │
  │                         │◄───── HTTP response ───────────┤
  │                         │ 5. buffer res body if capture  │
  │                         │ 6. if capture: emit CapturedRequest
  │◄───── HTTP response ────┤    via onCaptured callback     │
  │                         │ 7. forward response to client  │
```

## Out of scope

- TLS / HTTPS (Layer 5)
- SSE streaming response capture (Layer 4 — requires special handling for `text/event-stream`)
- Session reconstruction triggering from a buffered queue (deferred)
- User-Agent → tool name inference
- Project routing via working_context

## Definition of done

- `npm run typecheck` passes
- `npm run test` shows +N tests, all green
- `npx biome check` clean
- One commit + push (atomic)
- SUMMARY.md written
