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

### Task 2: Probe A — fetch/XHR hook (page context)

**Files:** Modify `spike/browser-ext/content.js`, `spike/browser-ext/inject.js`

Content scripts run in an isolated world and cannot see the page's `window.fetch` calls, so we inject a script into the *page* context that monkeypatches fetch/XHR and relays via `window.postMessage`.

- [ ] **Step 1: Write the page-context hook** — `inject.js`:

```javascript
(function () {
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url && /\/(api|chat|conversation|messages|completion)/i.test(url)) {
        const clone = res.clone();
        const ct = clone.headers.get("content-type") || "";
        const body = ct.includes("text/event-stream") ? "[SSE stream]" : await clone.text();
        window.postMessage({ __synapseSpike: true, url, ct, body: String(body).slice(0, 5000) }, "*");
      }
    } catch (e) { /* probe only */ }
    return res;
  };
})();
```

- [ ] **Step 2: Write the content-script relay** — `content.js`:

```javascript
const s = document.createElement("script");
s.src = chrome.runtime.getURL("inject.js");
(document.head || document.documentElement).appendChild(s);
window.addEventListener("message", (e) => {
  if (e.data && e.data.__synapseSpike) {
    chrome.runtime.sendMessage({ probe: "A-fetch", url: e.data.url, ct: e.data.ct, body: e.data.body });
  }
});
```

- [ ] **Step 3: Add `inject.js` to web_accessible_resources** in `manifest.json`:

```json
  "web_accessible_resources": [{ "resources": ["inject.js"], "matches": ["https://claude.ai/*", "https://chatgpt.com/*"] }]
```

- [ ] **Step 4: Run the probe** — reload the extension, open `claude.ai`, send one message ("say hello"). Open the service-worker console (chrome://extensions → "service worker"). Record: did conversation payloads appear? Is the body JSON or `[SSE stream]`? If SSE, note that the response is streamed (the hook sees the request but the body needs stream-reading — flag for the findings).

- [ ] **Step 5: Repeat on `chatgpt.com`** — same message, record the same.

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

### Task 7: Credential redaction (R3)

**Files:**
- Create: `mcp/src/capture/ingest/redact.ts`
- Test: `mcp/test/unit/redact.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { redactCredentials } from "../../src/capture/ingest/redact.js";

describe("redactCredentials", () => {
  it("strips cookie/authorization/token-shaped fields anywhere in the payload", () => {
    const dirty = {
      messages: [{ role: "user", content: "hi" }],
      headers: { cookie: "sessionKey=abc123", authorization: "Bearer sk-live-xyz" },
      meta: { set_cookie: "x", access_token: "t0ken", sessionId: "s" },
    };
    const clean = redactCredentials(dirty);
    const serialized = JSON.stringify(clean);
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("sk-live-xyz");
    expect(serialized).not.toContain("t0ken");
    expect(clean.messages[0].content).toBe("hi"); // conversation preserved
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npm test -w mcp -- redact` → FAIL.

- [ ] **Step 3: Implement** — `mcp/src/capture/ingest/redact.ts`:

```typescript
const REDACT_KEY = /^(cookie|set-cookie|authorization|.*token|.*api[-_]?key|session[-_]?key)$/i;
export function redactCredentials<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactCredentials) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEY.test(k) ? "[REDACTED]" : redactCredentials(v);
    }
    return out as T;
  }
  return value;
}
```

- [ ] **Step 4: Run it, verify it passes** — `npm test -w mcp -- redact` → PASS.

- [ ] **Step 5: Commit** — `git add mcp/src/capture/ingest/redact.ts mcp/test/unit/redact.test.ts && git commit -m "feat(ingest): credential redaction before persistence (R3)"`

### Task 8: Loopback ingest route → CloudSyncer

**Files:**
- Create: `mcp/src/capture/ingest/ingest-route.ts`
- Test: `mcp/test/unit/ingest-route.test.ts`
- Read first: `mcp/src/capture/cloud-sync.ts` (the `CapturedSession` shape + `CloudSyncer.sync`), `mcp/src/capture/types.ts`

- [ ] **Step 1: Write the failing test** — assert the route (a) rejects non-loopback origins, (b) redacts, (c) normalizes a browser payload to a `CapturedSession`, (d) calls an injected `sync` fn. Inject the syncer so no network:

```typescript
import { describe, expect, it, vi } from "vitest";
import { handleIngest } from "../../src/capture/ingest/ingest-route.js";

describe("handleIngest", () => {
  it("redacts, normalizes, and syncs a browser capture", async () => {
    const sync = vi.fn().mockResolvedValue(true);
    const body = {
      host: "claude.ai",
      messages: [{ role: "user", content: "hi", ts: "2026-06-11T00:00:00Z" }],
      headers: { cookie: "sessionKey=LEAK" },
    };
    const res = await handleIngest(body, { remoteAddress: "127.0.0.1", sync });
    expect(res.ok).toBe(true);
    const sent = sync.mock.calls[0][0];
    expect(JSON.stringify(sent)).not.toContain("LEAK");
    expect(sent.tool).toBe("claude-ai");
    expect(sent.messages[0].content).toBe("hi");
  });
  it("rejects a non-loopback caller", async () => {
    const res = await handleIngest({}, { remoteAddress: "10.0.0.5", sync: vi.fn() });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npm test -w mcp -- ingest-route` → FAIL.

- [ ] **Step 3: Implement** `handleIngest(body, { remoteAddress, sync })`: guard `remoteAddress` is loopback (`127.0.0.1`/`::1`) else `{ok:false,status:403}`; `redactCredentials(body)`; map `{host, messages}` → `CapturedSession` (`tool: host.replace(/\..*/, "") === "claude" ? "claude-ai" : "chatgpt"`, synthesize `id` from a content hash mirroring `sessionIdFromNative`, `projectPath` from a browser-sentinel); `await sync(session)`; return `{ok:true}`. (Wire the HTTP listener into the daemon in Step 5.)

- [ ] **Step 4: Run it, verify it passes** — `npm test -w mcp -- ingest-route` → PASS.

- [ ] **Step 5: Mount on the daemon** — add a loopback `http.createServer` on the capture-worker bound to `127.0.0.1:<ingestport>` (persist port in `proxy-config.json`), routing `POST /capture` → `handleIngest(body, { remoteAddress: req.socket.remoteAddress, sync: (s) => this.syncer.sync(s) })`. Bind loopback only (never `0.0.0.0`).

- [ ] **Step 6: Commit** — `git add mcp/src/capture/ingest/ && git commit -m "feat(ingest): loopback /capture route → CloudSyncer with redaction"`

> **Open question for the user (spec §Open):** require a loopback shared-secret header on `/capture` (defends against other localhost processes posting fake sessions), or is loopback-binding enough? Default in this plan: loopback-only for v1; add the secret if the user wants it (one extra header check + a token in the extension config).

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
- **Task 12:** Service worker — batch turns into a session, dedupe by content hash, exponential back-off, `POST` to the daemon ingest port; golden test with a mocked `fetch`.
- **Task 13:** Anti-drift test — extension manifest `matches` hosts ⊆ `CAPTURE_HOSTS` ⊆ adapter-covered hosts.

---

## Phase 5: Maintenance signal (R2), wizard, packaging (specified where independent)

### Task 14: Per-host zero-capture-rate signal (R2)

**Files:**
- Create: `mcp/src/capture/ingest/capture-rate.ts`
- Test: `mcp/test/unit/capture-rate.test.ts`

- [ ] **Step 1: Write the failing test** — a tracker fed (host, timestamp, didCapture) events; `staleHosts(nowMs)` returns hosts that had activity (CONNECT/ingest attempts) but zero successful captures over a rolling window:

```typescript
import { describe, expect, it } from "vitest";
import { CaptureRateTracker } from "../../src/capture/ingest/capture-rate.js";

describe("CaptureRateTracker", () => {
  it("flags a host with attempts but zero captures over the window", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    t.record("claude.ai", 1000, false);
    t.record("claude.ai", 2000, false);
    expect(t.staleHosts(3000)).toContain("claude.ai");
  });
  it("does not flag a host that is capturing", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    t.record("claude.ai", 1000, true);
    expect(t.staleHosts(2000)).not.toContain("claude.ai");
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npm test -w mcp -- capture-rate` → FAIL.

- [ ] **Step 3: Implement** `CaptureRateTracker`: ring of `{host, ts, ok}` events pruned to `windowMs`; `staleHosts(now)` = hosts with ≥1 attempt and 0 `ok` in-window.

- [ ] **Step 4: Run it, verify it passes** — `npm test -w mcp -- capture-rate` → PASS.

- [ ] **Step 5: Wire the signal (active, per R2)** — in the daemon, on each cycle emit a `daemon.log` warning + a `doctor --smoke` failure line for any `staleHosts()`. (Brief annotation is a follow-up — keep v1 to log + smoke.)

- [ ] **Step 6: Commit** — `git add mcp/src/capture/ingest/capture-rate.ts mcp/test/unit/capture-rate.test.ts && git commit -m "feat(ingest): active zero-capture-rate signal per host (R2)"`

### Task 15: Wizard opt-in step

**Files:** Modify `mcp/src/cli/wizard.ts`; Read first: the existing `runEditorSetup` / capture-confirm pattern (around `clack.confirm` usage)

- [ ] **Step 1:** After the base capture step, add a `clack.confirm` (default false) with the spec §1 copy ("Also capture browser AI sessions? … restores to a direct connection automatically if Synapse stops" — wording per R4). On yes: print install instructions (load the extension; dev-mode or unlisted-store per the resolved open question) and verify the daemon ingest port responds. On no/cancel: skip, no state change.

- [ ] **Step 2:** Manual verification — run `node mcp/dist/index.js wizard` in a scratch HOME, walk the prompt, confirm yes/no both behave and the daemon ingest check runs. (No unit test for the clack flow — matches the existing wizard's tested-surface boundary; the testable logic lives in the ingest route + adapters.)

- [ ] **Step 3: Commit** — `git add mcp/src/cli/wizard.ts && git commit -m "feat(wizard): opt-in browser-capture step"`

### Task 16: Packaging + manual smoke doc

**Files:** Modify `docs/E2E-PROTOCOL.md`; Create `extension/README.md` (load/build instructions)

- [ ] **Step 1:** Add a "Browser capture (manual, per release)" section to E2E-PROTOCOL.md: load the extension in Chrome, open a real claude.ai + chatgpt.com session, confirm a `CapturedSession` reaches the backend AND that the synced payload contains no cookie/token (R3 redaction holds end-to-end).
- [ ] **Step 2:** Write `extension/README.md` — build (`npm run build -w extension`), load-unpacked / store-install instructions, and the "best-effort, may need periodic adapter updates" expectation (R2).
- [ ] **Step 3: Commit** — `git add docs/E2E-PROTOCOL.md extension/README.md && git commit -m "docs: browser-capture manual smoke + extension README"`

---

## Self-review notes (planner)

- **Spec coverage:** browser capture (Phases 1+4), CAPTURE_HOSTS source of truth (Task 6), daemon ingest reusing CloudSyncer (Task 8), credential redaction R3 (Task 7 + smoke Task 16), zero-capture signal R2 (Task 14), wizard opt-in + softened copy R4 (Task 15), bake-off spike-first R1/R6.3 (Phase 1), native apps cut / MITM deferred (not built — correct). Covered.
- **Deliberately deferred to post-gate:** Phase 4 adapter internals (method-dependent — the spec's own decision gate). This is a planned re-invocation, not a placeholder.
- **Open questions surfaced for the user:** loopback shared-secret on ingest (Task 8 note); extension distribution channel (Task 15); Safari scope. None block Phase 1.
```
