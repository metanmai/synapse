---
quick_id: 260621-kya
slug: full-chain-browser-capture-e2e-extension
status: complete
date: 2026-06-21
commit: ab451768
---

# Summary — Full-chain browser-capture e2e

## What shipped

`mcp/test/integration/browser-capture-chain.test.ts` — **12 tests, all green**, closing the one seam no test crossed: the real extension capture path → a **real** `startIngestServer` → `sync(CapturedSession)`.

Real code exercised end-to-end (only `window`/`location`/`chrome` + the SSE source are simulated):
adapter → `makeHookedFetch` → `handleRelayMessage` → `installWorker`/`CaptureBuffer`/`flush` → `postCapture` → loopback HTTP → `handleIngest` (loopback+token+origin guards, allowlist schema, secret scrub) → `sync`.

Coverage:
- claude.ai full chain → `CapturedSession` (tool=`claude-ai`, `synapse://browser/claude.ai`).
- chatgpt.com across **all four** SSE variants the adapter claims (snapshot, `o:add`, `o:patch`, legacy `o:append`) — the fragile path.
- both turns captured (user request body + assistant SSE).
- security seams end-to-end: wrong token → 401 → no sync; web `Origin` → 403; extension `Origin` accepted; secret-looking content scrubbed before sync.
- drift (broken adapter → `/drift` → `rateTracker.driftHosts`) and stale (heartbeat-without-capture → `staleHosts`, cleared by a real capture).

## Why this was the right target

The chain was green in two halves (`extension/test/full-chain.test.ts` with a fetch spy; `mcp/test/unit/ingest-server.test.ts` with hand-built bodies) but the **worker-body ↔ ingest-contract seam** crossing the workspace boundary was untested — historically the exact failure surface (CORS/PNA preflight once silently dropped every POST).

## Result

- New e2e: 12/12 green. Full mcp suite: **930 pass** (was 918). typecheck + biome clean.
- Placed in `test/integration/**` so it runs in `npm test` (pre-push + CI `verify`) on every push, ubuntu + windows.

## Residual (needs the user's non-corporate browser)

The adapters are validated against *documented* wire shapes + the four variants — NOT against the **real live** claude.ai/chatgpt.com byte streams (ChatGPT especially is a documented guess). To fully close: load `extension/dist/` unpacked on a non-managed Chrome, capture one real turn each, and grab the raw ChatGPT SSE from DevTools to lock the adapter + a golden fixture against real bytes. CI's `e2e-browser-mechanics.mjs` already covers real-extension-under-xvfb mechanics.
