#!/usr/bin/env node
// scripts/e2e-proxy-layer5.mjs
//
// LAYER 5 E2E: HTTPS CLIENT THROUGH OUR TLS-MITM PROXY (UNIVERSAL).
//
// Sends a `POST /v1/messages` to api.anthropic.com via curl with
// HTTPS_PROXY=our proxy and --cacert=our CA, routes api.anthropic.com
// to a local TLS fake server, and asserts the proxy successfully
// intercepts the resulting chat request.
//
// Originally this spawned `claude -p "..."` to do the same thing.
// curl is the universal substitute: it ships natively on macOS,
// Linux, Windows 10+ — no soft-skip for missing claude. The proxy
// captures any HTTPS POST to api.anthropic.com regardless of which
// client emitted it; that's the property we want to validate here.
//
// Layer 3b's vitest tests already prove the proxy's CONNECT/TLS
// handler works against tls.connect() clients. THIS test proves the
// proxy's interception works against a real HTTPS client with a
// well-formed Anthropic-shaped request — the property no faster
// test can cover.
//
// Usage:
//   cd mcp && npm run build  # ensures dist/ is current
//   node scripts/e2e-proxy-layer5.mjs
//
// Exit codes:
//   0 — at least one /v1/messages capture succeeded
//   1 — request fired but no chat capture happened (the test failure case)
//   2 — preflight error (mcp/dist not built, curl missing)

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";

// Opt-out of the daemon's skip-ephemeral-cwd predicate — tests use
// tmpdir() paths that the predicate normally drops.
process.env.SYNAPSE_DISPATCH_FORCE_ALLOW = "1";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_PROXY_SERVER = path.join(REPO_ROOT, "mcp/dist/capture/proxy/server.js");
const DIST_TLS = path.join(REPO_ROOT, "mcp/dist/capture/proxy/tls.js");

// ── Preflight ────────────────────────────────────────────────────────────

// curl is the universal HTTPS client — ships natively on macOS, Linux,
// Windows 10+. If even curl is missing, this is genuinely a broken host.
const curlWhich = spawnSync(process.platform === "win32" ? "where" : "which", ["curl"], { encoding: "utf-8" });
if (curlWhich.status !== 0) {
  console.error("❌ curl not on PATH — required to drive the proxy from any OS.");
  console.error("   curl ships natively on macOS, Linux, and Windows 10+ — its absence indicates a broken host.");
  process.exit(2);
}
const curlBin = (curlWhich.stdout ?? "").toString().trim().split(/\r?\n/)[0];

if (!hasFile(DIST_PROXY_SERVER) || !hasFile(DIST_TLS)) {
  console.error("❌ mcp/dist not built. Run `cd mcp && npm run build` first.");
  process.exit(2);
}

// Convert absolute paths to file:// URLs before dynamic import. Windows
// rejects bare absolute paths in import() — `D:\path\to\x.js` fails
// with ERR_UNSUPPORTED_ESM_URL_SCHEME because the ESM loader reads
// `d:` as a URL scheme. pathToFileURL produces a portable file:// URL
// that works on every platform.
const { createProxyServer } = await import(pathToFileURL(DIST_PROXY_SERVER).href);
const { TlsManager } = await import(pathToFileURL(DIST_TLS).href);

// ── Test state ───────────────────────────────────────────────────────────

const tmpRoot = mkdtempSync(path.join(tmpdir(), "synapse-proxy-l5-"));
let proxy;
let fakeServer;

try {
  const tlsManager = new TlsManager({ caDir: tmpRoot });
  tlsManager.ensureCa();
  const caCertPath = tlsManager.caCertPath();
  const caCertPem = readFileSync(caCertPath, "utf-8");

  // Fake TLS upstream — presents a cert FOR api.anthropic.com signed by
  // our CA, but bound to 127.0.0.1. The proxy will SNI as
  // api.anthropic.com (preserving original host) so the cert validates.
  const anthropicLeaf = tlsManager.getLeafCert("api.anthropic.com");
  const receivedByFake = [];
  fakeServer = await startFakeUpstream({
    key: anthropicLeaf.key,
    cert: anthropicLeaf.cert,
    onRequest: (info) => receivedByFake.push(info),
  });

  // Combined trust bundle: Node's defaults PLUS our CA. Without the
  // defaults, the proxy would reject any outbound call to a public host
  // (e.g. if claude reaches for statsig.anthropic.com); without our CA,
  // the call to the fake would fail.
  const combinedCa = [...rootCertificates, caCertPem];

  const captured = [];
  proxy = await createProxyServer({
    tlsManager,
    upstreamMap: {
      "api.anthropic.com": fakeServer.url,
    },
    upstreamCa: combinedCa,
    onCaptured: (req) => captured.push(req),
  });

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(" Layer 5 E2E — universal HTTPS client (curl) through TLS-MITM proxy");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`  curl binary:    ${curlBin}`);
  console.log(`  proxy:          http://127.0.0.1:${proxy.port}`);
  console.log(`  fake upstream:  ${fakeServer.url}  (cert for api.anthropic.com)`);
  console.log(`  CA cert:        ${caCertPath}`);
  console.log("──────────────────────────────────────────────────────────────────");

  const prompt = "Reply with only the word PONG. No punctuation.";
  // Anthropic /v1/messages request body — minimal shape the SDK + curl
  // both produce. The fake upstream doesn't inspect it; the proxy parses
  // it into a CapturedSession via its endpoint-recognition logic.
  const requestBody = JSON.stringify({
    model: "claude-opus-4-7",
    max_tokens: 16,
    messages: [{ role: "user", content: prompt }],
  });

  console.log(`  prompt:         ${JSON.stringify(prompt)}`);
  console.log("  POST /v1/messages via curl through proxy... (30s timeout)");

  const curlStart = Date.now();
  const result = await postAnthropicViaProxy({
    curlBin,
    proxyUrl: `http://127.0.0.1:${proxy.port}`,
    caCertPath,
    body: requestBody,
    timeoutMs: 30_000,
  });
  const elapsed = Date.now() - curlStart;

  console.log("──────────────────────────────────────────────────────────────────");
  console.log(`  curl exited:    code=${result.code}  (${elapsed}ms)`);
  if (result.stdout.trim()) {
    console.log(`  stdout (first 300 chars):  ${truncate(result.stdout.trim(), 300)}`);
  }
  if (result.stderr.trim()) {
    console.log(`  stderr (first 300 chars):  ${truncate(result.stderr.trim(), 300)}`);
  }

  console.log("──────────────────────────────────────────────────────────────────");
  console.log(`  fake upstream received ${receivedByFake.length} request(s)`);
  const uniquePaths = [...new Set(receivedByFake.map((r) => r.path))];
  for (const p of uniquePaths) {
    const count = receivedByFake.filter((r) => r.path === p).length;
    console.log(`    ${count}×  ${p}`);
  }

  console.log(`  proxy captured ${captured.length} chat request(s)`);
  for (const c of captured) {
    const msgs = extractMessages(c.requestBody);
    const lastUser = lastUserText(msgs);
    console.log(
      `    [${c.endpoint.provider}/${c.endpoint.kind}] status=${c.statusCode}  ` +
        `messages=${msgs.length}  lastUser="${truncate(lastUser, 60)}"`,
    );
  }

  console.log("══════════════════════════════════════════════════════════════════");

  const anthropicChat = captured.filter((c) => c.endpoint.provider === "anthropic" && c.endpoint.kind === "messages");

  if (anthropicChat.length === 0) {
    console.error("❌ FAIL: zero /v1/messages captures.");
    console.error("   The proxy did not intercept any anthropic chat request from claude.");
    process.exit(1);
  }

  const first = anthropicChat[0];
  const firstMsgs = extractMessages(first.requestBody);
  if (firstMsgs.length === 0) {
    console.error("❌ FAIL: captured /v1/messages but messages[] is empty.");
    console.error("   The request body did not parse into messages.");
    console.error(`   Raw body type: ${typeof first.requestBody}`);
    process.exit(1);
  }

  console.log(`✅ PASS — proxy captured ${anthropicChat.length} /v1/messages request(s).`);
  console.log(`   First capture has ${firstMsgs.length} message(s).`);
  console.log("   Layer 5 validates the proxy intercepts any HTTPS client (curl here) — universal across OS.");
  process.exit(0);
} finally {
  try {
    if (proxy) await proxy.stop();
  } catch {
    /* ignore */
  }
  try {
    if (fakeServer) await fakeServer.stop();
  } catch {
    /* ignore */
  }
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function hasFile(p) {
  try {
    return spawnSync("test", ["-f", p]).status === 0;
  } catch {
    return false;
  }
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function extractMessages(body) {
  if (!body || typeof body !== "object") return [];
  const m = /** @type {any} */ (body).messages;
  return Array.isArray(m) ? m : [];
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const textBlock = c.find((b) => b?.type === "text" && typeof b.text === "string");
      if (textBlock) return textBlock.text;
    }
    return "<complex>";
  }
  return "";
}

// Fake TLS upstream — minimal HTTPS server that:
//   - returns proper SSE for /v1/messages (claude expects text/event-stream)
//   - returns 200 {} for everything else (lenient — keeps claude moving)
async function startFakeUpstream({ key, cert, onRequest }) {
  const server = createHttpsServer({ key, cert }, async (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    await new Promise((resolve) => req.on("end", resolve));
    const body = Buffer.concat(chunks).toString("utf-8");
    const fullPath = req.url ?? "/";
    const justPath = fullPath.split("?")[0];

    onRequest({ method: req.method, path: justPath, fullPath, bodyLength: body.length });

    if (justPath === "/v1/messages") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.end(buildPongSse());
      return;
    }

    // Lenient catch-all so claude can pass through its 30+ prelude calls
    // (settings, mcp-registry, event_logging, etc.) without being blocked.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  return {
    url: `https://127.0.0.1:${port}`,
    port,
    stop: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function buildPongSse() {
  // Minimal viable SSE response shape per Anthropic's streaming protocol.
  // Just enough events to make the SDK consider the response complete.
  const events = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_fake_layer5",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-opus-4-7",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    ],
    [
      "content_block_start",
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "PONG" },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

// curl-based HTTPS client. Posts an Anthropic /v1/messages-shaped request
// through the proxy with the supplied CA. Universal — curl ships on every
// modern OS and honors HTTPS_PROXY-style flags (-x) + custom CA bundles
// (--cacert) consistently.
//
// CRITICAL: uses async spawn + promise, NOT spawnSync. The proxy is a
// Node HTTP server running on the same event loop as this script; if
// we block the loop with spawnSync, the proxy can't process curl's
// CONNECT and curl times out before the response arrives.
//
// User-Agent identifies the request as a claude-cli-style client so the
// proxy's UA classifier tags the captured session accordingly. API key
// is fake — the fake upstream doesn't validate it; we only need the
// proxy to recognize the endpoint shape.
function postAnthropicViaProxy({ curlBin, proxyUrl, caCertPath, body, timeoutMs }) {
  // Windows Git-Bash curl uses SChannel which forces a CRL/OCSP check
  // and rejects our self-signed proxy CA with "revocation status unknown".
  // `--ssl-no-revoke` skips the check on SChannel and is a no-op on other
  // backends. See full rationale in scripts/e2e-llm-driver.mjs.
  const platformCurlFlags = process.platform === "win32" ? ["--ssl-no-revoke"] : [];
  const args = [
    "-sS",
    "--max-time",
    String(Math.ceil(timeoutMs / 1000)),
    "-x",
    proxyUrl,
    "--cacert",
    caCertPath,
    ...platformCurlFlags,
    "-H",
    "Content-Type: application/json",
    "-H",
    "x-api-key: sk-ant-fake-l5-test-key",
    "-H",
    "anthropic-version: 2023-06-01",
    "-H",
    "User-Agent: claude-cli/synapse-e2e-l5",
    "-X",
    "POST",
    "https://api.anthropic.com/v1/messages",
    "-d",
    body,
  ];
  return new Promise((resolve) => {
    const proc = spawn(curlBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => {
      stdout += c.toString("utf-8");
    });
    proc.stderr.on("data", (c) => {
      stderr += c.toString("utf-8");
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs + 5_000);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
