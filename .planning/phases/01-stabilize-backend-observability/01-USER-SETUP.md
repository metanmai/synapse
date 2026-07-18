# Phase 1: User Setup Required

**Generated:** 2026-07-18
**Phase:** stabilize-backend-observability
**Status:** Incomplete

The Sentry integration is implemented and tested, but it remains disabled until a real project DSN is supplied.

## Account Setup

- [ ] **Create or identify the Synapse backend project in Sentry**
  - Location: Sentry Dashboard → Projects
  - Platform: Cloudflare Workers / JavaScript
  - Skip if: A Sentry project for the production Synapse Worker already exists

## Environment Variable

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `SENTRY_DSN` | Sentry Dashboard → Project Settings → Client Keys (DSN) | Cloudflare Worker secret |

Do not paste the DSN into `wrangler.jsonc`, source code, chat, or a shell command. Once it is available, the agent can run `npx wrangler secret put SENTRY_DSN`, deploy, and perform the live verification without exposing the value.

## Remaining Verification

After the secret is configured:

1. Deploy the Worker.
2. Trigger a controlled backend exception.
3. Confirm Sentry receives the exception with its real stack trace within one minute.
4. Remove the controlled exception and redeploy.

OBS-01 remains open until this live check passes.
