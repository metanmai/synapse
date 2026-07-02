# Browser Capture Wire-Format Drift Defense — Design

**Status:** Approved (design phase) — 2026-06-14
**Spec for:** writing-plans → executing-plans

**Goal:** Know — proactively and reactively — that browser capture (`claude.ai` / `chatgpt.com`) still works after the sites change their private, undocumented wire format, instead of finding out only when context silently goes missing.

---

## Problem

Browser capture depends on parsing the *private* SSE wire format of `claude.ai` and `chatgpt.com` (see `extension/src/content/adapters/`). These formats can change with zero notice. Today's extension tests (`extension/test/full-chain.test.ts`, `adapters/*.test.ts`) are **golden-fixture** tests: they replay recorded bytes. A recorded fixture stays green forever even after the live site changes — so the existing suite catches *our* regressions but is structurally blind to *their* drift.

### The frozen-vs-live distinction (the crux)

Two different guarantees, often conflated under "a full browser test":

1. **Mechanics in a real browser** — does the MV3 hook fire, inject, relay, and POST? Automatable in CI, but it must be fed *some* data; feeding it our recorded fixture keeps it **frozen** → blind to live drift.
2. **Live wire-format validity** — did the site change its shape? Answerable **only** by hitting the real, logged-in site and parsing live bytes. There is no unauthenticated way to observe their SSE. Therefore drift detection is inseparable from a real authenticated session.

This design delivers both, across three independent layers.

### Hard constraint (security)

No raw `claude.ai` / `chatgpt.com` session cookie or bearer token is ever copied, stored in the repo, or placed in CI. (This is the exact credential class a prior incident leaked.) Every live check rides an *already-existing* logged-in browser session via a debug-port attach; nothing is persisted.

---

## Architecture — three layers, three distinct jobs

| Layer | Job | Where it runs | Catches |
|-------|-----|---------------|---------|
| 1. In-extension drift sentinel | React to drift the instant it happens in real use | User's daily browser (production) | *Their* format change |
| 2. Proactive synthetic self-test | "Does it work right now?" on demand | User's non-corp / Playwright-capable machine | *Their* format change, proactively |
| 3. CI real-browser mechanics test | Guard our extension code | metanmai CI, every push | *Our* regressions |

L3 guards our code continuously; L1 reacts to their drift immediately in real usage; L2 lets the user proactively verify before relying on capture.

---

## Layer 1 — Continuous in-extension drift sentinel

**Signal:** `adapter.matchesCompletion(url)` was **true** (we are on the exact completion endpoint and bytes streamed to completion) **but** `adapter.parseResponse(text)` returned `null`/empty. On the right URL, a completed stream that no longer parses is explainable *only* by a format change.

**False-positive control:**
- Only count **completed** streams (terminal event seen: claude `message_stop`, chatgpt `[DONE]`). A user-aborted or still-streaming response never counts.
- Raise drift only after **≥3** matched-and-completed-but-empty events with **zero** successful parses in a rolling window. Any single successful parse resets the counter.
- Scope per host (claude.ai drift is independent of chatgpt.com drift).

**Distinct from R2 zero-capture** (`mcp/src/capture/ingest/capture-rate.ts`): R2 = "hook never fired / no activity" (ambiguous — maybe idle). Sentinel = "hook fired, endpoint matched, completed, parsed empty" (unambiguous drift). Both feed the same health surface.

**Data flow:**
`extension/src/content/main.ts` (hook) → new `extension/src/content/drift-sentinel.ts` (the counter/state machine) → on drift, the content script posts a drift event through the existing relay → worker path → worker POSTs to the daemon loopback ingest (`extension/src/worker/index.ts`, reusing the `x-synapse-ingest-token` auth and the `127.0.0.1:<port>` route) → daemon `mcp/src/capture/ingest/ingest-route.ts` (`handleIngest`) recognizes the drift event → records it and surfaces it via the capture health path (alongside `CaptureRateTracker`) so it shows in `synapsesync capture status`.

**Privacy (R3-aligned):** the drift event carries only *structural shape* to aid patching — the set of SSE `event:` names and/or top-level JSON keys observed, the host, the endpoint path, and a short hash of one sample. **Never** raw message text.

**Components/files:**
- Create: `extension/src/content/drift-sentinel.ts` — pure state machine: `recordMatch({ host, completed, parsedOk })` → returns `"drift"` when the threshold trips; resets on success.
- Modify: `extension/src/content/main.ts` — call the sentinel after each matched completion; on `"drift"`, emit a drift signal via the existing post path.
- Modify: `extension/src/worker/index.ts` — add a `postDrift`-style sender (sibling of `postCapture`), same auth/route.
- Modify: `mcp/src/capture/ingest/ingest-route.ts` (+ `ingest-server.ts`) — accept the drift event kind; log loudly; expose in capture health/status.
- Test: `extension/test/drift-sentinel.test.ts` — threshold trips at 3, resets on success, ignores non-matching/aborted/incomplete, per-host isolation (guards the bug class, not one instance).
- Test: a daemon-side unit test that a drift event is recorded and surfaced (extends existing ingest tests).

---

## Layer 2 — Proactive synthetic self-test (live drift oracle)

**File:** `scripts/e2e-browser-live.mjs`. **Not** part of the synapsesync CLI (keeps Playwright out of shipped runtime deps). **Not** in the merge gate (auth-bearing, machine-specific). Runs on the user's non-corp / Playwright-capable machine (this dev device cannot install Playwright through the Netskope proxy).

**Auth model (no stored secret):** the user launches Chrome with `--remote-debugging-port=9222` and is already logged in. The script attaches via Playwright `chromium.connectOverCDP("http://127.0.0.1:9222")`. Nothing is copied or persisted. If no debug-Chrome is reachable → **green skip** with a one-line instruction (matches the repo's other gated-skip e2e scripts).

**Primary assertion (robust core):** for each host (`claude.ai`, then `chatgpt.com`):
1. Open/focus a tab on the authed site.
2. Send one throwaway message (e.g. "ping — synapse selftest <RUN_ID>").
3. Capture the **live** completion SSE bytes off the network (CDP Network domain / response body).
4. Run the **real** adapter (`parseClaudeResponse` / `parseChatgptResponse`) on those live bytes → assert a non-empty assistant turn.
5. Delete the throwaway conversation.

This is the live drift oracle: green = the shipped adapter parses today's real wire; red = drift, with the captured bytes available to patch the adapter + refresh the golden fixture. (This is also what finally confirms the ChatGPT adapter against the real wire — currently an open item built only against the documented shape.)

**Optional escalation (best-effort, off by default):** load the built extension into the attached profile and assert a local daemon receives the end-to-end capture. Flagged best-effort because MV3 service workers under automation + Cloudflare are flaky; failure here does not fail the primary assertion.

**Error handling:** Cloudflare challenge / login-expired / no debug port → skip-green with a clear reason (never a false red). Real parse-empty on live bytes → **hard red** (that's the finding).

---

## Layer 3 — CI real-browser mechanics test (our-regression guard)

**Where:** runs in metanmai CI (Playwright is already installed there for the frontend). **No auth, no live site, no secrets** → safe to run on every push.

**Design:** a local static page + local SSE server emit the **recorded-fixture shape** at a `/completion`-looking URL; Playwright launches Chromium with the **real built `extension/dist/`** loaded (`--disable-extensions-except` + `--load-extension`, persistent context); a local mock daemon endpoint records the worker's POST. Assert the captured POST carries the right `host` and the expected assistant content.

This upgrades the Node-stub `full-chain.test.ts` to a *real-Chromium* proof that hook-fires + content-script-injects + relay-forwards + worker-POSTs. It is intentionally **frozen** (fixture-fed) — drift detection is L1/L2's job; L3's job is to catch us breaking the extension.

**Known feasibility risk (stated honestly):** MV3 service workers can be flaky in headless Chromium. Mitigation: use `--headless=new` and a persistent context. Fallback if the SW proves too flaky in CI: assert content-script injection + relay forwarding against the local page (still a real browser, less SW-dependent) and keep the worker-POST leg in the Node full-chain test. The plan must verify L3 is reliably green before adding it to the gate; if it can't be made stable, it ships as a non-gating job rather than destabilizing the merge gate.

**Components/files:**
- Create: a local fixture server + mock daemon helper (under `extension/test/` or `scripts/`).
- Create: the Playwright spec that loads `extension/dist/` and asserts the POST.
- Modify: `.github/workflows/ci.yml` — a job that builds the extension, runs the spec; gating only once proven stable.

---

## Out of scope (YAGNI)

- Storing or transmitting any live site cookie/token anywhere.
- Auto-patching adapters on drift — drift **alarms**; a human patches the adapter + refreshes the golden fixture.
- Hosts beyond `claude.ai` / `chatgpt.com`.
- Agentic-browser / Claude-Desktop / ChatGPT-Desktop coverage (separate, deferred concerns).
- Bundling Playwright into the shipped `synapsesync` CLI.

## Success criteria

1. A simulated format change (adapter parses empty on a completed, matched stream) trips the sentinel after the threshold and surfaces in `synapsesync capture status` — proven by `extension/test/drift-sentinel.test.ts`.
2. `scripts/e2e-browser-live.mjs` parses a **live** assistant turn from both sites against the real adapter when attached to a logged-in Chrome, and skips green (never false-red) when no session is available.
3. The CI mechanics test loads the real built extension in real Chromium and asserts the worker POST — green on every push (or shipped non-gating if MV3-SW stability can't be reached).
4. No raw conversation bytes and no live credentials anywhere in drift signals, the repo, or CI.
