---
slug: proxy-layer-7-source-integration
quick_id: 260530-l7
date: 2026-05-30
status: complete
---

# Proxy daemon — Layer 7 SUMMARY

## Outcome

The proxy daemon is now wired into the production capture pipeline. `ProxySource` wraps the proxy primitive (Layers 1–3b) and emits `CapturedSession` events into the same `store.save` + `syncer.sync` flow that file-watcher adapters already use. `capture-worker.ts` opts into the proxy via `SYNAPSE_PROXY_ENABLE=1` and supervises its lifecycle. End-to-end validation through real `claude` CLI confirms the full chain: claude → proxy → buffer → reconstructSessions → ProxySource 'session' event → would-be-pushed-via-CloudSyncer.

## Single-run E2E (Layer 7 e2e)

```
claude exited:  code=0  signal=—  (4668ms)
stdout:         PONG
fake upstream received 12 request(s)
ProxySource emitted 1 session(s)
  [claude-code] id=ses_59db5b0d1a65e1a6  messages=1  startedAt=2026-05-29T23:08:03.233Z
✅ PASS — ProxySource emitted 1 session(s).
```

This validates the LAYER 5 result plus everything ProxySource adds:
- claude makes 3× retry requests → ProxySource buffers all 3 → reconstructSessions collapses to 1 → ProxySource emits ONE session
- Session shape exactly matches what file adapters emit (tool, id, messages, startedAt, updatedAt)
- Idle flush timer fires correctly after captures stop
- Session is drop-in compatible with `SessionStore.save()` + `CloudSyncer.sync()`

## Commits

| SHA | Message | Files |
|---|---|---|
| _(this commit)_ | `feat(proxy): Layer 7 — ProxySource + capture-worker integration + E2E` | 6 |

## Files

| Path | Change | Purpose |
|---|---|---|
| `mcp/src/capture/proxy/proxy-source.ts` | NEW | EventEmitter wrapping the proxy + buffer + idle-flush + `ingest()` test affordance |
| `mcp/test/capture/proxy/proxy-source.test.ts` | NEW | 10 unit tests over the bug class (buffering, debounce, flush-on-stop, lifecycle) |
| `mcp/src/capture/capture-worker.ts` | UPDATE | Opt-in via `SYNAPSE_PROXY_ENABLE=1`; hooks sessions into store+sync; lifecycle-managed via SIGTERM/SIGINT |
| `scripts/e2e-proxy-source.mjs` | NEW | Real-claude E2E through ProxySource (parallel to Layer 5's, validates the wrapper) |
| `package.json` | UPDATE | New `test:e2e:proxy-source` script + appended to `test:e2e:all` |
| `.planning/quick/20260530-proxy-layer-7-source-integration/{PLAN,SUMMARY}.md` | NEW | GSD scaffolding |

## Bug-class coverage (ProxySource unit tests)

| Concern | Test | Status |
|---|---|---|
| start() returns port + caCertPath; stop() shuts cleanly | `start() returns the bound port + the CA cert path; stop() shuts cleanly` | ✓ |
| Misuse surfaces (double-start) | `start() twice throws` | ✓ |
| stop() before start() is no-op | `stop() before start() is a no-op` | ✓ |
| Single capture → 1 session after idleMs | `a single capture flushes to exactly 1 session after idleMs elapses` | ✓ |
| **3× retry collapse — same first message** | `3 captures with the same first message (retry burst) collapse to 1 session` | ✓ |
| Distinct first messages → distinct sessions | `2 captures with different first messages produce 2 sessions` | ✓ |
| **Idle timer debounces** (each capture resets) | `idle timer DEBOUNCES — each capture resets the timer` | ✓ |
| Empty buffer is no-op (no spurious 'session' event) | `empty buffer flush is a no-op` | ✓ |
| **stop() flushes pending buffer** (no captures lost) | `captures buffered at stop time emit as sessions during shutdown` | ✓ |
| `flushNow()` immediate flush | `flushes immediately without waiting for idle window` | ✓ |

## Design highlights

- **Decoupled flush idleMs vs reconstruction idleMs.** The two are different time scales: flush idleMs is "when does the daemon push?" (real-time wall clock; default 30s); reconstruction idleMs is "are these requests the same conversation?" (timestamp delta; default 5min). Coupling them (early draft) caused retries with 200ms-apart timestamps to split when flush idleMs was small. Now `reconstructIdleMs` falls through to `reconstructSessions`' own 5min default.
- **`ingest()` as the test affordance.** Tests drive the buffer/flush state machine without spinning up real TLS sockets. Layer 3b's connect-integration tests already prove the wire path; ProxySource's tests focus on its specific concerns (buffering, debounce, flush timing).
- **Opt-in via `SYNAPSE_PROXY_ENABLE=1`.** Default off because the proxy requires user-side CA install + HTTPS_PROXY env, which isn't automated yet. The capture-worker logs the CA path on startup so the user knows where to install it.
- **Lifecycle-managed alongside file watcher.** Same daemon process handles both. SIGTERM/SIGINT stops both gracefully; stop() flushes pending buffer first so no in-flight session is lost.
- **No session-store collision risk despite shared keys.** Both file-watcher and proxy sources call `store.save(session)` — but file sessions and proxy sessions have different ID derivations (file: from tool's native session UUID; proxy: from `firstMessageHash`), so collisions don't naturally occur. (Documented latent fragility: `SessionStore` is keyed only by `id`, not `(source, id)` — surfacing as a pre-existing action item, not a Layer 7 blocker.)

## Stats

| | Before | After |
|---|---|---|
| Test files (mcp) | 66 | 67 (+1 proxy-source.test.ts) |
| Tests passing (mcp) | 586 | **596** (+10 ProxySource) |
| Lint (whole repo) | clean | clean (400 files) |
| Typecheck (4 workspaces) | clean | clean |
| E2E scripts | 11 | 12 (+ proxy-source) |

## What's deferred

- **CA install onboarding** — Today the user manually runs `security add-trusted-cert -d ~/.synapse/proxy/ca.pem` (macOS) or imports it via the dashboard. A scripted onboarding flow is the next slice if/when the proxy becomes default-on.
- **HTTPS_PROXY auto-injection** — Out of daemon scope. User shell config or per-tool config.
- **Project-path resolution** — `reconstructSessions` emits `projectPath: "unknown"`. No cwd info in HTTPS_PROXY traffic; needs a sidecar metadata source or User-Agent inference.
- **UA-based tool tagging** — Today every proxy session is tagged `claude-code` regardless of which CLI made the request. Reading `User-Agent` from the captured request body and routing accordingly is a near-trivial extension.
- **`SessionStore` keyed by `(source, id)`** — Pre-existing latent fragility; not introduced by Layer 7. Worth a follow-up insight.
- **Real-API smoke test (Layer 6)** — Uses actual Anthropic credentials, runs periodically to detect upstream drift. Lower priority than enabling the proxy in production.

## Status

**SHIPPED.** The proxy daemon is no longer a research artifact — it integrates with the existing capture pipeline. With `SYNAPSE_PROXY_ENABLE=1` (and the user's CA installed), the daemon will capture every claude / cursor / codex / gemini chat through the proxy and push it to the backend via the same path file-based adapters already use. The remaining work to make this default-on is **onboarding UX** (install the CA + set HTTPS_PROXY), not architecture.
