# HANDOFF: Build Layer 2 — Live Browser Drift Self-Test

**Read this whole file before doing anything. It is self-contained. Follow it literally.**

You are picking up ONE remaining piece of a finished feature. Do not redesign it. Do not touch the other layers.

---

## 1. What you are building (one paragraph)

Synapse captures `claude.ai` and `chatgpt.com` conversations with a browser extension that parses each site's private streaming (SSE) response format. Those sites can change that format with no warning, which would silently break capture. **Your job: a test that opens the *real, logged-in* site, captures the *real* streamed response, runs the *real shipped parser* against it, and asserts the parser still extracts a non-empty assistant message.** If the parser returns nothing, the site changed its format — that is the "drift" the test exists to catch.

This test CANNOT run in normal CI (it needs a logged-in browser). It runs on a developer machine, on demand. It must **skip green** (pass, do nothing) when no browser is available, and **fail (red)** only when a real response fails to parse.

---

## 2. What already exists — DO NOT rebuild these

- **Layer 1 (shipped, green):** an in-extension "drift sentinel" that alarms during real usage. Files under `extension/src/content/` (`drift-sentinel.ts`, `drift-shape.ts`) + daemon side in `mcp/src/capture/ingest/`. Leave it alone.
- **Layer 3 (shipped, green):** `scripts/e2e-browser-mechanics.mjs` — loads the real extension into a local headless-incapable (headed) Chromium against a fake local server. It already found and we already fixed a CORS bug. Leave it alone. You may read it as a Playwright reference.
- **The parsers you will call:** `extension/src/content/adapters/claude-ai.ts` (exports `claudeAdapter`) and `extension/src/content/adapters/chatgpt.ts` (exports `chatgptAdapter`). Each has:
  - `matchesCompletion(urlPath: string): boolean` — true if a URL path is that site's completion endpoint.
  - `parseResponse(responseText: string): { role, content } | null` — parses the raw SSE text into an assistant turn, or `null`.
  You will import and call these. **Do not copy or reimplement them** — the whole point is to test the *shipped* ones.

Full design context (optional reading): `docs/superpowers/specs/2026-06-14-browser-capture-drift-defense-design.md` (Layer 2 section). Also run, at the start of your session, `mcp__synapse__search({ query: "browser capture drift" })` and `mcp__synapse__list_insights({ project: "synapse" })` for background.

---

## 3. Prerequisites — set these up FIRST, then verify

This test attaches to a Chrome you launch in debug mode. **It reuses your existing login. It never stores or copies any password, cookie, or token.**

1. You need a **consumer Google Chrome** installed. **NOT** an enterprise/governance browser (e.g. "Island") — those block the debug port at the OS level and this will never work on them. **NOT** Safari (it can't host this extension).
2. You need a network that can actually reach `claude.ai` / `chatgpt.com` in a browser. Some corporate proxies (e.g. Netskope) block these — if so, use a personal network.
3. **Fully quit Chrome**, then relaunch it in debug mode. On macOS:
   ```
   osascript -e 'quit app "Google Chrome"'
   open -na "Google Chrome" --args --remote-debugging-port=9222 '--remote-allow-origins=*'
   ```
   (On Windows/Linux, launch `chrome --remote-debugging-port=9222 --remote-allow-origins=*`.)
   **The single-quotes around `--remote-allow-origins=*` matter** — without them the shell expands `*` and the launch fails.
4. **Log into `claude.ai` and `chatgpt.com`** in that Chrome.
5. **VERIFY the debug port is open before going further:**
   ```
   curl -s http://127.0.0.1:9222/json/version
   ```
   - If you get a JSON blob with `"webSocketDebuggerUrl"`, you're good.
   - If you get nothing, the port did not open. STOP. Either Chrome wasn't fully quit before relaunch, or this browser/OS blocks remote debugging. Do not continue until `curl` returns JSON.

---

## 4. The exact file to create

Create **`extension/test/live-drift.test.ts`** with EXACTLY this content:

```ts
// Layer 2 — live browser drift self-test. Attaches to YOUR already-logged-in
// Chrome (launched with --remote-debugging-port=9222), captures the real SSE
// from a real completion, and runs the SHIPPED adapter against it. Asserts the
// parser still extracts a non-empty assistant turn — i.e. the site's wire format
// has not drifted. Skips green when no debug browser is reachable (so it is
// harmless in CI). Never stores credentials; it reuses the live session only.
import { type Browser, chromium } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import type { CaptureAdapter } from "../src/content/adapters/types.js";
import { chatgptAdapter } from "../src/content/adapters/chatgpt.js";
import { claudeAdapter } from "../src/content/adapters/claude-ai.js";

const CDP = process.env.SYNAPSE_CDP ?? "http://127.0.0.1:9222";
const WAIT_MS = 90_000; // time for you to type one message

let browser: Browser | null = null;
let triedConnect = false;

async function connect(): Promise<Browser | null> {
  if (triedConnect) return browser;
  triedConnect = true;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 3000 });
  } catch {
    browser = null; // no debug browser → we will skip
  }
  return browser;
}

// IMPORTANT: do NOT call browser.close() — that could close YOUR Chrome.
// Just disconnecting (process exit) leaves your browser running.
afterAll(() => {
  /* intentionally do not close the user's browser */
});

interface Outcome {
  skip: boolean;
  reason?: string;
  parsed?: boolean;
  bytes?: number;
}

async function captureLiveTurn(adapter: CaptureAdapter, openUrl: string, label: string): Promise<Outcome> {
  const b = await connect();
  if (!b) return { skip: true, reason: `no Chrome reachable on ${CDP}` };
  const ctx = b.contexts()[0];
  if (!ctx) return { skip: true, reason: "no browser context (is Chrome logged in?)" };

  const page = await ctx.newPage();
  let resolveBody: (t: string | null) => void = () => {};
  const bodyPromise = new Promise<string | null>((r) => {
    resolveBody = r;
  });

  page.on("response", (res) => {
    let pathOnly: string;
    try {
      pathOnly = new URL(res.url()).pathname;
    } catch {
      return;
    }
    if (adapter.matchesCompletion(pathOnly)) {
      res
        .text()
        .then((t) => resolveBody(t))
        .catch(() => {});
    }
  });

  await page.goto(openUrl).catch(() => {});
  await page.bringToFront().catch(() => {});
  // eslint-disable-next-line no-console
  console.log(`\n>>> [${label}] A tab just opened. Type ONE short message there and press Enter (within ${WAIT_MS / 1000}s)…\n`);

  const text = await Promise.race([bodyPromise, new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS))]);
  await page.close().catch(() => {});

  if (!text) return { skip: true, reason: "no completion captured (no message sent, or network blocked the site)" };
  const turn = adapter.parseResponse(text);
  return { skip: false, parsed: !!turn && turn.content.trim().length > 0, bytes: text.length };
}

describe("L2 live drift — real site wire format still parses", () => {
  it(
    "claude.ai completion still parses to a non-empty assistant turn",
    async () => {
      const r = await captureLiveTurn(claudeAdapter, "https://claude.ai/new", "claude.ai");
      if (r.skip) {
        // eslint-disable-next-line no-console
        console.log(`SKIP (claude.ai): ${r.reason}`);
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`claude.ai: parsed=${r.parsed} bytes=${r.bytes}`);
      expect(r.parsed, "claude.ai SSE no longer parses — WIRE FORMAT DRIFTED, patch claudeAdapter").toBe(true);
    },
    WAIT_MS + 30_000,
  );

  it(
    "chatgpt.com completion still parses to a non-empty assistant turn",
    async () => {
      const r = await captureLiveTurn(chatgptAdapter, "https://chatgpt.com/", "chatgpt.com");
      if (r.skip) {
        // eslint-disable-next-line no-console
        console.log(`SKIP (chatgpt.com): ${r.reason}`);
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`chatgpt.com: parsed=${r.parsed} bytes=${r.bytes}`);
      expect(r.parsed, "chatgpt.com SSE no longer parses — WIRE FORMAT DRIFTED, patch chatgptAdapter").toBe(true);
    },
    WAIT_MS + 30_000,
  );
});
```

---

## 5. How to run it

From the repo root (prepend the node path if `node`/`npm` aren't found: `export PATH="/opt/homebrew/opt/node/bin:$PATH"`):

```
npm run test -w extension -- live-drift
```

When it prints `>>> [claude.ai] A tab just opened…`, switch to that new Chrome tab, type any short message (e.g. "hello"), press Enter, and wait. Repeat for the chatgpt.com tab.

---

## 6. What each result MEANS (read carefully)

- **PASS, with `parsed=true` logged for a site** → that site's wire format still works. 
- **PASS, with `SKIP: …` logged** → the test could not reach a logged-in browser / no message was sent. It did NOT validate anything. This is expected in CI and acceptable locally only if you couldn't set up the browser. **A skip is not a success — it means "not checked."**
- **FAIL (red), `WIRE FORMAT DRIFTED`** → THE FINDING. The site changed its response shape and the shipped parser broke. The captured byte length is logged (`bytes=…`), proving data arrived but didn't parse. **Next step:** open `extension/src/content/adapters/<site>.ts`, compare against the live response, fix `parseResponse`, and update the golden fixture in `extension/test/adapters/fixtures/`. (That fixing is a separate task — just report the drift clearly.)

---

## 7. HARD RULES — do not violate

1. **Never store, print, or copy a session cookie, token, or password.** Attach to the running browser only. If you find yourself reading cookies, stop — you're doing it wrong.
2. **Never call `browser.close()`** on the connected browser — it can close the user's real Chrome. Only `page.close()` pages you opened.
3. **Do not put real credentials in the repo or in CI.**
4. **Do not modify** L1, L3, the adapters, or the daemon. You are only adding `extension/test/live-drift.test.ts`.
5. **Do not "make it pass" by weakening the assertion.** A red here is a real finding about the live site. Report it; don't hide it.

---

## 8. Troubleshooting

| Symptom | Meaning / fix |
|---|---|
| `curl 127.0.0.1:9222/json/version` returns nothing | Chrome not in debug mode. Fully quit Chrome, relaunch with the flags. If still nothing, your browser is governed/locked (e.g. Island) — use a consumer Chrome. |
| Test always logs `SKIP: no Chrome reachable` | Debug port not open (see above), or `SYNAPSE_CDP` points to the wrong port. |
| Test logs `SKIP: no completion captured` | You didn't send a message in time, OR the network blocked the site. Send a short message in the opened tab within 90s. Confirm the site loads normally in that Chrome. |
| `parsed=false` → red | Real drift (or you sent something with no assistant reply — retry with a normal question first to rule that out). |
| `import ... playwright` fails | Run from repo root so it resolves the root `node_modules`. Playwright is already a dependency; do not reinstall (installs may be proxy-blocked). |

---

## 9. Definition of done

- `extension/test/live-drift.test.ts` exists exactly as specified.
- `npm run test -w extension -- live-drift` runs and, with a logged-in debug Chrome, logs `parsed=true` for at least `claude.ai` (chatgpt.com too if reachable).
- The same command **skips green** (no failure) when no debug browser is present, so it never breaks CI.
- Commit it (`git add extension/test/live-drift.test.ts && git commit`) and push. Then report: did each site parse, skip, or drift?
