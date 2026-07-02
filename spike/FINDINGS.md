# Phase 1 Spike — Browser AI-Session Capture: Bake-off FINDINGS

**Date:** 2026-06-11
**Question:** Can we reliably read a `claude.ai` / `chatgpt.com` conversation from the browser, and by which method (fetch-hook vs DOM)?
**Method:** Observed manually in a real logged-in Chrome (Island enterprise browser) session. Probe A wire shape captured via DevTools **Network** tab (the console-paste fetch hook lost the `document_start` reference race — itself a finding, see Notes). Probe C is paper analysis.

---

## GATE DECISION

**Decision:** **GO-FETCH** — confirmed for `claude.ai`; `chatgpt.com` sample pending to finalize (expected GO-FETCH).

**Rationale:** `claude.ai`'s completion endpoint streams the **Anthropic Messages SSE format** (`message_start` / `content_block_delta`:`text_delta` / `message_stop`) — the documented, versioned public-API streaming schema, not a private wire format. The assistant turn reassembles by concatenating `text_delta`s; the user turn is the request body's `messages` array (the exact shape the existing proxy parser already consumes). DOM observation (Probe B) would be strictly worse here — obfuscated CSS classes, no structured roles/tool-calls, fragile to UI reflow. **Constraint:** the fetch hook must patch `window.fetch` in `world:MAIN` at `document_start` to beat the app's fetch-reference capture (empirically confirmed below).

---

## Observations

### claude.ai

| Method | Captured? | Shape / endpoint | Streaming? | Robustness notes |
|---|---|---|---|---|
| A — fetch/XHR hook | ✅ (requires `world:MAIN` @ `document_start`) | `POST /api/organizations/{orgId}/chat_conversations/{convId}/completion`; response `text/event-stream` | Yes — SSE, Anthropic Messages format | Endpoint URL pattern stable + matchable; payload = documented API SSE schema (low treadmill); must win the `document_start` race |
| B — DOM observer | Not needed for v1 | rendered transcript | n/a | Strictly worse than A here (obfuscated classes, loses structure); keep as a fallback only |

**Real conversation endpoints seen:**
- `POST …/chat_conversations/{convId}/completion` — the streamed assistant reply (SSE).
- The same POST's **request body** (JSON, ~200 KB) carries the `messages` array = user turn + prior history.
- (A conversation-history `GET …/chat_conversations/{convId}` also exists as an alternate source of full turns.)

**Redacted sample of the captured shape (response SSE — IDs redacted, no credentials present):**
```
event: message_start
data: {"type":"message_start","message":{"id":"chatcompl_…","role":"assistant","model":"claude-opus-4-8","uuid":"…","parent_uuid":"…","content":[],"stop_reason":null}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Not"}}
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" much on my end. You tossed me a \"what's up\" right back, …"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}

event: message_stop
data: {"type":"message_stop"}
```
Reconstruction: concatenate `content_block_delta.delta.text` by `index`; role from `message_start.message.role`.

### chatgpt.com

| Method | Captured? | Shape / endpoint | Streaming? | Robustness notes |
|---|---|---|---|---|
| A — fetch/XHR hook | _pending one Network-tab sample_ | expected `POST /backend-api/conversation` (SSE) | likely yes (OpenAI SSE shape, different schema) | own adapter + own SSE reducer; method expected GO-FETCH |
| B — DOM observer | _pending_ | _pending_ | _pending_ | _pending_ |

**Redacted sample:** _pending — grab one `/backend-api/conversation` EventStream sample to finalize._

---

## Probe C (reference) — MITM parse: paper analysis only

Per plan Task 4, analytical comparison, **not** a build. Conclusion (refined by the real capture):

- A TLS-MITM proxy sees the **same bytes** a `world:MAIN` `fetch` hook sees — same URL, same SSE body. It adds **no capture capability** the extension lacks for browser hosts.
- Neither MITM nor extension gets *free* parsing: both must run the same SSE→aggregated reduction before the existing `session-reconstruction.ts` can normalize it. So parsing effort is equal.
- The decisive difference is **blast radius**: the MITM sits on the *request* and unavoidably sees the `sessionKey` cookie (account-takeover-grade credential — observed live in this spike). The extension reads the *response* (assistant turn) and the request *body* (conversation messages) but never request *headers* — so it never touches the credential. This is concrete validation of the spec's A-over-B (extension-over-MITM) decision and §Privacy/R3.
- **Local constraint:** a real MITM browser test needs a System-keychain CA (admin). This machine is corporate-managed (Island/Netskope), admin unavailable → Probe C stays analytical by design. No System CA installed (out of spike scope).

**Probe C conclusion:** MITM offers no parsing advantage and a strictly larger credential blast radius. Remains spec Appendix B (future native-app path only). Gate decided by Probe A.

---

## Notes / surprises

- **claude.ai web SSE == Anthropic Messages streaming format.** `message_start` / `content_block_start` / `content_block_delta`(`text_delta`) / `content_block_stop` / `message_delta` / `message_stop` — the documented public-API event schema. Big de-risk for R2: the payload schema is stable/versioned; only the endpoint URL + cookie auth are claude.ai-specific.
- **Existing parser reuse is partial, not free.** `mcp/src/capture/proxy/session-reconstruction.ts` (`anthropicMessages`) consumes the *aggregated* `{role, content:[{type:"text",text}]}` shape and the request `messages` array — NOT raw SSE (grep for `text_delta` = 0 hits). The new code the claude.ai adapter needs is a bounded **SSE→aggregated reducer**; downstream normalization + CloudSyncer are reused unchanged.
- **User turn is request-side.** The response SSE contains only the assistant reply. The user's prompt is in the POST request **body** (`messages` array). Capturing it reads conversation data (allowed under §Privacy), not request headers (the cookie, forbidden).
- **Fetch-reference race is real (confirmed empirically).** A late console-paste hook did NOT intercept claude.ai's traffic — the page logged its own `[COMPLETION] … mode=legacy` while our hook saw nothing. The app captured its `fetch` reference before the paste ran. Production MUST patch in `world:MAIN` at `document_start`.
- **Credential exposure observed live.** The completion request carries `Cookie: …; sessionKey=sk-ant-sid02-…` (rotate-on-exposure credential). Reinforces response-scoped capture + the Task 7/8 redaction + allowlist.
- **Environment:** model `claude-opus-4-8`; browser identified as **Island** (enterprise Chromium) in mobile-emulation mode → unpacked-extension developer mode is policy-blocked on this machine. Does not affect production (store/managed install needs no dev mode).
