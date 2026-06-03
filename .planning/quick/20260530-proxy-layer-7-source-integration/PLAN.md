---
slug: proxy-layer-7-source-integration
quick_id: 260530-l7
date: 2026-05-30
status: in-progress
---

# Proxy daemon — Layer 7: ProxySource + capture-worker integration

## Goal

Turn the proxy daemon from a working primitive into a real production capture path. Wire `onCaptured` into the existing CloudSync pipeline so that sessions claude (and friends) make through the proxy actually get persisted + pushed to the backend — same flow file-watcher adapters already use.

## What's already in place

- Proxy server (Layers 1–3b) — captures HTTP/HTTPS requests as `CapturedRequest`
- `reconstructSessions(requests)` (Layer 1) — already returns the canonical `CapturedSession` shape from `mcp/src/capture/types.ts` (drop-in compatible)
- `SessionStore.save(session)` — persists to `~/.synapse/sessions/<id>.json`
- `CloudSyncer.sync(session)` — POSTs to backend; returns boolean
- `capture-worker.ts` daemon already wires watcher 'session' → store.save and 'idle' → syncer.sync for file adapters

## What this slice adds

```
mcp/src/capture/proxy/
└── proxy-source.ts                       ← NEW: ProxySource (owns proxy + buffer + flush timer)

mcp/test/capture/proxy/
└── proxy-source.test.ts                  ← NEW: ~8 unit tests over the bug class

mcp/src/capture/
└── capture-worker.ts                     ← UPDATE: opt-in proxy spawn via env

scripts/
└── e2e-proxy-source.mjs                  ← NEW: real claude through ProxySource → assert session emit

package.json                              ← UPDATE: +test:e2e:proxy-source
```

## Design

**`ProxySource` is an EventEmitter that wraps the proxy primitive.** It owns:
- A `TlsManager` instance (so the CA persists across restarts at `~/.synapse/proxy/ca.pem`)
- A `ProxyServer` instance (the actual port-listening proxy)
- An in-memory buffer of `CapturedRequest` (one entry per intercepted chat call)
- An idle timer (resets on each capture; fires `reconstructSessions()` + emits `'session'` after N ms quiet)

Public API:
```typescript
const source = new ProxySource({ idleMs: 30_000 });
const { port, caCertPath } = await source.start();
source.on("session", (session: CapturedSession) => { /* save + sync */ });
// ... daemon runs ...
await source.stop();  // flushes pending buffer before shutdown
```

**`capture-worker.ts` opt-in via `SYNAPSE_PROXY_ENABLE=1`.** Default off — proxy is not yet onboarded (user has to install CA + set HTTPS_PROXY, none of which is automated yet). Setting the env var spawns the proxy alongside the file watcher; sessions from BOTH sources flow into the same `store.save` + `syncer.sync` path. SIGTERM / SIGINT also stops the proxy cleanly (no captures lost — `stop()` flushes pending buffer).

**`reconstructSessions()` is called per-flush, not per-capture.** This is what makes the buffer matter: claude's 3× retry pattern produces 3 `CapturedRequest`s within a few hundred ms of each other; flushing them as a batch lets reconstructSessions collapse them to one session. If we'd flushed eagerly per-capture, we'd emit 3 duplicate sessions.

**Idle window choice.** Default `idleMs: 30_000` (30s) — long enough to absorb retries + a follow-up turn in the same prompt, short enough that finished sessions get pushed promptly. Configurable via env (`SYNAPSE_PROXY_IDLE_MS=…`).

## Bug class under test

> The ProxySource: (a) buffers captures but never emits sessions, (b) loses captures on stop, (c) emits one session per capture instead of grouping retries, (d) crashes the daemon when the proxy errors out, OR (e) confuses chat captures with the buffered telemetry that reconstructSessions is supposed to filter.

Tests:
- start/stop round-trip returns port + CA path; cleanup is clean
- A single chat capture → after idleMs → exactly 1 session emitted
- 3 captures with same first message (retries) within idle window → 1 session emitted
- 2 captures with different first messages → 2 sessions emitted
- Stop() flushes pending buffer (no captures lost between idle window and shutdown)
- Telemetry capture (endpoint.capture=false) buffered but never emits a session
- 0 captures → 0 sessions (idle timer doesn't fire on empty buffer)
- Idle timer resets on each capture (debounce works)

## E2E validation

`scripts/e2e-proxy-source.mjs` — spawns real claude through a ProxySource (not directly against the proxy primitive). Asserts a session is emitted with the user prompt readable in the messages array. Soft-skips if `claude` not on PATH (same pattern as Layer 5).

## Out of scope (follow-ups)

- CA install onboarding (system keychain via `security add-trusted-cert` for macOS; nudge the user via dashboard for GUI tools) — Layer 8 / onboarding
- HTTPS_PROXY env auto-injection — outside daemon's purview; user-shell or per-tool config
- `projectPath: "unknown"` is what reconstructSessions emits today — the proxy doesn't know which project the request came from (no cwd info in HTTPS_PROXY traffic). Sidecar metadata source needed; deferred
- UA-based tool inference (today everything's tagged `claude-code` regardless of which CLI made the request) — also deferred

## Definition of done

- `npm run typecheck` clean across 4 workspaces
- `npm run lint` clean
- `npm run test` clean (new ProxySource tests pass; existing tests don't regress)
- `npm run test:e2e:proxy-source` (when `claude` available) emits ≥1 session
- Atomic commit + push
- Insight saved
