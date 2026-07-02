---
quick_id: 260623-vs2
slug: slice-a-capture-scoped-key-browser-ingest
status: complete-pending-review
date: 2026-06-23
commit: a3805174
---

# Summary — Slice A: capture-scoped key + browser ingest endpoint

**Status: built + fully tested LOCALLY, commit `a3805174` NOT pushed** — held for review before exposure (a push auto-deploys the endpoint to prod).

## What shipped (local)

| Piece | File |
|---|---|
| `api_keys.scope` ('full' default / 'capture'), CHECK, idempotent | `supabase/migrations/031_api_key_scope.sql` |
| Fail-closed scope gate (capture key → 403 except the one ingest path) | `backend/src/lib/auth.ts` |
| Feature-detected scope read (`select('*, users(*)')` → absent col = 'full') | `backend/src/db/queries/api-keys.ts` |
| `POST /api/capture/browser` (allowlist + scrub + per-host conversation) | `backend/src/api/capture.ts` |
| `scrubSecretValues` → shared (one source of truth) | `packages/shared/src/redact.ts` (+ mcp re-export) |
| CORS reflects `chrome-extension://` origins | `backend/src/index.ts` |

## Security properties (for review)

1. **Fail-closed by construction.** The capture-scope rejection lives in `authMiddleware`, keyed on an allowlisted path constant. A capture key is 403'd on *every* authed route except `POST /api/capture/browser` — including routes added in the future. Adversarial test covers GET /api/projects, POST /api/conversations, GET /api/insights, GET /api/account/usage → all 403, and "no write happened."
2. **No 500-before-migrate trap.** Scope is read via `select('*')`; pre-migration prod (no `scope` column) reads `undefined` → defaults to `'full'` → existing behavior. So deploy-before-migrate is safe. (Still: apply 031 with/before the deploy when we go live.)
3. **Single scrub source.** Moved to `@synapse/shared` so the daemon and the backend can't drift on the security scrub. End-to-end test confirms a pasted `sk-ant-…` is `[REDACTED]` before the messages insert.
4. **CORS ≠ auth.** Reflecting extension origins only enables the browser to *read the response*; the Bearer token + scope gate are the actual boundary.

## Verification

backend 574 + mcp 930 green; typecheck (backend + mcp) clean; biome clean. **Not pushed.**

## Open for reviewer

- Approve → push (auto-deploys; apply migration 031 to prod with it).
- Per-host project for browser captures (MVP) vs. AI semantic grouping (deferred) — confirm acceptable.

## Next (after approval)

Slice B: scoped-token minting (`scope=capture`) + `/cli-auth` `redirect_uri` (strict chromiumapp.org validation). Slice C: extension `chrome.identity` sign-in + direct-POST + daemon fallback.
