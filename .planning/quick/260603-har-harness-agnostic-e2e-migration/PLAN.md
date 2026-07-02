---
quick_id: 260603-har
description: Make every e2e script harness-agnostic — no more hardcoded claude -p outside the merge gate
date: 2026-06-03
status: complete
---

# Quick Task 260603-har — Harness-Agnostic E2E Migration

## Problem

The merge gate (`npm run test:e2e`) was already harness-agnostic — `e2e-happy-flow.mjs` uses `e2e-llm-driver.mjs` (direct-API curl OR CLI-driver), and the four proxy/adapter scripts use curl directly. But **four non-merge-gate scripts still hardcoded `spawnSync("claude", ["-p", prompt])`** with no fallback:

- `scripts/e2e-insight-roundtrip.mjs` (IR2 stage)
- `scripts/e2e-insight-supersede.mjs` (IS2 stage)
- `scripts/e2e-multi-account.mjs` (MA1 precheck + MA2 capture)
- `scripts/e2e-multi-device.mjs` (MD2 + MD9 stages)

These tests fail outright on any system without `claude` on PATH — even when `ANTHROPIC_API_KEY` is present and the direct-API path would have worked. That's "still relies on claude for verification" — exactly what the user was told.

## Scope

| # | Change | File |
|---|---|---|
| 1 | Extend driver with `forceCli` + `extraEnv` opts | `scripts/e2e-llm-driver.mjs` |
| 2 | Migrate insight-roundtrip IR2 | `scripts/e2e-insight-roundtrip.mjs` |
| 3 | Migrate insight-supersede IS2 | `scripts/e2e-insight-supersede.mjs` |
| 4 | Migrate multi-account (precheck + MA2) | `scripts/e2e-multi-account.mjs` |
| 5 | Migrate multi-device MD2 + MD9 with `forceCli` + `extraEnv` | `scripts/e2e-multi-device.mjs` |
| 6 | Live verify | `npm run test:e2e` + `e2e-insight-roundtrip.mjs` spot check |

## Why two new driver opts

- **`forceCli`** — multi-device tests depend on the spawned CLI's SessionEnd hook firing so hook-dispatch routes captures to the right device's daemon via `SYNAPSE_HOME`. Direct-API curl has no hook → would silently break the cross-device-handoff semantics this test verifies. `forceCli: true` overrides the default direct-API preference even when `ANTHROPIC_API_KEY` is set.
- **`extraEnv`** — multi-device MD9 needs `SYNAPSE_HOME=deviceBSynapseHome` passed to the spawned CLI so the hook dispatches to Device B's daemon. Without this, both devices' captures collide into Device A.

Both opts default to safe values (`forceCli: false`, `extraEnv: undefined`), so the migration is a no-op for the merge-gate `happy-flow.mjs` caller.

## Verification protocol

1. Syntax-check each .mjs (`node --check`)
2. Lint root (`npm run lint` — biome)
3. Run full merge gate (`npm run test:e2e`) — 5 scripts must complete (npm `&&` chain stops on first failure)
4. Spot-check one migrated script live: `node scripts/e2e-insight-roundtrip.mjs` — must report 8/8 pass with IR2 emitting `session captured via cli-driver (claude -p)`

## Non-scope

- Wire `e2e-real-tool-roundtrip.mjs` into merge gate (still blocked by crush macOS keychain — task #203)
- Add macOS to CI matrix (separate concern)
- Live-verify the other 3 migrated scripts (pattern-symmetric with the spot-checked one; cost vs benefit not worth it without a reason)
