#!/usr/bin/env node
// scripts/e2e-browser-mechanics.mjs  (Drift-defense Layer 3)
//
// REAL-BROWSER MECHANICS TEST. Loads the *actual built extension*
// (extension/dist) into a real Chromium and proves the whole in-browser chain
// fires: MAIN-world fetch hook → ISOLATED relay → service-worker → POST /capture.
//
// It does NOT touch the live site (that's L2, which needs a logged-in session).
// Instead it host-maps claude.ai → a local HTTPS server that streams the SAME
// recorded SSE the golden fixtures use, and asserts the captured assistant turn
// reaches a mock daemon. Frozen-by-design: this guards OUR code, not their wire.
//
// Headed-only: MV3 service workers do not register in headless Chromium on the
// pinned Playwright build, so this launches a real (visible) window. In CI run
// it under a virtual display (xvfb-run). Skips green if Playwright/Chromium or
// openssl are unavailable (e.g. proxy-blocked install).
//
// Usage: node scripts/e2e-browser-mechanics.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(REPO, "extension", "dist");
const HTTPS_PORT = 8443;
const DAEMON_PORT = 7726;
const COMPLETION_PATH = "/api/organizations/o/chat_conversations/c/completion";

const log = (m) => process.stdout.write(`${m}\n`);

// Rebuild the claude completion SSE from the golden fixture (same shape as the
// adapter unit tests), so this test and those tests can never disagree.
const fixture = JSON.parse(
  readFileSync(path.join(REPO, "extension/test/adapters/fixtures/claude-completion.json"), "utf8"),
);
function buildClaudeSSE(deltas) {
  const events = deltas.map(
    (text) =>
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })}`,
  );
  return `${['event: message_start\ndata: {"type":"message_start"}', ...events, 'event: message_stop\ndata: {"type":"message_stop"}'].join("\n\n")}\n`;
}
const SSE = buildClaudeSSE(fixture.deltas);
const EXPECTED = fixture.expectedAssistant;

const PAGE = `<!doctype html><meta charset="utf-8"><title>fixture</title><script>
  fetch(${JSON.stringify(COMPLETION_PATH)}, { method: "POST", body: JSON.stringify({ prompt: "say hello" }) });
</script>ok`;

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    log("· playwright not available — skipping L3 (green)");
    process.exit(0);
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "l3-"));
  const keyP = path.join(tmp, "key.pem");
  const certP = path.join(tmp, "cert.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        keyP,
        "-out",
        certP,
        "-days",
        "1",
        "-nodes",
        "-subj",
        "/CN=claude.ai",
      ],
      { stdio: "ignore" },
    );
  } catch {
    log("· openssl not available — skipping L3 (green)");
    rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }

  const https = createHttps({ key: readFileSync(keyP), cert: readFileSync(certP) }, (req, res) => {
    if (process.env.L3_DEBUG) log(`  https <- ${req.method} ${req.url}`);
    if (req.method === "POST" && req.url === COMPLETION_PATH) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(SSE);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE);
  });
  await new Promise((r) => https.listen(HTTPS_PORT, "127.0.0.1", r));

  const captured = [];
  // Mirrors the REAL daemon's CORS/Private-Network preflight handling (pinned by
  // mcp/test/unit/ingest-server.test.ts) so the extension service worker's
  // cross-origin POST to this loopback origin isn't blocked by the browser.
  const daemon = createHttp((req, res) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.startsWith("chrome-extension://")) {
      res.setHeader("access-control-allow-origin", origin);
    }
    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-methods", "POST, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type, x-synapse-ingest-token");
      res.setHeader("access-control-allow-private-network", "true");
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      if (req.url?.startsWith("/capture")) {
        try {
          captured.push(JSON.parse(body));
        } catch {}
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => daemon.listen(DAEMON_PORT, "127.0.0.1", r));

  let ctx = null;
  let code = 1;
  try {
    ctx = await chromium.launchPersistentContext("", {
      headless: false,
      ignoreHTTPSErrors: true,
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        "--host-resolver-rules=MAP claude.ai:443 127.0.0.1:8443",
        "--ignore-certificate-errors",
      ],
    });

    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
    // configure the extension so the worker actually forwards (token = opt-in)
    await sw.evaluate(() => chrome.storage.local.set({ synapseToken: "l3-token", synapsePort: 7726 }));

    const pg = await ctx.newPage();
    if (process.env.L3_DEBUG) {
      pg.on("console", (m) => log(`  [page] ${m.text()}`));
      pg.on("pageerror", (e) => log(`  [pageerror] ${e.message}`));
      pg.on("requestfailed", (r) => log(`  [reqfailed] ${r.url()} ${r.failure()?.errorText}`));
    }
    const resp = await pg.goto("https://claude.ai/", { waitUntil: "load", timeout: 20000 }).catch((e) => {
      log(`  [goto error] ${String(e.message).split("\n")[0]}`);
      return null;
    });
    if (process.env.L3_DEBUG) {
      log(`  page url=${pg.url()} status=${resp?.status()} swCount=${ctx.serviceWorkers().length}`);
      const stored = await sw
        .evaluate(() => chrome.storage.local.get(["synapseToken", "synapsePort"]))
        .catch((e) => `err:${e.message}`);
      log(`  SW storage = ${JSON.stringify(stored)}`);
      // does the worker actually receive the relay-forwarded messages?
      await sw.evaluate(() => {
        globalThis.__rx = [];
        chrome.runtime.onMessage.addListener((m) => globalThis.__rx.push(m));
      });
      await pg.evaluate(
        (p) => fetch(p, { method: "POST", body: JSON.stringify({ prompt: "probe" }) }),
        COMPLETION_PATH,
      );
      await new Promise((r) => setTimeout(r, 2500));
      const rx = await sw.evaluate(() => globalThis.__rx).catch((e) => `err:${e.message}`);
      log(`  worker received relay messages: ${JSON.stringify(rx)}`);
      const direct = await sw.evaluate(async () => {
        try {
          const r = await fetch("http://127.0.0.1:7726/capture", {
            method: "POST",
            headers: { "content-type": "application/json", "x-synapse-ingest-token": "t" },
            body: JSON.stringify({ host: "claude.ai", messages: [{ role: "user", content: "x" }] }),
          });
          return `ok:${r.status}`;
        } catch (e) {
          return `fetch-fail:${e.message}`;
        }
      });
      log(`  SW→daemon direct fetch: ${direct}`);
    }

    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (captured.some((c) => c.host === "claude.ai" && c.messages?.some((m) => m.content === EXPECTED))) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const hit = captured.find((c) => c.messages?.some((m) => m.content === EXPECTED));
    if (hit) {
      log(`✅ PASS · real extension in real Chromium → captured the assistant turn → POST /capture (host=${hit.host})`);
      code = 0;
    } else {
      log(`❌ FAIL · expected capture never reached the daemon. Got: ${JSON.stringify(captured).slice(0, 400)}`);
    }
  } catch (e) {
    log(`❌ FAIL · ${String(e.message).split("\n")[0]}`);
  } finally {
    if (ctx) await ctx.close();
    https.close();
    daemon.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  log(code === 0 ? "✅ L3 BROWSER MECHANICS PASSED." : "❌ L3 BROWSER MECHANICS FAILED.");
  process.exit(code);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(2);
});
