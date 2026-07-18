---
phase: 03-free-plus-tier-redesign
plan: 5
status: complete
completed: 2026-05-29
requirements-completed: [TIER-05, TIER-06]
requirements-superseded: [TIER-07]
commits: [2870d239, 246ea69e, 2f751a91, a48a0e95, 3776c154]
---

# Plan 03-05 — Manual Sync and Device Cap — Summary

Shipped stable per-machine identity, 3/10 device limits, manual sync, and the original daemon tier gate. The gate was later deliberately removed so crash-safe continuity works on every tier.

## Shipped

- `~/.synapse/device.json` machine UUID and end-to-end `machine_id` wiring.
- Database uniqueness and same-machine key reuse via migration 025.
- Free/Plus device caps of 3/10 and device-cap recovery UI.
- `synapsesync sync` one-shot manual sync for explicit recovery and diagnostics.
- Periodic daemon sync for every tier, superseding the original Plus-only gate.

## Evidence

- Backend and schema: `2870d239`; MCP/manual sync: `246ea69e`; auth wiring: `2f751a91`; production migration recheck: `a48a0e95`.
- Current constants and source still implement the 3/10 cap, stable machine ID, manual command, and all-tier daemon continuity.

## Deviations

The frontend recovery flow ultimately landed through the CLI-auth device-limit picker rather than the exact settings-page file list in the original plan. More importantly, `3776c154` removed the Free/Plus daemon gate because the core “next session knows where the last one left off” promise must survive crashes for every user. TIER-07's tier-revision invalidation became unnecessary and is recorded as superseded, not missing.
