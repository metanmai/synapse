---
slug: proxy-layer-3b-connect-handler
quick_id: 260530-l3b
date: 2026-05-30
status: complete
---

# Proxy daemon — Layer 3b SUMMARY

## Outcome

The proxy daemon now does the actual point of the whole exercise: **HTTPS interception**. A real `tls.connect()` client that trusts our CA can open a CONNECT tunnel through the proxy to (e.g.) `api.anthropic.com:443`, complete a TLS handshake against the per-host leaf cert our proxy presents, and have the proxy decrypt, parse, capture, and forward the inner request to a real HTTPS upstream — all while the client thinks it's talking directly to Anthropic.

After this slice the proxy daemon's architecture stands up end-to-end for HTTPS traffic. Only stream-pipe (Layer 4 SSE handling) and the real-CLI smoke test (Layer 5) remain before it's deployable.

## Commits

| SHA | Message | Files |
|---|---|---|
| _(this commit)_ | `feat(proxy): Layer 3b — CONNECT handler + TLS termination + integration tests` | 4 |

## Files

| Path | Change | Purpose |
|---|---|---|
| `mcp/src/capture/proxy/server.ts` | UPDATE | CONNECT handler, inner http.Server pattern, dual-scheme outbound, `tlsManager` + `upstreamCa` opts |
| `mcp/test/helpers/fake-llm-server.ts` | UPDATE | `createFakeTlsLLMServer` parallel factory + shared `buildRequestListener` |
| `mcp/test/capture/proxy/connect-integration.test.ts` | NEW | 8 integration tests over real TLS sockets |
| `.planning/quick/20260530-proxy-layer-3b-connect-handler/{PLAN,SUMMARY}.md` | NEW | Quick-task scaffolding |

## Bug-class coverage

| Concern | Test | Status |
|---|---|---|
| HTTPS request flows through, captured exactly once, body fidelity | `proxies an HTTPS chat request end-to-end with body fidelity + exactly one capture` | ✓ |
| Telemetry over HTTPS forwarded but NOT captured | `forwards a non-chat HTTPS endpoint transparently without capturing` | ✓ |
| Concurrent tunnels don't cross | `two concurrent HTTPS tunnels do not cross responses` | ✓ |
| Malformed CONNECT → clean 400 | `rejects CONNECT with a malformed target` | ✓ |
| Path-traversal CONNECT hostname → 400 (not 500) | `rejects CONNECT with a path-traversal hostname` | ✓ |
| No TlsManager configured → 405 | `rejects CONNECT when no TlsManager is configured` | ✓ |
| **Per-hostname leaf-cert isolation** (anthropic-tunnel cert ≠ openai-tunnel cert) | `presents distinct per-hostname leaf certs (no cross-tunnel cert poisoning)` | ✓ |
| **Layer 2 regression**: plain-HTTP path still works alongside TLS | `regression: plain-HTTP forward-proxy path still works when TlsManager is configured` | ✓ |

## Design highlights

- **Two-server pattern.** Outer `http.Server` handles plain HTTP + CONNECT. Inner `http.Server` (never `.listen()`-ed) is hand-fed decrypted TLS sockets via `innerServer.emit('connection', tlsSocket)` — Node's HTTP parser does the work; no parser duplication.
- **Tunnel-context bridge via `WeakMap<TLSSocket, TunnelContext>`.** After TLS termination the inner request line is relative (`/v1/messages` with no host). The WeakMap recovers the original host from the CONNECT step; GC cleans up automatically when the socket dies.
- **`servername` preserves original host on outbound.** When `upstreamMap` routes `api.anthropic.com → https://127.0.0.1:N`, the proxy still SNIs as `api.anthropic.com`. Test fakes present a cert for the real hostname (not the IP) — no IP-SAN gymnastics, and validation passes naturally.
- **`upstreamCa` test escape hatch (not a production back-door).** Lets tests trust our self-signed CA when validating the fake upstream's cert. Production callers leave it undefined → Node's default trust store applies.
- **Defensive 400 on bad CONNECT.** `parseConnectTarget()` validates host:port shape and rejects CRLF / null / slash / backslash inputs before they reach TlsManager. TlsManager's hostname regex is the deeper defense; this layer gives a clean 400 vs a 500-with-stacktrace.

## Stats

| | Before this slice | After |
|---|---|---|
| Test files | 65 | 66 |
| Tests passing (mcp) | 552 | **586** (+8 Layer 3b; +26 from Layer 3a still counted) |
| Lint | clean (399 files) | clean |
| Typecheck (4 workspaces) | clean | clean |

## What's deferred

- **Layer 4** — SSE streaming responses (currently buffered end-to-end; works correctness-wise but client doesn't see streaming tokens live)
- **Layer 5** — E2E with a real CLI tool (`claude -p` through the proxy with `NODE_EXTRA_CA_CERTS=~/.synapse/proxy/ca.pem`) against a fake upstream
- **Layer 6** — Real-API smoke test against actual Anthropic (uses real API token, runs periodically to detect upstream drift)
- **User-Agent → tool inference** (every captured session currently tagged `claude-code`)
- **Working-context routing** (project_id resolution — proxy doesn't know the tool's cwd; needs sidecar metadata source)
- **GUI client support** (Cursor / Claude desktop / ChatGPT desktop) — requires admin password to install CA in system keychain; deferred from initial spike

## Status

**SHIPPED.** Layers 1 + 2 + 3a + 3b form a complete HTTPS-capable proxy daemon. The "I want to capture what Cursor / Codex / claude CLI is actually saying to Anthropic" promise is now structurally achievable; remaining layers are streaming UX (4), live validation against a real CLI (5), and drift detection against a real API (6).
