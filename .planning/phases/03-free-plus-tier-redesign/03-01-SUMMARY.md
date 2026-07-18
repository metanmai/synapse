---
phase: 03-free-plus-tier-redesign
plan: 1
status: complete
completed: 2026-05-29
requirements-completed: [TIER-01]
commits: [e4fec203]
---

# Plan 03-01 — Tier Constants — Summary

Centralized the Free/Plus capacity policy in `backend/src/lib/constants.ts` and exposed tier-string plus Hono-context accessors from `backend/src/lib/tier.ts`.

## Shipped

- Per-tier insight, conversation, device, and auto-sync constants.
- `getInsightCapForTier`, `getConversationCapForTier`, `getDeviceCapForTier`, and `isAutoSyncEnabledForTier` accessors with context delegates.
- Unit coverage in `backend/test/lib/tier-enforce.test.ts`.

## Evidence

- Implementation commit in this mirror: `e4fec203`.
- Current constants remain Free/Plus insights 10/50, conversations 10/50, devices 3/10, and auto-sync Plus-only.

## Deviations

None material. Behavioral limit changes were kept in the later enforcement slices.
