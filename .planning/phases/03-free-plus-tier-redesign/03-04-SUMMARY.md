---
phase: 03-free-plus-tier-redesign
plan: 4
status: complete
completed: 2026-05-29
requirements-completed: [TIER-04]
commits: [a2836b8d]
---

# Plan 03-04 — Insight Capacity — Summary

Shipped Free-tier insight LRU and Plus-tier asynchronous LLM consolidation with a scheduled recovery path.

## Shipped

- Free users evict the oldest active insight when the per-project cap is reached.
- Plus users trigger `consolidateOldestInsights` asynchronously and retain over-cap data on LLM failure.
- The consolidation prompt creates 3–5 replacements and supersedes source insights.
- A scheduled retry scans over-cap Plus projects.
- Unit and live-path E2E coverage protect the cap, active-row, and consolidation behavior.

## Evidence

- Implementation, retry worker, tests, and E2E: `a2836b8d`.
- Current wiring remains in `backend/src/api/insights.ts`, `backend/src/lib/llm/insight-consolidate.ts`, and `backend/src/cron/retry-consolidations.ts`.

## Deviations

The retry job shipped in the same slice rather than as a later operational follow-up.
