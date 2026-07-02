---
quick_id: 260624-vs3
slug: slice-b-scoped-token-mint-redirect
status: complete-pending-review
date: 2026-06-24
---

# Summary — Slice B: scoped-token minting + /cli-auth redirect_uri

**Status: built + fully tested LOCALLY, NOT pushed** — held for review before exposure
(the push auto-deploys the live `/auth/cli-session` sign-in path). Follows the Slice A gate.

## What shipped (local)

| Piece | File |
|---|---|
| `CAPTURE_KEY_LABEL = "ext-browser"` (fixed, device-cap-exempt) | `backend/src/lib/constants.ts` |
| `createApiKey(..., scope?)` — conditional insert (feature-detection safe) + `findKeyByLabel` | `backend/src/db/queries/api-keys.ts` |
| `cliSession` schema gains `scope: 'full'|'capture'` | `backend/src/lib/validate.ts` |
| `mintOrRotateCaptureKey` helper + capture branch in `/auth/cli-session` | `backend/src/api/auth.ts` |
| `redirect_uri` + `scope` on `CliParams`; `isAllowedExtensionRedirect` + `buildCallbackUrl` | `frontend/src/routes/cli-auth/cli-params.ts` |
| `load` reads redirect_uri/scope, relaxes `hasCli` to `port||redirect_uri`; `continueAs`/`revokeAndContinue` forward scope + build callback via `buildCallbackUrl` | `frontend/.../+page.server.ts` |
| `cli_redirect_uri` + `cli_scope` hidden inputs on all 8 forms (one replace_all over the shared `cli_device` line) | `frontend/.../+page.svelte` |

## Security properties (for review)

1. **Capture keys can't accumulate.** `mintOrRotateCaptureKey` keeps exactly one `ext-browser`
   key per user — re-auth ROTATES the hash, never mints a duplicate. Unit-tested by asserting it
   issues **exactly two** DB queries (lookup + insert/rotate) — which also proves it never touches
   the cli device-cap path.
2. **No 500-before-migrate trap (still).** `createApiKey` references the `scope` column ONLY when
   minting a capture key; every full-key insert is byte-identical (pinned by the existing
   "inserts with correct fields" test) and safe on pre-migration-031 prod.
3. **Open-redirect guard, fail-closed.** `isAllowedExtensionRedirect` URL-parses and allowlists
   `https://<label>.chromiumapp.org` only — rejecting http, the bare apex, suffix attacks
   (`…chromiumapp.org.evil.com`), userinfo `@`-tricks, and non-default ports. `buildCallbackUrl`
   returns `null` (the caller 400s) on an invalid redirect_uri and **never falls back to the port**.
4. **PKCE backstop unchanged.** Even a leaked code is unusable without the verifier; the allowlist
   is defense-in-depth, not the sole barrier.
5. **CLI flow untouched.** Absent scope/redirect_uri → identical behavior. The hidden-input
   replace_all is purely additive; it also (beneficially) fixes the pre-existing inconsistency where
   only some forms carried `cli_machine_id`.

## Verification

backend 582 (+8) + frontend 97 + mcp 930 green; svelte-check clean (501 files); biome + all-workspace
typecheck clean (full `npm run verify` reached test phase). One mcp watcher timing flake on the first
verify run, confirmed green on immediate re-run (untouched workspace). **Not pushed.**

## Open for reviewer

- Approve → push (auto-deploys; migration 031 must be applied for capture keys to actually mint,
  but the CLI flow is unaffected and the route is otherwise inert).
- `ext-browser` single-capture-key model (rotate-on-reauth) acceptable as MVP?

## Next (after approval)

Slice C: extension `chrome.identity.launchWebAuthFlow` sign-in (passing `scope=capture` +
`redirect_uri=https://<id>.chromiumapp.org/`) → `/auth/cli-exchange` → store the capture token →
direct-POST captures to `/api/capture/browser` with client-side scrub + daemon fallback; extend the
full-chain e2e to cover the direct path.
