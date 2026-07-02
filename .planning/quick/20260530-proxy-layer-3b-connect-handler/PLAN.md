---
slug: proxy-layer-3b-connect-handler
quick_id: 260530-l3b
date: 2026-05-30
status: in-progress
---

# Proxy daemon — Layer 3b: CONNECT handler + TLS termination

## Goal

Wire the Layer 3a TLS infrastructure into the Layer 2 proxy server so the proxy can intercept real HTTPS traffic. After this slice, the proxy daemon does the actual point of the whole exercise: a tool with `HTTPS_PROXY=localhost:<port>` and our CA trusted sees `api.anthropic.com` as itself; the proxy sees plaintext bodies.

## Files

```
mcp/src/capture/proxy/
└── server.ts                              ← UPDATE: add CONNECT handler + outbound HTTPS

mcp/test/helpers/
└── fake-llm-server.ts                     ← UPDATE: add createFakeTlsLLMServer parallel factory

mcp/test/capture/proxy/
└── connect-integration.test.ts            ← NEW: ~8 tests on real TLS sockets
```

## Design

**Two-server pattern.** An *outer* `http.Server` (already exists, Layer 2) handles plain HTTP forward-proxy requests and listens for the `connect` event. An *inner* `http.Server` (never `.listen()`-ed) is fed decrypted-TLS sockets via `internalServer.emit('connection', tlsSocket)`. Both server's request handlers route into the same `handleRequest()` function with an optional `tunnel: TunnelContext` parameter that tells it where the bytes really came from. Reuses the parser, capture path, and onCaptured emit point.

**TunnelContext stashed on the TLS socket via WeakMap.** When the CONNECT request arrives, we know the host:port the client wanted. After TLS termination, the inner http.Server sees a relative request URL (`/v1/messages`) with no host context. We bridge the two by setting `tunnelContexts.set(tlsSocket, { host, port })` before emitting `'connection'`, and retrieving it from the request handler via `tunnelContexts.get(req.socket as TLSSocket)`. WeakMap = no leak on socket GC, typed via cast at one site.

**Outbound: `https.request` when tunneled.** New `resolveUpstream()` returns `{ hostname, port, scheme, servername }` — the servername preserves the ORIGINAL host (e.g., `api.anthropic.com`) even when `upstreamMap` routes to `127.0.0.1`. Means the fake upstream presents its cert FOR the original host, and TLS validation passes against the original hostname's SAN — no IP-cert gymnastics.

**`upstreamCa` option for tests.** Lets the integration test pass our self-signed CA to the proxy's outbound TLS validation. Without this, the proxy would refuse to validate the fake's cert (since it's not in Node's default trust store). Production callers leave this undefined.

**CONNECT-handler defensive layer.** `parseConnectTarget()` validates: non-empty host, no CRLF/null/slash/backslash, port in 1-65535. TlsManager's hostname regex is the deeper defense; this layer just produces a clean 400 instead of a 500 stack trace. No TlsManager = 405 Method Not Allowed.

## Bug class under test

> The proxy's HTTPS CONNECT path: (a) fails to accept the tunnel, (b) terminates TLS with the wrong cert (cross-host leak), (c) fails to decrypt + parse the inner HTTP request, (d) fails to forward outbound to a real HTTPS upstream, (e) double-captures or miscaptures the chat request, (f) crashes on malformed CONNECT input.

Tests target:
- Happy path: HTTPS request flows through, captured once, body fidelity
- Telemetry (non-chat) endpoint via HTTPS forwarded but NOT captured
- Two concurrent tunnels don't cross responses
- Malformed CONNECT target → 400
- Path-traversal hostname in CONNECT → 400 (not 500)
- No TlsManager configured → 405 (CONNECT unsupported)
- Per-hostname cert isolation: tunnel A's cert ≠ tunnel B's cert (cross-host poisoning defense)
- Regression: Layer 2's plain-HTTP forward path still works alongside TLS support

## Out of scope (deferred)

- Layer 4: SSE streaming responses (Layer 2's buffer-then-forward still in place)
- Layer 5: E2E with real `claude` CLI + real `node` HTTPS client
- Layer 6: Real-API smoke test against actual Anthropic

## Definition of done

- `npm run typecheck` passes (mcp workspace)
- `npm run lint` passes (biome)
- `npm run test` passes — Layer 2 tests still green + new Layer 3b tests green
- Atomic commit + push to `main` on tanmain remote (CI on metanmai green within 5-10 min)
- Insight saved to Synapse with Layer 3b shipped status
