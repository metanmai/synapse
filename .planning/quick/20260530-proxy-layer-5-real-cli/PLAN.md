---
slug: proxy-layer-5-real-cli
quick_id: 260530-l5
date: 2026-05-30
status: in-progress
---

# Proxy daemon — Layer 5: E2E with real `claude` CLI

## Goal

Validate the proxy daemon end-to-end with a real Anthropic CLI: spawn `claude -p` with `HTTPS_PROXY` pointing at our proxy and `NODE_EXTRA_CA_CERTS` pointing at our generated CA, route `api.anthropic.com` to a local TLS fake, and assert the proxy successfully intercepts the chat request.

This is the moment we prove the architecture works against a real-world tool — not a synthetic test client.

## What's already validated (skipped in this slice)

- claude CLI routes through HTTPS_PROXY ✓ (spike, mitmproxy)
- claude CLI trusts NODE_EXTRA_CA_CERTS ✓ (spike, mitmproxy)
- TLS interception against api.anthropic.com viable ✓ (spike, mitmproxy)
- Our proxy's CONNECT + TLS termination work over `tls.connect()` clients ✓ (Layer 3b tests)
- Our proxy's session reconstruction handles claude's 3× retry pattern ✓ (Layer 1 tests)

## What this slice newly proves

- Our proxy specifically (not mitmproxy) presents a leaf cert that claude's Anthropic SDK accepts
- Our endpoint allowlist correctly classifies claude's `/v1/messages` request
- The full pipeline (claude → CONNECT → TLS-MITM → fake → onCaptured) produces a CapturedRequest with the user prompt readable in plaintext

## Files

```
scripts/
└── e2e-proxy-layer5.mjs                  ← NEW: spawn-claude-and-assert runnable
```

The script follows the existing `scripts/e2e-*.mjs` pattern (compiled `mcp/dist/` import, structured logging, exit codes).

## Design

**Standalone runnable script, not a vitest test.** Requires `claude` binary which CI doesn't have. Soft-skips with exit 0 if `which claude` fails — keeps the script safe to wire into a future CI merge gate without breaking the run on machines without claude.

**Lenient catch-all fake.** Claude hits ~30 non-chat endpoints (bootstrap, settings, mcp-registry, etc.) before/around `/v1/messages`. Returning 404 to those would block claude from progressing. The fake returns `200 {}` for any path that isn't `/v1/messages`, which lets claude move through its prelude calls and reach the chat endpoint.

**Proper SSE for `/v1/messages`.** Claude expects `text/event-stream` with `message_start → content_block_delta → message_stop` framing. The fake hand-rolls a minimal SSE response (a "PONG" reply). The proxy's `clientRes.write(chunk)` already forwards bytes as they arrive (no Layer 4 dependency).

**Combined trust bundle.** Proxy's `upstreamCa` is `[...tls.rootCertificates, ourCa]`. Otherwise calls to non-fake hosts (statsig, sentry, etc., if claude makes any) fail TLS validation.

**Fresh `cwd` for claude.** Spawned from `tmpRoot` (not the repo) so claude doesn't see `.mcp.json` and doesn't try to start the synapse MCP server. Keeps the test focused on the proxy + chat path.

## Bug class under test

> The proxy daemon's TLS-MITM pipeline doesn't actually work with a real CLI tool because: (a) the leaf cert claude sees fails its SDK's cert validation, (b) the proxy's CONNECT handler doesn't accept claude's tunnel for some reason, (c) the endpoint allowlist mis-categorizes the chat URL, OR (d) claude's prelude side-calls block it from ever reaching /v1/messages.

Acceptance:
- claude exits within 60s (cleanly OR with non-zero)
- AT LEAST ONE captured request with `endpoint.provider === "anthropic"` and `endpoint.kind === "messages"`
- captured `requestBody.messages` array non-empty
- proxy & fake teardown cleanly

## Out of scope

- claude completing the full prompt successfully (we only need ONE chat capture; whether claude renders the response is secondary)
- Layer 4 (live SSE streaming UX — proxy already forwards chunks as they arrive)
- Cursor / Codex / GUI tools (deferred — claude validates the same Anthropic SDK shape they all use)
- Real-API smoke test (Layer 6 — uses actual Anthropic credentials)
- Adding to CI merge gate (script is runnable manually; CI wiring is a separate decision)

## Definition of done

- `cd mcp && npm run build` completes (dist available for the script to import)
- `node scripts/e2e-proxy-layer5.mjs` exits 0 with at least one captured chat request
- Atomic commit + push
- Insight saved to Synapse
