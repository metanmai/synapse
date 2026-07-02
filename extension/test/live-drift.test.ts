// Layer 2 — live browser drift self-test. Attaches to YOUR already-logged-in
// Chrome (launched with --remote-debugging-port=9222), captures the real SSE
// from a real completion, and runs the SHIPPED adapter against it. Asserts the
// parser still extracts a non-empty assistant turn — i.e. the site's wire format
// has not drifted. Skips green when no debug browser is reachable (so it is
// harmless in CI). Never stores credentials; it reuses the live session only.
import { type Browser, chromium } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { chatgptAdapter } from "../src/content/adapters/chatgpt.js";
import { claudeAdapter } from "../src/content/adapters/claude-ai.js";
import type { CaptureAdapter } from "../src/content/adapters/types.js";

// Read the optional env override via globalThis — the extension workspace is a
// browser target (tsconfig types: []), so `process` is not an ambient global here.
const CDP =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SYNAPSE_CDP ??
  "http://127.0.0.1:9222";
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
  const allBodies: string[] = [];
  const seen = new Set<string>();

  page.on("response", (res) => {
    let pathOnly: string;
    try {
      pathOnly = new URL(res.url()).pathname;
    } catch {
      return;
    }
    if (adapter.matchesCompletion(pathOnly)) {
      const url = res.url();
      if (seen.has(url)) return;
      seen.add(url);
      res
        .text()
        .then((t) => {
          // eslint-disable-next-line no-console
          console.log(`  [${label}] matched ${pathOnly} → ${t.length} bytes`);
          allBodies.push(t);
        })
        .catch(() => {});
    }
  });

  await page.goto(openUrl).catch(() => {});
  await page.bringToFront().catch(() => {});

  // Auto-type a short message so the user doesn't have to interact.
  // eslint-disable-next-line no-console
  console.log(`\n>>> [${label}] Tab opened. Page title: "${await page.title()}"\n`);
  try {
    await page.waitForSelector('div[contenteditable="true"], textarea, [role="textbox"]', { timeout: 15_000 });
    const input = page.locator('div[contenteditable="true"], textarea, [role="textbox"]').first();
    await input.click();
    await page.keyboard.type("What are 3 interesting facts about octopuses?", { delay: 10 });
    await page.keyboard.press("Enter");
    // eslint-disable-next-line no-console
    console.log(`  [${label}] Typed prompt and pressed Enter`);
  } catch {
    // eslint-disable-next-line no-console
    console.log(
      `  [${label}] Could not find input — page may require login (title: "${await page.title().catch(() => "?")}")`,
    );
  }

  // Wait for completion(s) to stream in, then concatenate all matching bodies.
  await new Promise<void>((r) => setTimeout(r, WAIT_MS));
  const text = allBodies.join("\n") || null;
  await page.close().catch(() => {});

  if (!text) return { skip: true, reason: "no completion captured (no message sent, or network blocked the site)" };
  const turn = adapter.parseResponse(text);
  if (turn && turn.content.trim().length > 0) {
    // eslint-disable-next-line no-console
    console.log(`  [${label}] ASSISTANT: ${turn.content.slice(0, 500)}`);
  }
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
