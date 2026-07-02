# Drift Defense L1 — In-Extension Drift Sentinel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a live wire-format change at `claude.ai`/`chatgpt.com` from real usage — "matched the completion endpoint, bytes arrived, but the adapter parsed nothing" — and surface it as a drift alarm in `synapsesync capture status`.

**Architecture:** The extension's MAIN-world fetch hook already runs `adapter.matchesCompletion(url)` then `adapter.parseResponse(text)`. We add a per-host state machine that watches for *matched + non-empty body + parsed-empty* and, after a threshold, posts a privacy-safe `drift` signal (structural shape only — SSE event names, byte length, one-way hash; never message text) through the existing relay → worker → loopback daemon ingest. The daemon records it on the existing `CaptureRateTracker` and the status command surfaces it next to the R2 zero-capture signal.

**Tech Stack:** TypeScript; MV3 content/worker scripts (`extension/`); Node loopback ingest server (`mcp/src/capture/ingest/`); vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-browser-capture-drift-defense-design.md` (Layer 1).

---

## File Structure

- **Create** `extension/src/content/drift-sentinel.ts` — pure per-host state machine. Input: `{matched, hadBody, parsedOk}` per completion; output: `"drift" | null`.
- **Create** `extension/src/content/drift-shape.ts` — `summarizeShape(text)` → privacy-safe structural descriptor (no values).
- **Modify** `extension/src/content/main.ts` — feed the sentinel from the hook; on drift, `post("drift", shape)`.
- **Modify** `extension/src/worker/index.ts` — handle `kind:"drift"`; `postDrift` → `POST /drift`.
- **Modify** `mcp/src/capture/ingest/ingest-route.ts` — `handleDrift` (guards + allowlist schema).
- **Modify** `mcp/src/capture/ingest/capture-rate.ts` — add `"drift"` kind + `driftHosts(now)`.
- **Modify** `mcp/src/capture/ingest/ingest-server.ts` — route `/drift` → `handleDrift` → `rateTracker.drift`.
- **Modify** `mcp/src/capture/capture-worker.ts` — surface drift hosts in the status output.
- **Create** tests: `extension/test/drift-sentinel.test.ts`, `extension/test/drift-shape.test.ts`, `extension/test/worker-drift.test.ts`; extend `mcp/test/.../ingest-route.test.ts` and `capture-rate.test.ts`.

Run all extension tests with `npm run test -w extension`; all mcp tests with `npm run test -w mcp`.

---

### Task 1: Drift sentinel state machine

**Files:**
- Create: `extension/src/content/drift-sentinel.ts`
- Test: `extension/test/drift-sentinel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extension/test/drift-sentinel.test.ts
import { describe, expect, it } from "vitest";
import { createDriftSentinel } from "../src/content/drift-sentinel.js";

const matchedEmpty = { matched: true, hadBody: true, parsedOk: false };
const matchedOk = { matched: true, hadBody: true, parsedOk: true };

describe("drift sentinel", () => {
  it("fires after threshold consecutive matched-but-empty completions", () => {
    const s = createDriftSentinel({ threshold: 3 });
    expect(s.record("claude.ai", matchedEmpty)).toBeNull();
    expect(s.record("claude.ai", matchedEmpty)).toBeNull();
    expect(s.record("claude.ai", matchedEmpty)).toBe("drift");
  });

  it("resets on any successful parse", () => {
    const s = createDriftSentinel({ threshold: 3 });
    s.record("claude.ai", matchedEmpty);
    s.record("claude.ai", matchedEmpty);
    expect(s.record("claude.ai", matchedOk)).toBeNull();
    expect(s.record("claude.ai", matchedEmpty)).toBeNull(); // counter restarted
  });

  it("ignores unmatched requests and empty bodies (no drift evidence)", () => {
    const s = createDriftSentinel({ threshold: 2 });
    s.record("claude.ai", { matched: false, hadBody: true, parsedOk: false });
    s.record("claude.ai", { matched: true, hadBody: false, parsedOk: false });
    expect(s.record("claude.ai", matchedEmpty)).toBeNull(); // only 1 real strike
  });

  it("tracks hosts independently", () => {
    const s = createDriftSentinel({ threshold: 2 });
    expect(s.record("claude.ai", matchedEmpty)).toBeNull();
    expect(s.record("chatgpt.com", matchedEmpty)).toBeNull();
    expect(s.record("claude.ai", matchedEmpty)).toBe("drift");
  });

  it("re-arms after firing (does not spam every subsequent call)", () => {
    const s = createDriftSentinel({ threshold: 2 });
    s.record("claude.ai", matchedEmpty);
    expect(s.record("claude.ai", matchedEmpty)).toBe("drift");
    expect(s.record("claude.ai", matchedEmpty)).toBeNull(); // counter reset after fire
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w extension -- drift-sentinel`
Expected: FAIL — `createDriftSentinel` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// extension/src/content/drift-sentinel.ts
//
// Per-host drift detector. A completion that MATCHED the endpoint and returned
// a non-empty body but parsed to nothing is the unambiguous signature of a
// wire-format change (an empty/aborted body is not — it carries no evidence).
// Fires after `threshold` such strikes with no successful parse in between,
// then re-arms (resets) so it signals once per run rather than every call.

export interface CompletionOutcome {
  matched: boolean;
  hadBody: boolean;
  parsedOk: boolean;
}

export interface DriftSentinel {
  record(host: string, outcome: CompletionOutcome): "drift" | null;
}

export function createDriftSentinel(opts: { threshold?: number } = {}): DriftSentinel {
  const threshold = opts.threshold ?? 3;
  const strikes = new Map<string, number>();

  return {
    record(host, { matched, hadBody, parsedOk }) {
      if (!matched) return null; // not our endpoint — irrelevant
      if (parsedOk) {
        strikes.set(host, 0); // a good parse clears the host
        return null;
      }
      if (!hadBody) return null; // empty/aborted body — no drift evidence
      const next = (strikes.get(host) ?? 0) + 1;
      if (next >= threshold) {
        strikes.set(host, 0); // re-arm
        return "drift";
      }
      strikes.set(host, next);
      return null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w extension -- drift-sentinel`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/drift-sentinel.ts extension/test/drift-sentinel.test.ts
git commit -m "feat(extension): drift sentinel state machine (matched-but-empty → drift)"
```

---

### Task 2: Privacy-safe shape summarizer

**Files:**
- Create: `extension/src/content/drift-shape.ts`
- Test: `extension/test/drift-shape.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extension/test/drift-shape.test.ts
import { describe, expect, it } from "vitest";
import { summarizeShape } from "../src/content/drift-shape.js";

const SSE = [
  'event: message_start\ndata: {"type":"message_start"}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"SECRET ASSISTANT TEXT"}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
].join("\n\n");

describe("summarizeShape", () => {
  it("extracts unique SSE event names, sorted", () => {
    const s = summarizeShape(SSE);
    expect(s.eventNames).toEqual(["content_block_delta", "message_start", "message_stop"]);
  });

  it("never leaks message content (values or text)", () => {
    const json = JSON.stringify(summarizeShape(SSE));
    expect(json).not.toContain("SECRET ASSISTANT TEXT");
    expect(json).not.toContain("delta");
  });

  it("reports byte length and a stable one-way hash", () => {
    const a = summarizeShape(SSE);
    const b = summarizeShape(SSE);
    expect(a.byteLength).toBe(SSE.length);
    expect(a.sampleHash).toBe(b.sampleHash);
    expect(a.sampleHash).not.toBe(summarizeShape(`${SSE}x`).sampleHash);
  });

  it("caps event names so a pathological body can't bloat the signal", () => {
    const many = Array.from({ length: 100 }, (_, i) => `event: e${i}\ndata: {}`).join("\n\n");
    expect(summarizeShape(many).eventNames.length).toBeLessThanOrEqual(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w extension -- drift-shape`
Expected: FAIL — `summarizeShape` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// extension/src/content/drift-shape.ts
//
// Privacy-safe structural descriptor of a response body, for drift diagnosis.
// Emits ONLY structure: the set of SSE `event:` names, the byte length, and a
// one-way FNV-1a hash of the bytes. Never any value, key, or message text — so
// it is safe to send to the daemon and log.

export interface DriftShape {
  eventNames: string[];
  byteLength: number;
  sampleHash: string;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function summarizeShape(responseText: string): DriftShape {
  const names = new Set<string>();
  for (const line of responseText.split("\n")) {
    if (line.startsWith("event:")) names.add(line.slice("event:".length).trim());
  }
  return {
    eventNames: [...names].sort().slice(0, 20),
    byteLength: responseText.length,
    sampleHash: fnv1a(responseText),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w extension -- drift-shape`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/drift-shape.ts extension/test/drift-shape.test.ts
git commit -m "feat(extension): privacy-safe drift shape summarizer (structure only)"
```

---

### Task 3: Feed the sentinel from the fetch hook

**Files:**
- Modify: `extension/src/content/main.ts` (the `makeHookedFetch` response branch, lines 31-60; `installFetchHook`, lines 62-80)
- Test: `extension/test/full-chain.test.ts` (add a drift describe block)

- [ ] **Step 1: Write the failing test** (append to `extension/test/full-chain.test.ts`)

```ts
describe("drift detection in the hook", () => {
  it("posts a drift signal after 3 matched-but-empty completions", async () => {
    const post = vi.fn();
    // An adapter that matches but never parses (simulates a wire-format change).
    const brokenAdapter = {
      host: "claude.ai" as const,
      matchesCompletion: () => true,
      parseRequest: () => null,
      parseResponse: () => null,
    };
    const origFetch = (async () =>
      new Response("event: unknown\ndata: {}\n\n", { status: 200 })) as unknown as typeof fetch;
    const hooked = makeHookedFetch(origFetch, brokenAdapter, post, createDriftSentinel({ threshold: 3 }));
    for (let i = 0; i < 3; i++) await hooked("https://claude.ai/c/completion", { method: "POST" });
    await waitFor(() => post.mock.calls.some((c) => c[0] === "drift"));
    const drift = post.mock.calls.find((c) => c[0] === "drift");
    expect(drift?.[1]).toMatchObject({ eventNames: ["unknown"] });
  });
});
```

Add the imports at the top of the file:

```ts
import { createDriftSentinel } from "../src/content/drift-sentinel.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w extension -- full-chain`
Expected: FAIL — `makeHookedFetch` takes 3 args, not 4 (TS/arity error or undefined sentinel).

- [ ] **Step 3: Write minimal implementation** (edit `extension/src/content/main.ts`)

Add imports near the top:

```ts
import { type DriftSentinel, createDriftSentinel } from "./drift-sentinel.js";
import { summarizeShape } from "./drift-shape.js";
```

Change the `makeHookedFetch` signature and the response branch to feed the sentinel:

```ts
export function makeHookedFetch(
  origFetch: typeof fetch,
  adapter: CaptureAdapter,
  post: PostFn,
  sentinel?: DriftSentinel,
): typeof fetch {
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const input = args[0];
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const init = args[1];
    const reqBody = typeof init?.body === "string" ? init.body : undefined;

    const res = await origFetch(...args);
    try {
      if (url && adapter.matchesCompletion(url)) {
        if (reqBody) {
          try {
            const userTurn = adapter.parseRequest(JSON.parse(reqBody));
            if (userTurn) post("turn", { role: userTurn.role, content: userTurn.content });
          } catch {
            /* non-JSON request body — ignore */
          }
        }
        void readAll(res.clone()).then((text) => {
          const turn = adapter.parseResponse(text);
          if (turn) post("turn", { role: turn.role, content: turn.content });
          if (sentinel) {
            const outcome = { matched: true, hadBody: text.trim().length > 0, parsedOk: !!turn };
            if (sentinel.record(adapter.host, outcome) === "drift") {
              post("drift", { ...summarizeShape(text) });
            }
          }
        });
      }
    } catch {
      /* capture must never break the page */
    }
    return res;
  };
}
```

In `installFetchHook`, create one sentinel for the page session and pass it:

```ts
export function installFetchHook(win: Window = window, loc: Location = location, doc: Document = document): void {
  const adapter = adapterForHost(loc.host);
  if (!adapter) return;

  const post: PostFn = (kind, payload = {}) => {
    win.postMessage({ __synapse: true, kind, host: loc.host, ...payload }, loc.origin);
  };

  const pingIfVisible = (): void => {
    if (doc.visibilityState === "visible") post("heartbeat");
  };
  pingIfVisible();
  setInterval(pingIfVisible, 60_000);

  win.fetch = makeHookedFetch(win.fetch.bind(win), adapter, post, createDriftSentinel());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w extension -- full-chain`
Expected: PASS — the existing claude/chatgpt full-chain tests still pass (sentinel optional) AND the new drift test passes.

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/main.ts extension/test/full-chain.test.ts
git commit -m "feat(extension): wire drift sentinel into the fetch hook"
```

---

### Task 4: Worker forwards drift to the daemon

**Files:**
- Modify: `extension/src/worker/index.ts` (`installWorker` listener lines 101-118; add `postDrift` + `handleDrift`)
- Test: `extension/test/worker-drift.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extension/test/worker-drift.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { installWorker } from "../src/worker/index.js";

interface PostedDrift {
  url: string;
  token: string | undefined;
  body: { host: string; eventNames: string[]; byteLength: number; sampleHash: string };
}

function installFetchSpy(): PostedDrift[] {
  const seen: PostedDrift[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: unknown) => {
    const i = init as { headers?: Record<string, string>; body?: string };
    if (String(url).includes("/drift") && typeof i?.body === "string") {
      seen.push({ url: String(url), token: i.headers?.["x-synapse-ingest-token"], body: JSON.parse(i.body) });
    }
    return new Response("{}", { status: 200 });
  });
  return seen;
}

function installChromeStub(): ((msg: unknown) => void)[] {
  const listeners: ((msg: unknown) => void)[] = [];
  vi.stubGlobal("chrome", {
    runtime: { onMessage: { addListener: (fn: (msg: unknown) => void) => listeners.push(fn) } },
    storage: {
      local: { get: async () => ({ synapseToken: "tok", synapsePort: 7726 }) },
      session: { get: async () => ({}), set: async () => {} },
    },
    action: { setBadgeText: () => {} },
  });
  return listeners;
}

afterEach(() => vi.unstubAllGlobals());

describe("worker drift forwarding", () => {
  it("POSTs /drift with host + shape + token when it receives a drift message", async () => {
    const seen = installFetchSpy();
    const listeners = installChromeStub();
    installWorker();
    listeners[0]({
      __synapse: true,
      kind: "drift",
      host: "claude.ai",
      eventNames: ["unknown"],
      byteLength: 42,
      sampleHash: "deadbeef",
    });
    await vi.waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0].url).toContain("127.0.0.1:7726/drift");
    expect(seen[0].token).toBe("tok");
    expect(seen[0].body).toEqual({ host: "claude.ai", eventNames: ["unknown"], byteLength: 42, sampleHash: "deadbeef" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w extension -- worker-drift`
Expected: FAIL — the worker ignores `kind:"drift"`, so no `/drift` POST is made.

- [ ] **Step 3: Write minimal implementation** (edit `extension/src/worker/index.ts`)

Extend the `RelayMessage` interface (lines 10-16):

```ts
interface RelayMessage {
  __synapse?: boolean;
  kind?: string;
  host?: string;
  role?: string;
  content?: string;
  eventNames?: string[];
  byteLength?: number;
  sampleHash?: string;
}
```

Add a `postDrift` sender (next to `postCapture`):

```ts
export async function postDrift(
  port: number,
  token: string,
  payload: { host: string; eventNames: string[]; byteLength: number; sampleHash: string },
): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/drift`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-synapse-ingest-token": token },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false; // daemon unreachable
  }
}

async function handleDrift(payload: {
  host: string;
  eventNames: string[];
  byteLength: number;
  sampleHash: string;
}): Promise<void> {
  const { token, port } = await getConfig();
  if (!token) return;
  await postDrift(port, token, payload);
}
```

Add a branch in the `installWorker` listener (after the `heartbeat` branch):

```ts
    if (m.kind === "drift") {
      void handleDrift({
        host: m.host,
        eventNames: Array.isArray(m.eventNames) ? m.eventNames : [],
        byteLength: typeof m.byteLength === "number" ? m.byteLength : 0,
        sampleHash: typeof m.sampleHash === "string" ? m.sampleHash : "",
      });
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w extension -- worker-drift`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/worker/index.ts extension/test/worker-drift.test.ts
git commit -m "feat(extension): worker forwards drift signal to daemon /drift"
```

---

### Task 5: Daemon `handleDrift` route handler

**Files:**
- Modify: `mcp/src/capture/ingest/ingest-route.ts` (add `handleDrift` after `handleHeartbeat`, line 142)
- Test: the existing ingest-route test file (find with `ls mcp/test/**/ingest-route.test.ts`); add a `handleDrift` describe block

- [ ] **Step 1: Write the failing test** (append to the ingest-route test file)

```ts
import { handleDrift } from "../../src/capture/ingest/ingest-route.js"; // adjust relative path to match the file

const guards = {
  remoteAddress: "127.0.0.1",
  token: "secret",
  expectedToken: "secret",
  origin: "chrome-extension://abc",
};

describe("handleDrift", () => {
  it("accepts a valid drift event from a guarded loopback caller", () => {
    const r = handleDrift({ host: "claude.ai", eventNames: ["unknown"], byteLength: 42, sampleHash: "deadbeef" }, guards);
    expect(r).toEqual({ ok: true, host: "claude.ai", eventNames: ["unknown"], byteLength: 42, sampleHash: "deadbeef" });
  });

  it("rejects a non-loopback caller (403)", () => {
    expect(handleDrift({ host: "claude.ai" }, { ...guards, remoteAddress: "10.0.0.5" })).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a bad token (401)", () => {
    expect(handleDrift({ host: "claude.ai" }, { ...guards, token: "wrong" })).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects an unknown host (400)", () => {
    expect(handleDrift({ host: "evil.com" }, guards)).toMatchObject({ ok: false, status: 400 });
  });

  it("reads only the allowlisted fields (extra keys never survive)", () => {
    const r = handleDrift({ host: "claude.ai", cookie: "leak", eventNames: ["x"] }, guards);
    expect(JSON.stringify(r)).not.toContain("leak");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w mcp -- ingest-route`
Expected: FAIL — `handleDrift` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `mcp/src/capture/ingest/ingest-route.ts`)

```ts
export interface DriftResult {
  ok: boolean;
  status?: number;
  host?: CaptureHost;
  eventNames?: string[];
  byteLength?: number;
  sampleHash?: string;
}

/**
 * Drift signal (Layer 1). Same transport guards as ingest. Allowlist schema:
 * host + structural shape only (eventNames, byteLength, sampleHash). No message
 * content is ever sent or read — that is the privacy contract.
 */
export function handleDrift(body: unknown, ctx: Omit<IngestContext, "sync">): DriftResult {
  const rejected = checkGuards(ctx);
  if (rejected !== null) return { ok: false, status: rejected };
  const b = (body ?? {}) as { host?: unknown; eventNames?: unknown; byteLength?: unknown; sampleHash?: unknown };
  if (typeof b.host !== "string" || !isCaptureHost(b.host)) return { ok: false, status: 400 };
  const eventNames = Array.isArray(b.eventNames) ? b.eventNames.filter((n): n is string => typeof n === "string").slice(0, 20) : [];
  return {
    ok: true,
    host: b.host,
    eventNames,
    byteLength: typeof b.byteLength === "number" ? b.byteLength : 0,
    sampleHash: typeof b.sampleHash === "string" ? b.sampleHash : "",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w mcp -- ingest-route`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/capture/ingest/ingest-route.ts mcp/test
git commit -m "feat(daemon): handleDrift ingest route (guards + structure-only allowlist)"
```

---

### Task 6: Rate tracker records drift

**Files:**
- Modify: `mcp/src/capture/ingest/capture-rate.ts` (add `"drift"` kind + `drift()` + `driftHosts()`)
- Test: the existing capture-rate test file (find with `ls mcp/test/**/capture-rate.test.ts`)

- [ ] **Step 1: Write the failing test** (append to the capture-rate test file)

```ts
describe("drift signal", () => {
  it("driftHosts returns hosts with a drift event in the window", () => {
    const t = new CaptureRateTracker({ windowMs: 1000 });
    t.drift("claude.ai", 1000);
    expect(t.driftHosts(1500)).toEqual(["claude.ai"]);
  });

  it("prunes drift events outside the window", () => {
    const t = new CaptureRateTracker({ windowMs: 1000 });
    t.drift("claude.ai", 1000);
    expect(t.driftHosts(2500)).toEqual([]); // 1500ms later, outside 1000ms window
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w mcp -- capture-rate`
Expected: FAIL — `t.drift` / `t.driftHosts` not a function.

- [ ] **Step 3: Write minimal implementation** (edit `mcp/src/capture/ingest/capture-rate.ts`)

Change the kind union (line 17) and add the two methods to the class:

```ts
type RateKind = "heartbeat" | "capture" | "drift";
```

```ts
  /** The extension detected matched-but-unparseable completions for this host. */
  drift(host: string, ts: number): void {
    this.record(host, ts, "drift");
  }

  /** Hosts with ≥1 drift event within the rolling window ending at `now`. */
  driftHosts(now: number): string[] {
    this.prune(now);
    const hosts = new Set<string>();
    for (const e of this.events) {
      if (e.ts <= now && e.kind === "drift") hosts.add(e.host);
    }
    return [...hosts];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w mcp -- capture-rate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/capture/ingest/capture-rate.ts mcp/test
git commit -m "feat(daemon): CaptureRateTracker records + reports drift hosts"
```

---

### Task 7: `/drift` route + status surface

**Files:**
- Modify: `mcp/src/capture/ingest/ingest-server.ts` (add `/drift` route in `handle`, after the `/capture` block, line 94)
- Modify: `mcp/src/capture/capture-worker.ts` (surface drift hosts where `staleHosts` is reported — open the file and find the `staleHosts` call site)
- Test: the existing ingest-server test file if present (`ls mcp/test/**/ingest-server.test.ts`); otherwise add a focused test there

- [ ] **Step 1: Write the failing test** (append to the ingest-server test file, or create it mirroring the `/capture` test)

```ts
it("POST /drift records a drift host on the rate tracker", async () => {
  const tracker = new CaptureRateTracker({ windowMs: 5 * 60 * 1000 });
  const srv = await startIngestServer({
    port: 0,
    token: "secret",
    sync: async () => true,
    rateTracker: tracker,
    log: () => {},
    now: () => 1000,
  });
  const res = await fetch(`http://127.0.0.1:${srv.port}/drift`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-synapse-ingest-token": "secret", origin: "chrome-extension://abc" },
    body: JSON.stringify({ host: "claude.ai", eventNames: ["unknown"], byteLength: 10, sampleHash: "ab" }),
  });
  expect(res.status).toBe(200);
  expect(tracker.driftHosts(1000)).toEqual(["claude.ai"]);
  await srv.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w mcp -- ingest-server`
Expected: FAIL — `/drift` returns 404 (no route), `driftHosts` empty.

- [ ] **Step 3: Write minimal implementation**

In `mcp/src/capture/ingest/ingest-server.ts`, update the import (line 11) and add the route (after the `/capture` block, before the `404`):

```ts
import { handleDrift, handleHeartbeat, handleIngest } from "./ingest-route.js";
```

```ts
    if (url.startsWith("/drift")) {
      const r = handleDrift(body, guards);
      if (r.ok && r.host) {
        opts.rateTracker.drift(r.host, now());
        opts.log(`⚠ capture drift on ${r.host}: events=[${(r.eventNames ?? []).join(",")}] bytes=${r.byteLength} hash=${r.sampleHash}`);
      }
      res.writeHead(r.ok ? 200 : (r.status ?? 400));
      res.end();
      return;
    }
```

In `mcp/src/capture/capture-worker.ts`, locate the line that reports `rateTracker.staleHosts(...)` in the status output and add an adjacent drift report. Concretely, where the stale-host warning is pushed, also push (using the same `now` value already in scope):

```ts
    const drifted = rateTracker.driftHosts(now);
    if (drifted.length > 0) {
      lines.push(`  ⚠ DRIFT — these hosts changed their wire format and capture is failing: ${drifted.join(", ")}. Re-run scripts/e2e-browser-live.mjs, then patch the adapter + golden fixture.`);
    }
```

(If `staleHosts` is surfaced through a returned status object rather than a `lines` array, add a `driftHosts: string[]` field alongside it and render it the same way the stale list is rendered — open the file to match the exact shape.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w mcp -- ingest-server`
Expected: PASS. Then run `npm run typecheck -w mcp` — Expected: clean (confirms the capture-worker edit matches the real status shape).

- [ ] **Step 5: Commit**

```bash
git add mcp/src/capture/ingest/ingest-server.ts mcp/src/capture/capture-worker.ts mcp/test
git commit -m "feat(daemon): /drift route + surface drift hosts in capture status"
```

---

### Task 8: Full verify + anti-drift regression check

**Files:** none (verification only)

- [ ] **Step 1: Run the extension + mcp suites together**

Run: `npm run test -w extension && npm run test -w mcp`
Expected: PASS — all new tests green, no regressions (especially `extension/test/full-chain.test.ts` and `anti-drift.test.ts`).

- [ ] **Step 2: Run the repo verify gate (lint + typecheck + test)**

Run: `npm run verify`
Expected: PASS — biome clean, typecheck clean, all workspace tests green.

- [ ] **Step 3: Manual reasoning check — confirm no content can leak**

Open `extension/src/content/drift-shape.ts` and `mcp/src/capture/ingest/ingest-route.ts::handleDrift`. Confirm by inspection that the only fields crossing the relay/daemon boundary are `host`, `eventNames`, `byteLength`, `sampleHash` — no `content`, no `data:` payloads. This satisfies spec success criterion #4.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore(drift): lint/typecheck fixes for L1 drift sentinel"
```

(Skip if there were no changes.)

---

## Self-Review

**1. Spec coverage (Layer 1):**
- "matched endpoint + completed + parsed-empty → drift" → Tasks 1, 3. ✅
- "≥3 with reset on success, per-host" → Task 1. ✅
- "distinct from R2 zero-capture" → Task 6 adds a separate `drift` kind alongside `heartbeat`/`capture`. ✅
- "structural shape only, no raw bytes" → Tasks 2, 5; verified in Task 8 Step 3. ✅
- "emit via existing relay→worker→loopback ingest, reuse token" → Tasks 3, 4 (reuse `x-synapse-ingest-token`). ✅
- "surface in `synapsesync capture status`" → Task 7. ✅

**2. Placeholder scan:** Task 7 contains one conditional instruction ("open the file to match the exact shape") because `capture-worker.ts`'s status structure wasn't read during planning; the concrete code for the common (`lines` array) case is given, with a typed fallback and a typecheck gate (Task 7 Step 4) that forces the implementer to reconcile it. No other placeholders.

**3. Type consistency:** `CompletionOutcome {matched,hadBody,parsedOk}` (T1) matches the object built in T3. `DriftShape {eventNames,byteLength,sampleHash}` (T2) matches `post("drift", ...)` (T3), the worker `RelayMessage` fields + `postDrift` body (T4), `handleDrift` allowlist (T5), and the `/drift` route (T7). `RateKind` adds `"drift"` (T6) consumed by the route (T7). Consistent end-to-end.

---

## Out of scope for this plan (handled by L2 / L3 plans)

- The proactive synthetic self-test against a live logged-in browser (`scripts/e2e-browser-live.mjs`) → **L2 plan**.
- The CI real-browser mechanics test (Playwright + local fixture server) → **L3 plan**.
