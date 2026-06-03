---
phase: 02-real-user-identity
plan: 2
status: complete
wave: 2
completed: 2026-05-20
commits:
  - "e6a4847 — Slice A: identity bootstrap end-to-end (IDENT-01)"
  - "8d34d7b — biome organize-imports cleanup"
---

# Plan 02-02 — Identity Bootstrap (Slice A) — SUMMARY

> Wires the real `public.users` UUID through the capture pipeline. Replaces the `"default"` placeholder with a config-driven `user_id` everywhere the daemon and hook-dispatch path read it.

## What shipped

End-to-end identity flow: backend `/api/account/me` → `runInit` fetches and persists `user_id + email` to `~/.synapse/config.json` → daemon + hook-dispatch read it via a single shared `readUserIdFromConfig` helper.

| Layer | Change | File |
|------|--------|------|
| Backend (T1) | NEW `GET /api/account/me` returning `{ user_id, email, tier? }` | `backend/src/api/auth.ts` (+9 LOC) |
| MCP capture (T2) | NEW `readUserIdFromConfig` single-source helper | `mcp/src/capture/identity.ts` (NEW, 34 LOC) |
| MCP CLI (T2) | NEW `MeResponse` + `fetchMe(apiKey)` with 10s timeout | `mcp/src/cli/api.ts` (+46 LOC) |
| MCP CLI (T2) | `runInit` fetches /me FIRST (D-05 fail-fast) → `writeConfig(api_key, identity)` | `mcp/src/cli/init.ts` |
| MCP handlers (T2) | Removed duplicate inline `readUserIdFromConfig`; imports shared helper | `mcp/src/cli/handlers.ts` |
| MCP daemon (T2) | Passes `readUserIdFromConfig()` to `startHandoffLoop` | `mcp/src/cli/run-daemon.ts` |
| MCP hook-dispatch (T3) | `process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig()` replaces `?? "default"` | `mcp/src/cli/hook-dispatch.ts:59` |

**Net behaviour:** events flushed by an authenticated daemon now land in `handoff_events` with `actor_user_id` equal to the user's `public.users` UUID. The legacy `"default"` literal is removed. Env > config > `"local-user"` fallback chain is uniform across `hook-dispatch` / `handlers` / `run-daemon`.

## RED → GREEN flips

All 3 RED contracts in `mcp/test/cli/init.test.ts` (locked by Plan 02-01) flipped to GREEN:

1. ✅ `calls fetch (for /me) before any config.json write — fail-fast on /me rejection (D-05)`
2. ✅ `persists user_id + email to ~/.synapse/config.json on /me success (D-01)`
3. ✅ `is idempotent on re-run with same key (D-01)`

3 previously-`.skip`'d hook-dispatch contract tests activated GREEN: env-wins, config-fallback, placeholder.

3 previously-`.skip`'d auth-me tests stay `.skip`'d behind the live-DB gate (Wave 0 convention); structural auth-rejection tests pass today as regression guards.

## Test suite state after commit

- mcp: 365 active passing, 167 skipped, **4 RED remaining** (cleared by Plans 02-03 + 02-04)
- backend: unchanged (380 passing)
- packages/shared: unchanged (72 passing)
- frontend: unchanged

## Quality gates

- **TypeScript:** `cd mcp && npx tsc --noEmit` and `cd backend && npx tsc --noEmit` both pass.
- **Biome:** lint passes after the `8d34d7b` organize-imports cleanup (handlers.ts unused `fs`/`path` removed; init.ts type-import ordering canonicalised).
- **Vitest:** all 4 workspaces exit 0 once Wave 2 ships in full (intentional CI-red interim per Wave 0 plan).

## Deviations from plan

None of substance. The plan's "fetch /me before config.json write" wording is honoured literally — `fetchMe()` is the first network/disk operation in `runInit`; on rejection, the function aborts before any disk write.

`actor.hostname` vs `api_keys.label` (RESEARCH Open Question 2): deferred — Plan 02-03 uses `actor.hostname` directly. The label-join is parked as a Phase 3+ follow-up.

## Next steps

- Plan 02-03 (Wave 2 parallel) — device-origin brief renderer. Same wave; shipped together.
- Plan 02-04 (Wave 3) — cross-device link + eager pull (the data-flow side of IDENT-02).
- Plan 02-05 (Wave 4) — manual link UI.
