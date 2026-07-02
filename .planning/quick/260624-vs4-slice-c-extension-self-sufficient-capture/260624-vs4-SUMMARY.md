---
quick_id: 260624-vs4
slug: slice-c-extension-self-sufficient-capture
status: complete-pending-review
date: 2026-06-24
commit: d5570396
---

# Summary — Slice C: self-sufficient extension

**Status: built + fully tested LOCALLY, commit `d5570396` NOT pushed** — extension-only
(no prod auto-deploy: users load the extension manually), held for push-approval to keep the
per-slice review rhythm.

## What shipped (local)

| Piece | File |
|---|---|
| `API_URL` + `APP_URL` (mirror mcp/src/cli/config.ts) | `extension/src/config.ts` |
| PKCE sign-in via `chrome.identity.launchWebAuthFlow` → capture token | `extension/src/auth.ts` |
| `identity` typings | `extension/src/chrome.d.ts` |
| `postCaptureToBackend` (Bearer + client-side scrub) + backend-first/daemon-fallback `flush` | `extension/src/worker/index.ts` |
| `identity` permission + api/app `host_permissions` + description | `extension/manifest.json` |
| "Sign in to Synapse" button + email status; daemon fields kept as fallback | `extension/options.html` + `options.ts` |

## The capture path, end to end (A + B + C)

1. User clicks **Sign in** → `launchWebAuthFlow` opens `/cli-auth?scope=capture&redirect_uri=<chromiumapp>` (B).
2. PKCE code → `/auth/cli-exchange` → **capture-scoped key** (B) → `chrome.storage.local`.
3. Content script captures a turn → SW buffers → flush → **POST `/api/capture/browser`** with Bearer (A),
   content **scrubbed client-side first** → per-host conversation persisted.
4. Backend unreachable → **fall back to the local daemon** (the existing path, unchanged).

## Properties (for review)

1. **Backend-first, daemon-fallback**; opt-out only when NEITHER token is set — existing daemon-only
   users are completely unaffected (verified by the back-compat test).
2. **One scrub definition** across daemon, backend, AND extension (`@synapse/shared/redact`).
3. **PKCE integrity** tested (the verifier hashes to the sent challenge); a state-mismatch callback is
   rejected (CSRF guard) and stores no token.
4. **Least privilege preserved**: the anti-drift test now allows `host_permissions` = capture hosts +
   the Synapse endpoints **derived from `config.ts`**, nothing else.

## Verification

extension typecheck + **58 tests** + bundle green. Full `npm run verify` to run via the pre-push hook.

## Open for reviewer / remaining manual steps

- Approve → push (extension-only; nothing auto-deploys to users).
- Apply **migration 031** to prod so capture-key minting works end to end.
- **Real-browser validation** on a non-corp Chrome (load-unpacked `dist/`); corp Chrome blocks dev-mode.
- Chrome Web Store / distribution channel (tracked separately, not this slice).
