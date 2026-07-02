---
slug: proxy-feasibility
quick_id: 260530-spike
date: 2026-05-30
status: complete
---

# Spike: LLM API proxy viability for universal AI session capture

## Decision: 🟢 GREEN LIGHT — approach is viable

Spike confirmed that the proposed proxy-daemon architecture (TLS-MITM HTTPS proxy that captures LLM API calls) **works end-to-end against the real Anthropic API** with the user's actual claude CLI on this machine. No code written; mitmproxy used as a stand-in to validate the foundational mechanism.

## Spike execution

**Setup time:** ~5 minutes (brew install mitmproxy + CA generation; admin password NOT required because we used `NODE_EXTRA_CA_CERTS` to scope-trust the CA to the test process only).

**Test:**
```bash
HTTPS_PROXY=http://localhost:8080 \
  NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem \
  claude -p "Reply with the single word: PONG"
```

**Result:** claude returned `PONG`. mitmproxy captured 37 flows, all to `api.anthropic.com`, all with status 200 (3 unrelated 404s on never-used endpoints). The `/v1/messages` request body was **fully readable in plaintext** — we could see the user prompt verbatim, the assistant response, the streaming SSE format, the model identifier (`claude-opus-4-7`), and the embedded SessionStart brief.

## Three viability questions — answered

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Does claude CLI honor `HTTPS_PROXY`? | ✅ YES | 37 flows appeared in mitmproxy; zero traffic bypassed |
| 2 | Does TLS interception work against `api.anthropic.com`? | ✅ YES | Request bodies fully plaintext-readable, including a 129KB JSON payload with messages array |
| 3 | Does the tool still function normally? | ✅ YES | claude returned `PONG` to user; UX unaffected; streaming SSE response handled cleanly |

## Tools tested

| Tool | Installed? | Tested? | Verdict |
|---|---|---|---|
| claude CLI | ✅ | ✅ | **Captures cleanly via proxy** |
| codex | ✗ | n/a | (not installed; mechanism likely identical — Node-based CLI) |
| gemini | ✗ | n/a | (not installed; mechanism likely identical) |
| copilot CLI | ✗ | n/a | (not installed) |
| Cursor (GUI) | ✓ | ⏳ Not yet tested | Requires system-wide CA trust + user-driven UI test |
| Claude Desktop | ✓ | ⏳ Not yet tested | Same — system trust + UI test |
| ChatGPT Desktop | ? | ⏳ Not yet tested | Same — known to sometimes pin endpoints |

## Non-obvious findings from the spike data

These are things we learned about claude CLI specifically that inform the proxy daemon's design:

### 1. claude makes 3× `/v1/messages` calls per `-p` invocation
A single user prompt triggered 3 chat-completion API calls. Likely retries or fallback model checks. Our proxy's session-reconstruction logic must **dedupe by `messages[0]` content + temporal window**, not naively treat each request as a new session.

### 2. 31 of 37 captured flows are NOT chat — they're telemetry / registry / config endpoints
Endpoints hit during a single claude invocation (counts in parens):
- `/mcp-registry/v0/servers` (9)
- `/api/event_logging/v2/batch` (4)
- `/api/eval/sdk-...` (3)
- `/api/claude_code/settings` (3)
- `/api/claude_code/policy_limits` (3)
- `/api/claude_code_penguin_mode` (3)
- `/api/claude_code/metrics` (3)
- `/api/claude_cli/bootstrap` (3)
- `/v1/mcp_servers` (3)

**Design implication:** the proxy daemon needs an explicit **"chat endpoint" allowlist** (`/v1/messages` for Anthropic, `/v1/chat/completions` for OpenAI, equivalents for Google). Telemetry and config calls are noise we must filter out before session reconstruction.

### 3. Request body sizes are non-trivial (~129KB)
The SessionStart `<synapse-brief>` injection blows up request payload size. Our proxy must support streaming body buffering — can't hold entire request in memory at once for very long sessions.

### 4. Responses are streaming SSE
Format: `event: <name>\ndata: <json>\n\n` chunks. Mitmproxy handled this transparently. Our proxy daemon must:
- Accumulate SSE chunks for capture (assemble the assistant message from streamed deltas)
- Forward chunks to the client in real-time (don't buffer the whole response — that breaks the streaming UX)

### 5. All traffic to `api.anthropic.com` — no CDN/proxy chain
Single-host capture target for Anthropic. (OpenAI uses `api.openai.com`; Google uses `generativelanguage.googleapis.com`.) The host-routing logic in our proxy is straightforward.

## What's NOT confirmed by this spike

| Unknown | How to resolve |
|---|---|
| **Cursor (GUI) capturability** | Requires system trust + Cursor's `http.proxy` setting test. ~10 min, needs admin password. |
| **Claude Desktop capturability** | Same as Cursor — likely works since it's Electron-based. |
| **ChatGPT Desktop capturability** | Known unknown — Electron apps sometimes pin endpoints. |
| **Performance at load** | Mitmproxy is interpreted Python; our daemon will be Node. Need a load test once we build, but no fundamental blockers. |
| **Cursor / OpenAI / Google formats** | Same mechanism; only the request/response shape differs. New adapter code per provider, no architectural change. |

## Recommended next steps

### Option A: build the proxy daemon now (recommended)
Viability is proven. The remaining unknowns (GUI tools, performance) are implementation concerns, not architectural ones. The 7-day build plan from the earlier sketch is unblocked.

### Option B: extend the spike to Cursor first
~10 minutes, requires admin password to install CA into System keychain. Would close the GUI-tool unknown before building. Recommended if there's any nervousness about Cursor specifically.

### Option C: also test against api.openai.com / google
Would require having an OpenAI or Google API key configured locally. Tests provider-portability before building. Lower priority — same mitmproxy mechanism, almost certainly works.

## Cost summary

| Step | Cost |
|---|---|
| brew install mitmproxy | $0 |
| 1× claude `-p` call | <$0.01 (a few cents in Anthropic tokens for PONG response) |
| Engineer time | ~30 minutes |
| **Total** | **<$0.01 + 30 min** vs. **~7 days build risk** if we'd skipped the spike |

## Captured artifacts

- `/tmp/mitm-capture.jsonl` — 37 flows, ready to use as test fixtures for the proxy daemon's unit tests
- `~/.mitmproxy/mitmproxy-ca-cert.pem` — CA cert for any further testing
- `/tmp/mitm-capture.py` — small mitmproxy addon that captured the flows (reusable for further spikes)

## Verdict

**🟢 GREEN LIGHT.** The LLM API proxy approach is viable. Proceed to implementation.

Order of work (from earlier sketch — all unblocked):
1. Layer 1 unit tests for session reconstruction (using captured /v1/messages bodies as fixtures)
2. Fake upstream LLM server helper
3. Proxy `server.ts` skeleton (HTTP first, then TLS)
4. Layer 2 integration tests
5. TLS-MITM (cert gen + per-host signing)
6. Layer 3 E2E with real codex + fake upstream
7. Optionally: extend spike to Cursor / Claude Desktop before shipping
