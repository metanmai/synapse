# Browser AI-Session Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture AI conversations from `claude.ai` and `chatgpt.com` in the browser, opt-in and default-OFF, flowing into the same backend pipeline as the file-watcher and proxy sources.

**Architecture:** A browser extension (MV3) reads conversation data on the two hosts and POSTs it to the Synapse daemon over loopback; the daemon redacts credentials, normalizes to a `CapturedSession`, and reuses the existing `CloudSyncer.sync()` path. No OS-proxy mutation, no System-CA, no PAC — the heavy MITM shell is deferred (spec Appendix B) because native-app capture is cut.

**Tech Stack:** TypeScript; MV3 (Chromium: Chrome/Edge committed, Firefox if cheap, Safari best-effort); existing mcp daemon (Node 24) + `CloudSyncer`; vitest; Playwright for headless extension integration.

**Spec:** `docs/superpowers/specs/2026-06-11-gui-app-capture-design.md`

> **PLANNING NOTE — read before executing.** Phase 1 is a **blocking decision gate**. Phases 2–5 below have their file structure, interfaces, and architecture-independent tasks specified, but the *capture-adapter internals* (Phase 4) depend on whether the spike picks fetch-hook or DOM. After the Phase 1 gate, re-invoke `superpowers:writing-plans` to expand Phase 4's adapter tasks into bite-sized TDD steps using the spike's chosen method and the real captured wire/DOM shape. Do not write speculative adapter tasks before the gate.

---

## File Structure

```
spike/browser-ext/                     # Phase 1 — THROWAWAY (deleted after gate, FINDINGS.md kept)
  manifest.json  content.js  inject.js  worker.js
spike/FINDINGS.md                      # Phase 1 — KEPT: the decision record

packages/shared/src/
  capture-hosts.ts                     # Phase 2 — CAPTURE_HOSTS single source of truth

mcp/src/capture/ingest/
  ingest-route.ts                      # Phase 3 — daemon loopback POST /capture handler
  redact.ts                            # Phase 3 — credential redaction (R3)
  capture-rate.ts                      # Phase 5 — per-host rate tracking + zero-capture signal (R2)

extension/                             # Phase 4 — production MV3 extension (new workspace)
  manifest.json
  src/content/index.ts                 # injected entry; routes to per-host adapter
  src/content/adapters/claude-ai.ts    # per-host extractor (METHOD = spike outcome)
  src/content/adapters/chatgpt.ts
  src/content/adapters/types.ts        # CaptureAdapter interface (fixed below)
  src/worker/index.ts                  # batch / dedupe / back-off / POST to daemon
  test/adapters/*.fixture.json         # golden fixtures per host

mcp/src/cli/wizard.ts                  # Phase 5 — opt-in step + install instructions (modify)
docs/E2E-PROTOCOL.md                   # Phase 5 — manual browser smoke checklist (modify)
```

---

## Phase 1: Bake-off spike (BLOCKING GATE)

**Purpose:** Answer one question before any production build — *can we reliably read a claude.ai / chatgpt.com conversation, and by which method (fetch-hook vs DOM)?* This is exploratory, not TDD: the deliverable is a findings doc + a go/no-go decision, not tested production code.

### Task 1: Scaffold a throwaway MV3 extension

**Files:**
- Create: `spike/browser-ext/manifest.json`
- Create: `spike/browser-ext/content.js`, `spike/browser-ext/inject.js`, `spike/browser-ext/worker.js`

- [ ] **Step 1: Write the manifest**

```json
{
  "manifest_version": 3,
  "name": "Synapse Capture Spike (THROWAWAY)",
  "version": "0.0.1",
  "permissions": ["scripting"],
  "host_permissions": ["https://claude.ai/*", "https://chatgpt.com/*"],
  "background": { "service_worker": "worker.js" },
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*", "https://chatgpt.com/*"],
      "js": ["content.js"],
      "run_at": "document_start"
    }
  ]
}
```

- [ ] **Step 2: Stub the service worker** — `worker.js`:

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  console.log("[synapse-spike] worker received:", JSON.stringify(msg).slice(0, 2000));
});
```

- [ ] **Step 3: Load it** — Chrome → `chrome://extensions` → enable Developer mode → "Load unpacked" → select `spike/browser-ext/`. Confirm it loads with no manifest errors.

### Task 2: Probe A — fetch/XHR hook (MAIN world)

**Files:** Modify `spike/browser-ext/manifest.json`, `spike/browser-ext/content.js`

> **P6 fix:** use MV3 `"world": "MAIN"` (Chrome 111+) so the content script runs directly in the page's JS context — this **eliminates `inject.js`, the `postMessage` relay, AND the `document_start` race** where the page's first fetch beats async injection. (If the spike confirms GO-FETCH, Phase 4 inherits this simpler shape.) A MAIN-world script can't use `chrome.runtime.sendMessage`; log to `console` for the probe (it's throwaway), and **also log every same-origin fetch URL with no body** so the endpoint filter can be corrected live rather than producing a false negative.

- [ ] **Step 1: Add a MAIN-world content script** to `manifest.json` (second `content_scripts` entry):

```json
  { "matches": ["https://claude.ai/*", "https://chatgpt.com/*"], "js": ["content-main.js"], "run_at": "document_start", "world": "MAIN" }
```

- [ ] **Step 2: Write the hook** — `spike/browser-ext/content-main.js`:

```javascript
(function () {
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    if (url && url.startsWith(location.origin)) console.log("[spike] ALL-URL", url); // correct the filter live
    const res = await origFetch.apply(this, args);
    try {
      if (url && /\/(api|chat|conversation|messages|completion|append|prompt)/i.test(url)) {
        const clone = res.clone();
        const ct = clone.headers.get("content-type") || "";
        const body = ct.includes("text/event-stream") ? "[SSE stream — needs stream-read]" : await clone.text();
        console.log("[spike] A-fetch", url, ct, String(body).slice(0, 5000));
      }
    } catch (e) { /* probe only */ }
    return res;
  };
})();
```

- [ ] **Step 3: Run the probe** — reload, open `claude.ai`, send one message ("say hello"). Open the **page** devtools console (not the SW console — MAIN world logs there). Record: did conversation payloads appear? Body JSON or `[SSE stream]`? Compare the `ALL-URL` lines against the filter regex and note the real conversation endpoints. If SSE, flag that the response is streamed (the hook sees the request but the body needs stream-reading).

- [ ] **Step 4: Repeat on `chatgpt.com`** — same message, record the same.

### Task 3: Probe B — DOM observation

**Files:** Create `spike/browser-ext/content-dom.js`; add to `manifest.json` content_scripts

- [ ] **Step 1: Write a MutationObserver probe** — `content-dom.js`:

```javascript
const seen = new WeakSet();
const obs = new MutationObserver(() => {
  // claude.ai message turns; selector confirmed/adjusted live during the probe
  document.querySelectorAll('[data-testid*="message"], [class*="message"]').forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const role = el.getAttribute("data-message-author-role") || el.className;
    chrome.runtime.sendMessage({ probe: "B-dom", role, text: (el.textContent || "").slice(0, 500) });
  });
});
obs.observe(document.body, { childList: true, subtree: true });
```

- [ ] **Step 2: Add it to the manifest** content_scripts array (second entry, same matches, `run_at: document_idle`).

- [ ] **Step 3: Run the probe** — reload, open claude.ai, send a message. Record: are both user and assistant turns captured? Is the role distinguishable? Does it survive scrolling / a streamed (token-by-token) assistant reply? Repeat on chatgpt.com. Note selector fragility (these are obfuscated/hashed classes).

### Task 4: Probe C (reference) — assess MITM parse, no full build

**Files:** none (analysis)

- [ ] **Step 1: Capture the wire shape from Probe A.** Using the Probe-A bodies recorded in Task 2, determine whether the existing proxy parser (`mcp/src/capture/proxy/session-reconstruction.ts` + `endpoint-recognition.ts`) could parse them. The MITM sees the *same bytes* a fetch-hook sees, so this is a paper comparison: does MITM add any capture capability the extension lacks for browser hosts? (Expected: no — it only adds the OS-proxy + System-CA shell.) Record the conclusion.

- [ ] **Step 2: Note the local constraint.** A real MITM browser test needs a System-keychain CA (admin). If admin is unavailable on the dev machine, state that Probe C stays analytical and the decision rests on Probe A vs B. (Do NOT install a System CA here — out of spike scope.)

### Task 5: Record findings + decision gate

**Files:** Create `spike/FINDINGS.md`

- [ ] **Step 1: Write the findings.** Document, per host (claude.ai, chatgpt.com) and per method (A-fetch, B-dom): captured reliably? wire/DOM shape (with a redacted sample)? robustness to streaming + UI changes? Then a recommendation: which method, or rethink.

- [ ] **Step 2: Record the gate decision** at the top of FINDINGS.md as one of:
  - **GO-FETCH** — fetch-hook captures reliably → Phase 4 adapters use the fetch-hook method.
  - **GO-DOM** — DOM observation captures reliably → Phase 4 adapters use the DOM method.
  - **GO-MIXED** — different method per host (record which).
  - **RETHINK** — neither parses → stop, return to brainstorming before Phases 2-5.

- [ ] **Step 3: Commit the findings, delete the throwaway probe code.**

```bash
git rm -r spike/browser-ext
git add spike/FINDINGS.md
git commit -m "spike(browser-capture): bake-off findings + capture-method decision"
```

- [ ] **Step 4: GATE.** If RETHINK, stop and re-brainstorm. Otherwise re-invoke `superpowers:writing-plans` to expand Phase 4 adapter tasks with the chosen method + real captured shapes, then proceed.

---

## Phase 2: Shared host constant (architecture-independent — fully specified)

### Task 6: `CAPTURE_HOSTS` single source of truth + anti-drift test

**Files:**
- Create: `packages/shared/src/capture-hosts.ts`
- Test: `packages/shared/test/capture-hosts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { CAPTURE_HOSTS, isCaptureHost } from "../src/capture-hosts.js";

describe("CAPTURE_HOSTS", () => {
  it("includes the committed browser hosts", () => {
    expect(CAPTURE_HOSTS).toContain("claude.ai");
    expect(CAPTURE_HOSTS).toContain("chatgpt.com");
  });
  it("isCaptureHost matches exact host, rejects lookalikes", () => {
    expect(isCaptureHost("claude.ai")).toBe(true);
    expect(isCaptureHost("evil-claude.ai.attacker.com")).toBe(false);
    expect(isCaptureHost("notclaude.ai")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npm test -w packages/shared` → FAIL (module not found).

- [ ] **Step 3: Implement** — `packages/shared/src/capture-hosts.ts`:

```typescript
export const CAPTURE_HOSTS = ["claude.ai", "chatgpt.com"] as const;
export type CaptureHost = (typeof CAPTURE_HOSTS)[number];
export function isCaptureHost(host: string): host is CaptureHost {
  return (CAPTURE_HOSTS as readonly string[]).includes(host);
}
```

- [ ] **Step 4: Run it, verify it passes** — `npm test -w packages/shared` → PASS.

- [ ] **Step 5: Commit** — `git add packages/shared/src/capture-hosts.ts packages/shared/test/capture-hosts.test.ts && git commit -m "feat(shared): CAPTURE_HOSTS constant + exact-host matcher"`

---

## Phase 3: Daemon loopback ingest + redaction (architecture-independent — specified)

### Task 7: Credential value-scrub — defense-in-depth (R3 / P3)

> **P3 fix:** the primary privacy boundary is the **allowlist schema** in Task 8 (unknown keys never survive), NOT a key-name blocklist. This function is the *second* layer: it scrubs token-shaped **values** inside the allowed `content` strings (an `sk-…`, a `Bearer …`, a cookie-shaped pair that a model pasted into a message). It runs over `content` after the schema has already dropped every non-allowed key.

**Files:**
- Create: `mcp/src/capture/ingest/redact.ts`
- Test: `mcp/test/unit/redact.test.ts`

- [ ] **Step 1: Write the failing test** — value-pattern scrub, not key-name:

```typescript
import { describe, expect, it } from "vitest";
import { scrubSecretValues } from "../../src/capture/ingest/redact.js";

describe("scrubSecretValues", () => {
  it("redacts token-shaped values inside a string regardless of surrounding key", () => {
    const s = "my key is sk-live-abc123def456ghi789 and auth Bearer eyJhbGciOiJ.payload.sig";
    const out = scrubSecretValues(s);
    expect(out).not.toContain("sk-live-abc123def456ghi789");
    expect(out).not.toContain("eyJhbGciOiJ.payload.sig");
    expect(out).toContain("my key is"); // surrounding prose preserved
  });
  it("redacts cookie-shaped pairs", () => {
    expect(scrubSecretValues("sessionKey=abc123def456")).not.toContain("abc123def456");
  });
  it("leaves ordinary conversation text untouched", () => {
    expect(scrubSecretValues("how do I write a for loop")).toBe("how do I write a for loop");
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npm test -w mcp -- redact` → FAIL.

- [ ] **Step 3: Implement** — `mcp/src/capture/ingest/redact.ts`:

```typescript
const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,                 // provider API keys
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,         // bearer tokens
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWTs
  /\b[A-Za-z0-9_-]*(?:session|cookie|token|secret)[A-Za-z0-9_-]*=\s*[A-Za-z0-9._-]{8,}/gi,
];
export function scrubSecretValues(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}
```

- [ ] **Step 4: Run it, verify it passes** — `npm test -w mcp -- redact` → PASS.

- [ ] **Step 5: Commit** — `git add mcp/src/capture/ingest/redact.ts mcp/test/unit/redact.test.ts && git commit -m "feat(ingest): token-shaped value scrub (R3 defense-in-depth)"`

### Task 8: Loopback ingest route → CloudSyncer (allowlist schema + shared secret)

> **P3 fix:** the body is **schema-allowlisted** — only `{ host ∈ CAPTURE_HOSTS, messages: [{role, content, ts}] }` survives; every other key (headers, cookies, anything the extension shouldn't be sending and per spec §Privacy doesn't) is dropped before anything is built. Then `scrubSecretValues` (Task 7) runs over each `content`. Unknown keys never survive — security by construction, not by enumerating bad names.
> **P5 fix:** resolved the open question → **require a loopback shared-secret.** Loopback binding alone doesn't stop other local processes or a webpage POSTing to `127.0.0.1`. Ingest requires an `X-Synapse-Ingest-Token` matching the token minted at wizard-enable (stored in `proxy-config.json` + the extension's options), AND rejects any request carrying a web `Origin` that isn't the extension's origin.

**Files:**
- Create: `mcp/src/capture/ingest/ingest-route.ts`
- Modify: `packages/shared/src/capture-hosts.ts` (add the host→tool map, P6)
- Test: `mcp/test/unit/ingest-route.test.ts`
- Read first: `mcp/src/capture/cloud-sync.ts` (`CapturedSession` + `CloudSyncer.sync`), `mcp/src/capture/types.ts`

- [ ] **Step 1: Add the host→tool map (P6)** to `packages/shared/src/capture-hosts.ts` — no string hacks:

```typescript
export const HOST_TOOL: Record<CaptureHost, string> = { "claude.ai": "claude-ai", "chatgpt.com": "chatgpt" };
```

- [ ] **Step 2: Write the failing test** — assert (a) loopback + valid token + allowlisted host syncs; (b) non-loopback → 403; (c) bad/missing token → 401; (d) non-allowlisted host → 400; (e) **extra keys are dropped** (the allowlist, not a blocklist); (f) token-shaped values inside `content` are scrubbed:

```typescript
import { describe, expect, it, vi } from "vitest";
import { handleIngest } from "../../src/capture/ingest/ingest-route.js";

const ok = { remoteAddress: "127.0.0.1", token: "T", expectedToken: "T", origin: "chrome-extension://abc" };

describe("handleIngest", () => {
  it("allowlists body, maps host→tool, scrubs values, syncs", async () => {
    const sync = vi.fn().mockResolvedValue(true);
    const body = {
      host: "claude.ai",
      messages: [{ role: "user", content: "key sk-live-abcdef0123456789", ts: "2026-06-11T00:00:00Z" }],
      headers: { cookie: "sessionKey=LEAK" },        // MUST be dropped by the allowlist
      evilExtra: { nested: "drop me" },
    };
    const res = await handleIngest(body, { ...ok, sync });
    expect(res.ok).toBe(true);
    const sent = sync.mock.calls[0][0];
    const blob = JSON.stringify(sent);
    expect(blob).not.toContain("LEAK");          // dropped key
    expect(blob).not.toContain("drop me");       // dropped key
    expect(blob).not.toContain("sk-live-abcdef0123456789"); // scrubbed value
    expect(sent.tool).toBe("claude-ai");          // host→tool map
    expect(sent.messages[0].content).toContain("key"); // prose preserved
  });
  it("rejects non-loopback", async () => {
    expect((await handleIngest({}, { ...ok, remoteAddress: "10.0.0.5", sync: vi.fn() })).status).toBe(403);
  });
  it("rejects a bad token", async () => {
    expect((await handleIngest({}, { ...ok, token: "WRONG", sync: vi.fn() })).status).toBe(401);
  });
  it("rejects a non-allowlisted host", async () => {
    const r = await handleIngest({ host: "evil.com", messages: [] }, { ...ok, sync: vi.fn() });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run it, verify it fails** — `npm test -w mcp -- ingest-route` → FAIL.

- [ ] **Step 4: Implement** `handleIngest(body, { remoteAddress, token, expectedToken, origin, sync })`:
  1. `remoteAddress` loopback (`127.0.0.1`/`::1`) else `{ok:false,status:403}`.
  2. `token === expectedToken` (constant-time compare) else `401`.
  3. `origin` absent OR starts with `chrome-extension://`/`moz-extension://` else `403` (reject web origins).
  4. **Allowlist**: `isCaptureHost(body.host)` else `400`; build `messages` by mapping ONLY `{role: m.role, content: scrubSecretValues(String(m.content)), ts: m.ts}` — read no other field from `body`.
  5. Build `CapturedSession`: `tool: HOST_TOOL[body.host]`, `id` from a content hash mirroring `sessionIdFromNative`, `projectPath` from a browser sentinel (e.g. `synapse://browser/<host>`).
  6. `await sync(session)`; return `{ok:true}`.

- [ ] **Step 5: Run it, verify it passes** — `npm test -w mcp -- ingest-route` → PASS.

- [ ] **Step 6: Mount on the daemon** — loopback `http.createServer` on the capture-worker bound to `127.0.0.1:<ingestport>` (persist port + token in `proxy-config.json`), routing `POST /capture` → `handleIngest(body, { remoteAddress: req.socket.remoteAddress, token: req.headers["x-synapse-ingest-token"], expectedToken: cfg.ingestToken, origin: req.headers.origin, sync: (s) => this.syncer.sync(s) })`. Also handle `POST /heartbeat` (`{host}`) → `rateTracker.heartbeat(host, Date.now())` (Task 14). Bind loopback only (never `0.0.0.0`).

- [ ] **Step 7: Commit** — `git add mcp/src/capture/ingest/ packages/shared/src/capture-hosts.ts && git commit -m "feat(ingest): allowlist-schema /capture route + shared-secret + host→tool map"`

---

## Phase 4: Extension capture (METHOD-DEPENDENT — expand post-gate)

> These tasks' **interfaces are fixed here**; the **adapter internals come from the Phase 1 gate** (GO-FETCH / GO-DOM / GO-MIXED). After the gate, re-invoke writing-plans to fill in the per-host extraction code + golden fixtures using the real captured shape.

**Fixed interface — `extension/src/content/adapters/types.ts`:**
```typescript
export interface CapturedTurn { role: "user" | "assistant"; content: string; ts?: string; }
export interface CaptureAdapter {
  host: string;                          // ∈ CAPTURE_HOSTS
  start(emit: (turn: CapturedTurn) => void): void;   // begins observing (fetch-hook or DOM, per gate)
  stop(): void;
}
```

Planned tasks (to be made bite-sized post-gate):
- **Task 9:** MV3 production manifest + content entry that selects the adapter by `location.host` against `CAPTURE_HOSTS`; web_accessible_resources only if GO-FETCH.
- **Task 10:** `claude-ai` adapter — golden-fixture test first (fixture = the real captured shape from the spike), then implement `start/stop` via the gated method.
- **Task 11:** `chatgpt` adapter — same pattern.
- **Task 12:** Service worker. **P4 fix (MV3 lifecycle — architecture-independent, decide pre-gate):** MV3 service workers are evicted after ~30s idle, so in-memory batch/dedupe state is lost on every eviction → data loss + duplicate sessions. Therefore: buffer captured turns and the dedupe-hash set in `chrome.storage.session` (fall back to `.local` with a size cap), flush-on-wake, and POST to the daemon ingest port with the `X-Synapse-Ingest-Token`. **Daemon-unreachable policy:** buffer up to N turns (cap, e.g. 500), drop oldest beyond the cap, and surface the buffered/dropped state in the extension action badge. **P1 heartbeat:** on a CAPTURE_HOST tab becoming active, POST `{host}` to `/heartbeat` (independent of any extraction) so the daemon's `CaptureRateTracker` can detect a silently-broken adapter. Tests: golden test with mocked `fetch`; eviction-survival test (state restored from `chrome.storage` after a simulated worker restart); buffer-cap test (oldest dropped at N).
- **Task 13:** Anti-drift test — extension manifest `matches` hosts ⊆ `CAPTURE_HOSTS` ⊆ adapter-covered hosts.

---

## Phase 5: Maintenance signal (R2), wizard, packaging (specified where independent)

### Task 14: Per-host zero-capture-rate signal (R2)

**Files:**
- Create: `mcp/src/capture/ingest/capture-rate.ts`
- Test: `mcp/test/unit/capture-rate.test.ts`

> **P1 fix (BLOCKING):** the "attempt" record must come from a **page-visit heartbeat**, not from a malformed-event. Under the extension architecture a broken adapter emits *nothing* — zero events — so a signal keyed on "events arrived but none captured" would stay silent in the single most likely failure mode (UI/wire change). The extension's service worker (Task 12) sends a `heartbeat` ping whenever a CAPTURE_HOST tab is active; that ping is recorded as `didCapture:false`. A real captured turn is recorded as `didCapture:true`. So "tab was open and active, yet zero turns captured over the window" becomes detectable.

- [ ] **Step 1: Write the failing test** — `staleHosts(nowMs)` returns hosts that had heartbeats (the user was active on that host) but zero successful captures over a rolling window:

```typescript
import { describe, expect, it } from "vitest";
import { CaptureRateTracker } from "../../src/capture/ingest/capture-rate.js";

describe("CaptureRateTracker", () => {
  it("flags a host with heartbeats but zero captures (the broken-adapter case)", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    t.heartbeat("claude.ai", 1000);   // tab active, adapter emitted nothing
    t.heartbeat("claude.ai", 2000);
    expect(t.staleHosts(3000)).toContain("claude.ai");
  });
  it("does not flag a host that is capturing turns", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    t.heartbeat("claude.ai", 1000);
    t.capture("claude.ai", 1500);     // a real turn landed
    expect(t.staleHosts(2000)).not.toContain("claude.ai");
  });
  it("does not flag a host with no activity at all (user just isn't using it)", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    expect(t.staleHosts(5000)).not.toContain("claude.ai");
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npm test -w mcp -- capture-rate` → FAIL.

- [ ] **Step 3: Implement** `CaptureRateTracker`: ring of `{host, ts, kind: "heartbeat"|"capture"}` pruned to `windowMs`; `heartbeat(host,ts)` and `capture(host,ts)` append; `staleHosts(now)` = hosts with ≥1 heartbeat and 0 captures in-window. The daemon ingest route calls `heartbeat()` on a `{type:"heartbeat",host}` ping and `capture()` on a real session ingest.

- [ ] **Step 4: Run it, verify it passes** — `npm test -w mcp -- capture-rate` → PASS.

- [ ] **Step 5: Wire the signal (active, per R2)** — in the daemon, on each cycle emit a `daemon.log` warning + a `doctor --smoke` failure line for any `staleHosts()`. (Brief annotation is a follow-up — keep v1 to log + smoke.)

- [ ] **Step 6: Commit** — `git add mcp/src/capture/ingest/capture-rate.ts mcp/test/unit/capture-rate.test.ts && git commit -m "feat(ingest): active zero-capture-rate signal per host (R2)"`

### Task 15: Wizard opt-in step

**Files:** Modify `mcp/src/cli/wizard.ts`; Read first: the existing `runEditorSetup` / capture-confirm pattern (around `clack.confirm` usage)

- [ ] **Step 1:** After the base capture step, add a `clack.confirm` (default false). **P2 fix:** the old draft carried over the retired MITM line ("restores to a direct connection automatically if Synapse stops") — there is no proxy in the extension architecture, nothing to restore. Use extension-appropriate copy:

```
? Also capture browser AI sessions? (claude.ai, chatgpt.com)
    • A small browser extension reads only your conversations on those two sites
    • Sends them to your Synapse via the local daemon — nothing else leaves the page
    • If the daemon is off, the extension buffers briefly, then drops oldest (no data leaves)
  (y/N)
```

On yes: print install instructions (load the extension; dev-mode or unlisted-store per the resolved channel), write the loopback shared-secret (P5) into `proxy-config.json`, and verify the daemon ingest port responds. On no/cancel: skip, no state change.

- [ ] **Step 2:** Manual verification — run `node mcp/dist/index.js wizard` in a scratch HOME, walk the prompt, confirm yes/no both behave and the daemon ingest check runs. (No unit test for the clack flow — matches the existing wizard's tested-surface boundary; the testable logic lives in the ingest route + adapters.)

- [ ] **Step 3: Commit** — `git add mcp/src/cli/wizard.ts && git commit -m "feat(wizard): opt-in browser-capture step"`

### Task 16: Packaging + manual smoke doc

**Files:** Modify `docs/E2E-PROTOCOL.md`; Create `extension/README.md` (load/build instructions)

- [ ] **Step 1:** Add a "Browser capture (manual, per release)" section to E2E-PROTOCOL.md: (a) load the extension in Chrome, open a real claude.ai + chatgpt.com session, confirm a `CapturedSession` reaches the backend AND the synced payload contains no cookie/token (R3 end-to-end); (b) **buffer-survival (P6):** stop the daemon mid-conversation, send a few more turns, restart the daemon → confirm the buffered turns flush and arrive (validates the P4 `chrome.storage` buffer + flush-on-wake).
- [ ] **Step 2:** Write `extension/README.md` — build (`npm run build -w extension`), load-unpacked / store-install instructions, and the "best-effort, may need periodic adapter updates" expectation (R2).
- [ ] **Step 3: Commit** — `git add docs/E2E-PROTOCOL.md extension/README.md && git commit -m "docs: browser-capture manual smoke + extension README"`

---

## Self-review notes (planner)

- **Spec coverage:** browser capture (Phases 1+4), CAPTURE_HOSTS source of truth + host→tool map (Task 6/8), daemon ingest reusing CloudSyncer (Task 8), R3 privacy — **allowlist schema** primary + value-scrub defense-in-depth (Task 8 + Task 7) + end-to-end smoke (Task 16), R2 zero-capture signal **driven by a page-visit heartbeat** so a silently-broken adapter is detectable (Task 12 heartbeat → Task 14 tracker), wizard opt-in + extension-correct copy (Task 15), bake-off spike-first R1/R6.3 (Phase 1, MAIN-world per P6), native apps cut / MITM deferred. Covered.
- **Round-2 plan review (REVIEW.md) applied:** P1 heartbeat (Task 12/14), P2 wizard copy (Task 15), P3 allowlist-not-blocklist (Task 7/8), P4 MV3 SW buffer in `chrome.storage` + daemon-down policy (Task 12), P5 loopback shared-secret + Origin reject — **resolved: required** (Task 8/15), P6 host→tool map + MAIN-world spike + log-all-URLs + buffer-survival smoke (Task 6/2/16).
- **Deliberately deferred to post-gate:** Phase 4 adapter internals (method-dependent — the spec's own decision gate). Planned re-invocation, not a placeholder.
- **Remaining open questions for the user (none block Phase 1):** extension distribution channel — unlisted store vs dev-mode sideload (Task 15); Safari in v1 or Chromium+Firefox only.
```
