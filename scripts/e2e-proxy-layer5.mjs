#!/usr/bin/env node
// scripts/e2e-proxy-layer5.mjs
//
// LAYER 5 E2E: REAL claude CLI THROUGH OUR TLS-MITM PROXY.
//
// Spawns `claude -p "..."` with HTTPS_PROXY=our proxy and
// NODE_EXTRA_CA_CERTS=our CA, routes api.anthropic.com to a local
// TLS fake server, and asserts the proxy successfully intercepts the
// resulting /v1/messages chat request.
//
// The spike (mitmproxy) already proved claude honors HTTPS_PROXY +
// NODE_EXTRA_CA_CERTS. Layer 3b's vitest tests already prove the
// proxy's CONNECT/TLS handler works against tls.connect() clients.
// THIS test proves our specific proxy is compatible with claude's
// specific Anthropic SDK — the only thing those two earlier tests
// couldn't validate.
//
// Usage:
//   cd mcp && npm run build  # ensures dist/ is current
//   node scripts/e2e-proxy-layer5.mjs
//
// Soft-skips (exit 0) if `claude` binary isn't on PATH — safe to
// invoke from a future CI merge gate without breaking machines that
// don't have claude installed.
//
// Exit codes:
//   0 — at least one /v1/messages capture succeeded, OR claude not installed (soft-skip)
//   1 — claude ran but no chat capture happened (the test failure case)
//   2 — preflight error (mcp/dist not built, etc.)

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_PROXY_SERVER = path.join(REPO_ROOT, "mcp/dist/capture/proxy/server.js");
const DIST_TLS = path.join(REPO_ROOT, "mcp/dist/capture/proxy/tls.js");

// ── Preflight ────────────────────────────────────────────────────────────

const which = spawnSync("which", ["claude"]);
if (which.status !== 0) {
  console.log("⚠️  claude CLI not on PATH — Layer 5 E2E soft-skipped.");
  console.log("    (Install claude via `npm i -g @anthropic-ai/claude-code` to run this test.)");
  process.exit(0);
}
const claudeBin = which.stdout.toString().trim();

if (!hasFile(DIST_PROXY_SERVER) || !hasFile(DIST_TLS)) {
  console.error("❌ mcp/dist not built. Run `cd mcp && npm run build` first.");
  process.exit(2);
}

const { createProxyServer } = await import(DIST_PROXY_SERVER);
const { TlsManager } = await import(DIST_TLS);

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
  console.log(" Layer 5 E2E — real claude CLI through TLS-MITM proxy");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`  claude binary:  ${claudeBin}`);
  console.log(`  proxy:          http://127.0.0.1:${proxy.port}`);
  console.log(`  fake upstream:  ${fakeServer.url}  (cert for api.anthropic.com)`);
  console.log(`  CA cert:        ${caCertPath}`);
  console.log(`  tmpRoot (cwd):  ${tmpRoot}`);
  console.log("──────────────────────────────────────────────────────────────────");

  const prompt = "Reply with only the word PONG. No punctuation.";

  // Spawn claude with proxy env. cwd=tmpRoot so claude doesn't pick up
  // the repo's .mcp.json (which would try to start the synapse MCP).
  const claudeEnv = {
    ...process.env,
    HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
    HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
    NODE_EXTRA_CA_CERTS: caCertPath,
    ANTHROPIC_API_KEY: "sk-ant-fake-l5-test-key",
    // Don't let the Synapse SessionStart hook fire inside the test child.
    SYNAPSE_DISABLE_SESSION_START: "1",
  };

  console.log(`  prompt:         ${JSON.stringify(prompt)}`);
  console.log("  spawning claude -p... (60s timeout)");

  const claudeStart = Date.now();
  const result = await runClaude(claudeBin, prompt, claudeEnv, tmpRoot, 60_000);
  const elapsed = Date.now() - claudeStart;

  console.log("──────────────────────────────────────────────────────────────────");
  console.log(`  claude exited:  code=${result.code}  signal=${result.signal ?? "—"}  (${elapsed}ms)`);
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
  console.log("   Layer 5 validates the full proxy daemon pipeline end-to-end with real claude.");
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

async function runClaude(bin, prompt, env, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-p", prompt], {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => {
      stdout += c.toString("utf-8");
    });
    proc.stderr.on("data", (c) => {
      stderr += c.toString("utf-8");
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, timeoutMs);
    proc.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
