---
quick_id: 260603-qxy
description: Drop 2xx-only filter in proxy session-reconstruction so failed chats are captured; add opencode + crush UA patterns; fix opencode test env
date: 2026-06-03
status: in-progress
---

# Quick Task 260603-qxy — Proxy Capture Failed Chats

## Problem

Live investigation surfaced a real production bug. `mcp/src/capture/proxy/session-reconstruction.ts:74`:

```ts
const capturable = requests.filter(
  (r) => r.endpoint.capture && r.statusCode >= 200 && r.statusCode < 300,
);
```

The `statusCode 200-299` clause silently discards every non-2xx chat response: network 503/504s, rate-limit 429s, expired-key 401s. **The user's prompt is lost, with no error and no record.** Synapse's contract is "the next session knows where the last one left off" — failed chats violate that contract today.

Diagnostic chain that led here:
1. `e2e-real-tool-roundtrip.mjs` opencode entry never produced a capture event
2. Probe established opencode routes through proxy correctly (dead-port test confirmed)
3. opencode reaches `api.anthropic.com` via the proxy, gets 401 from fake key
4. Proxy receives the request but `reconstructSessions` filters it out per the statusCode clause
5. The same filter silently drops failed chats for real users on flaky networks / rate limits / expired keys

Secondary findings during investigation:
- opencode hangs on first run when `HTTPS_PROXY` is set, because of a ripgrep cache-check against `github.com` that the MITM proxy intercepts. Fix: `NO_PROXY=github.com,objects.githubusercontent.com` in opencode's test env.
- `user-agent-classify.ts` doesn't register `opencode` or `crush` — captures from them would tag as `"unknown"`.
- crush has a separate Go-TLS CA mechanism issue (NODE_EXTRA_CA_CERTS doesn't apply to Go binaries on macOS).

## Design principle (user-confirmed)

**Capture-then-filter beats filter-then-capture when the filter has any false-positive rate on legitimate data.** A polluted dashboard is recoverable (user sees, user deletes). Silent loss is invisible and irrecoverable. Apply broadly across Synapse.

Saved as a Synapse preference insight.

## Scope

| # | Change | File | Why |
|---|---|---|---|
| 1 | Drop `statusCode 200-299` clause | `mcp/src/capture/proxy/session-reconstruction.ts:74` | Real prod bug — failed chats now captured |
| 2 | Add `opencode` + `crush` UA patterns | `mcp/src/capture/proxy/user-agent-classify.ts` | Captures land with correct tool tag, not "unknown" |
| 3 | Regression-guard unit tests | `mcp/test/capture/proxy/session-reconstruction.test.ts` + `user-agent-classify.test.ts` | Test the bug class: 4xx/5xx + parseable chat body → captured |
| 4 | NO_PROXY in opencode test env | `scripts/e2e-real-tool-roundtrip.mjs` | Unblock the ripgrep cache-check hang |
| 5 | Probe crush Go-TLS CA story | (investigation, no code change yet — apply env fix only if found) | crush captures need to reach the proxy at all |
| 6 | Wire roundtrip into merge gate | `mcp/package.json` + `docs/E2E-PROTOCOL.md` | If 5+ tools pass, this becomes a real merge gate |

## Steps

1. Probe opencode + crush actual User-Agent headers via mitmdump-as-observer (run mitmdump on :7728, route opencode + crush through it, capture headers)
2. Apply UA patterns based on observed UAs (step 1 result)
3. Edit `session-reconstruction.ts:74` — drop the statusCode clause
4. Edit `user-agent-classify.ts` — register opencode + crush patterns
5. Add unit tests: failed-chat capture; opencode/crush UA classification
6. Edit `e2e-real-tool-roundtrip.mjs` — add NO_PROXY for opencode, apply crush env from probe
7. Run `npm run lint && npm run typecheck && npm run test` in mcp/
8. Run `node scripts/e2e-real-tool-roundtrip.mjs --only=opencode,crush` against live daemon — confirm captures fire
9. Run `npm run test:e2e` — confirm the existing merge gate still passes
10. If 5+ tools pass: add to `test:e2e` chain in package.json + update E2E-PROTOCOL.md
11. Atomic commits per logical step + push (pre-push hook validates)
12. Write SUMMARY.md + save Synapse insight

## Acceptance

- [ ] `npm run test` green (existing + new unit tests)
- [ ] `node scripts/e2e-real-tool-roundtrip.mjs --only=opencode` → PASS with tool tag "opencode"
- [ ] crush either PASS or documented in BUGS.md as Go-TLS environmental
- [ ] `npm run test:e2e` still green (no regression in the 5-script gate)
- [ ] Production behavior: failed-chat sessions captured with prompt visible, response empty
- [ ] No file-watcher adapter for opencode/crush — proxy-tier is the right place

## Non-scope (deliberately deferred)

- OpenAI Responses API endpoint + body extractor (separate "provider coverage expansion" task)
- Bedrock / Vertex AI Anthropic paths
- Mistral / DeepSeek / Groq / OpenRouter / xAI provider recognition
- `failureReason` field on `CapturedSession` (frontend visibility for failed chats — speculative; defer until user feedback)
- Minimum-prompt-length pollution filter (over-engineering per user; defer until pollution observed)
- VS Code automation for cline/cursor/roo-code adapters

## Open questions

- crush's Go-TLS CA injection: if no env var works, document as env-blocked and skip from default `--only` list
