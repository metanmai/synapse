---
quick_id: 260603-qxy
description: Drop 2xx-only filter in proxy session-reconstruction; register opencode + crush UAs; fix opencode test env
date: 2026-06-03
status: complete
---

# SUMMARY — 260603-qxy Proxy Capture Failed Chats

## What changed

**Production fix** — `mcp/src/capture/proxy/session-reconstruction.ts:74`: removed the `statusCode 200-299` filter. The proxy now captures requests whose `endpoint.capture` is true regardless of response status. Failed chats (401 auth fail, 429 rate limit, 503 network glitch, 5xx provider error) are now preserved as sessions with the user's prompt visible and no assistant response. Real users on flaky networks no longer silently lose their context.

The downstream `messages.length === 0` guard at line ~106 acts as the second-tier protection: garbage bodies that don't parse into a chat shape still drop. The defense-in-depth holds.

**UA classifier** — `mcp/src/capture/proxy/user-agent-classify.ts`: registered `opencode` and `crush` patterns. Confirmed via live mitmdump probe that opencode's actual UA is `opencode/1.15.13 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14` — the `\bopencode\b` regex matches.

**Type union** — `mcp/src/capture/types.ts`: added `"opencode"` and `"crush"` to `CapturedSession.tool`. Reformatted to multi-line union (biome convention for long unions). Frontend `conversation-helpers.ts` display map updated with friendly labels.

**Test framework** — `scripts/e2e-real-tool-roundtrip.mjs`:
- opencode entry: added `NO_PROXY=github.com,objects.githubusercontent.com,models.dev`. opencode probes GitHub on every run for ripgrep cache validation; without NO_PROXY that probe hangs through the MITM proxy (Bun's BoringSSL doesn't auto-trust the Synapse CA for github leaves).
- opencode entry: `expectedTool: "opencode"` (no longer `null`).
- crush entry: documented Go-on-macOS TLS limitation in comments; `expectedTool: "crush"`.
- `POST_RUN_WAIT_MS`: 20s → 40s. The proxy idle-flushes after 30s of quiet, so a tool that fires one request and exits has its capture stuck in the buffer for ~30s. 40s = 30s idle + 10s buffer for SSE assembly + emit latency.

## Tests added

`mcp/test/capture/proxy/session-reconstruction.test.ts`:
- `it.each([401, 403, 429, 500, 503, 504])` — captures user prompt for each failure status. Inverts the prior `drops non-2xx requests` test (which encoded the bug-class behavior).
- `does NOT capture when the body has no recognizable user message` — defense-in-depth check against garbage bodies.

`mcp/test/capture/proxy/user-agent-classify.test.ts`:
- Added opencode + crush entries to the `it.each` positive-case table (including the exact UA observed live).
- Added word-boundary negative case (`opencoded` does not classify as opencode).
- Added realistic-UA test using the live-captured opencode string.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` (mcp) | ✅ |
| `npm run test` (mcp) — 786 unit tests | ✅ all pass |
| Frontend `npm run check` | ✅ 0 errors / 0 warnings |
| Root `npm run lint` (biome) | ✅ 0 errors (1 pre-existing warning in onboarding-openssl-prereq.test.ts unrelated to this change) |
| Live `e2e-real-tool-roundtrip.mjs --only=opencode` against capture-worker rebuilt with new code | ✅ PASS — captured `ses_2feadf8268329218` tagged `tool=opencode` |

## Findings (insights worth keeping)

- **Capture-then-filter beats filter-then-capture** when the filter has any false-positive rate. Polluted captures are recoverable; silent loss is not. (Saved as Synapse preference insight.)
- **The 9 historical proxy captures in `capture.log` were all `claude-code`** because that's the only tool sending real (200-status) requests through the proxy on this dev box. The 2xx-only filter masked a complete dead-zone for failed-chat capture in production.
- **opencode pre-flight network probes hang through MITM proxies** because Bun's BoringSSL doesn't trust the proxy's CA for github.com. NO_PROXY for github is the necessary test-env fix; the LLM call still routes through the proxy unchanged.
- **Go binaries on macOS (brew-built, CGO_ENABLED=1) ignore env-var CA pools** entirely, using Apple's Security.framework which consults the keychain. crush is a real instance of this. SSL_CERT_FILE is a no-op for these builds.
- **Proxy worker's stdout/stderr go to `/dev/null`** in the launchd config — runtime visibility is zero unless events write directly to `capture.log`. That's a debt item; doesn't matter for this commit but worth flagging.

## Non-scope / deferred (deliberately)

- OpenAI Responses API endpoint at `/v1/responses` — codex 0.50+ uses this body shape, not the legacy `messages: []` shape. Would require new endpoint regex + new body extractor.
- Bedrock for Claude (`bedrock-runtime.us-east-1.amazonaws.com`) and Vertex AI for Claude — additional provider hosts not in `endpoint-recognition.ts`.
- Mistral / DeepSeek / Groq / OpenRouter / xAI host recognition.
- `failureReason` field on `CapturedSession` for visual distinction of failed chats in the dashboard. Speculative — defer until a user explicitly asks for it.
- Pollution mitigations (minimum-prompt-length filter, automatic failed-chat cleanup). User-validated: not worth the engineering cost; pollution is recoverable, silent loss is not.
- Wiring `e2e-real-tool-roundtrip.mjs` into `npm run test:e2e`. crush is environmentally blocked on this Mac (corp keychain restrictions); copilot-cli is corp-policy blocked. Best run as a periodic manual `--only=claude-code,codex,gemini,opencode` until the environmental story is solved for both blocked tools.

## Files touched

```
mcp/src/capture/types.ts
mcp/src/capture/proxy/session-reconstruction.ts
mcp/src/capture/proxy/user-agent-classify.ts
mcp/test/capture/proxy/session-reconstruction.test.ts
mcp/test/capture/proxy/user-agent-classify.test.ts
frontend/src/lib/components/conversations/conversation-helpers.ts
scripts/e2e-real-tool-roundtrip.mjs
docs/BUGS.md
.planning/quick/260603-qxy-proxy-capture-failed-chats/PLAN.md
.planning/quick/260603-qxy-proxy-capture-failed-chats/SUMMARY.md
```
