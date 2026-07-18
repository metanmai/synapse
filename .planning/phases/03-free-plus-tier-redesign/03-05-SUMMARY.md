---
phase: 03-free-plus-tier-redesign
plan: 5
status: partial
completed: 2026-05-29
requirements-completed: [TIER-05, TIER-06]
requirements-pending: [TIER-07]
commits: [2870d239, 246ea69e, 2f751a91, a48a0e95]
---

# Plan 03-05 — Manual Sync and Device Cap — Summary

Shipped stable per-machine identity, 3/10 device limits, Free manual sync, and daemon auto-sync gating. A historical review found that the planned near-instant tier-revision invalidation did not land.

## Shipped

- `~/.synapse/device.json` machine UUID and end-to-end `machine_id` wiring.
- Database uniqueness and same-machine key reuse via migration 025.
- Free/Plus device caps of 3/10 and device-cap recovery UI.
- `synapsesync sync` one-shot manual sync.
- Plus-only periodic daemon sync with a restrictive Free fallback.

## Evidence

- Backend and schema: `2870d239`; MCP/manual sync: `246ea69e`; auth wiring: `2f751a91`; production migration recheck: `a48a0e95`.
- Current constants and source still implement the 3/10 cap, stable machine ID, manual command, and daemon tier gate.

## Open gap

- **TIER-07 remains pending.** `mcp/src/capture/daemon.ts` caches `/api/billing/status` for five minutes and explicitly says `tier_revision` piggyback is a follow-up. A Free→Plus upgrade therefore does not yet propagate within seconds as the plan required.

## Deviations

The frontend recovery flow ultimately landed through the CLI-auth device-limit picker rather than the exact settings-page file list in the original plan. The operational behavior is present; only the low-latency tier-flip requirement remains open.
