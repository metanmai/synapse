---
quick_id: 260621-kya
slug: full-chain-browser-capture-e2e-extension
status: complete
date: 2026-06-21
---

# Quick Task 260621-kya: Full-chain browser-capture e2e

## Goal (user /goal)

Completely test the capture chain end-to-end; it must be green.

## Gap found (seam trace)

The capture chain was tested in two disconnected halves:
- `extension/test/full-chain.test.ts` — real adapters → hook → relay → worker → `postCapture`, but the daemon is a **fetch spy** (stops at the POST).
- `mcp/test/unit/ingest-server.test.ts` — the daemon ingest, but with **hand-built bodies**.

**Nothing crosses the real seam**: the worker's actual POST body → the real `startIngestServer` → `handleIngest` validation/allowlist/scrub → the `sync(CapturedSession)` callback. That seam is exactly where browser-capture historically breaks (e.g. the CORS/PNA preflight bug silently dropped every POST).

## What this builds

`mcp/test/integration/browser-capture-chain.test.ts` — a hermetic full-chain e2e (no real browser; this corporate machine can't load an unpacked extension). Drives realistic SSE → real `makeHookedFetch` → real `handleRelayMessage` → real `installWorker`/buffer/flush → real `startIngestServer` on 127.0.0.1 → asserts the `sync` spy receives a correct `CapturedSession`.

Lives in `mcp/test/integration/**` (in the `npm test` gate) and mcp tsconfig excludes tests from typecheck, so the cross-workspace import (extension src + mcp src in one test) is safe.

Coverage:
1. claude.ai full chain → assistant turn captured, tool=`claude-ai`.
2. chatgpt.com full chain across ALL four SSE variants the adapter claims to handle (snapshot, `o:add`, `o:patch`, legacy `o:append`) — the fragile, never-live-validated path.
3. Both turns (user request body + assistant SSE) are captured.
4. Security seams end-to-end: bad token → 401 → no sync; web `Origin` → 403; loopback enforced.
5. Broken adapter → drift signal reaches the real `/drift` → `rateTracker.driftHosts` includes the host.
6. heartbeat-without-capture → `staleHosts` flags it; a real capture clears it.

## Out of scope (needs the user's non-corporate browser)

Validating the adapters against the **real live** claude.ai/chatgpt.com byte streams (the ChatGPT format is a documented guess). The L3 `scripts/e2e-browser-mechanics.mjs` (real extension under xvfb) covers browser mechanics in CI. This task locks the data-path contract; a real ChatGPT sample is the residual.

## Verify

New e2e green; full `npm test` (mcp) green; biome + typecheck clean; CI stays green.
