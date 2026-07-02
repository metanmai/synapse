#!/usr/bin/env node
// scripts/e2e-proxy-source.mjs
//
// LAYER 7 E2E: real claude CLI through ProxySource (the production wrapper)
// → asserts a CapturedSession is emitted.
//
// Layer 5's e2e validates the proxy primitive directly. This script
// validates one layer up: the ProxySource adapter that the capture-worker
// daemon actually uses. The session event we assert here is the same
// event that, in production, gets fed to `store.save()` + `syncer.sync()`.
//
// What this proves vs Layer 5:
//   Layer 5:  proxy intercepts claude's chat → onCaptured fires.
//   Layer 7:  proxy intercepts → buffer → idle flush → reconstructSessions
//             → 'session' event → SAME shape the file watcher emits.
//
// Usage:
//   cd mcp && npm run build  # ensures dist/ is current
//   node scripts/e2e-proxy-source.mjs
//
// Soft-skips if `claude` not on PATH (matches Layer 5).
//
// Exit codes:
//   0 — ≥1 CapturedSession emitted from ProxySource, OR claude not installed
//   1 — claude ran but ProxySource emitted zero sessions
//   2 — preflight error (mcp/dist not built)

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_PROXY_SOURCE = path.join(REPO_ROOT, "mcp/dist/capture/proxy/proxy-source.js");
const DIST_TLS = path.join(REPO_ROOT, "mcp/dist/capture/proxy/tls.js");

// ── Preflight ────────────────────────────────────────────────────────────

const which = spawnSync("which", ["claude"]);
if (which.status !== 0) {
  console.log("⚠️  claude CLI not on PATH — Layer 7 E2E soft-skipped.");
  process.exit(0);
}
const claudeBin = which.stdout.toString().trim();

if (!hasFile(DIST_PROXY_SOURCE) || !hasFile(DIST_TLS)) {
  console.error("❌ mcp/dist not built. Run `cd mcp && npm run build` first.");
  process.exit(2);
}

const { ProxySource } = await import(DIST_PROXY_SOURCE);
const { TlsManager } = await import(DIST_TLS);

// ── Test setup ───────────────────────────────────────────────────────────

const tmpRoot = mkdtempSync(path.join(tmpdir(), "synapse-proxy-l7-"));
let proxySource;
let fakeServer;

try {
  // Pre-create the CA + the leaf cert for api.anthropic.com via a
  // separate TlsManager. ProxySource's internal TlsManager points at
  // the same caDir; both load the same CA from disk. (The second
  // ensureCa() call is a no-op when the cert already exists.)
  const tlsForFake = new TlsManager({ caDir: tmpRoot });
  tlsForFake.ensureCa();
  const anthropicLeaf = tlsForFake.getLeafCert("api.anthropic.com");
  const caCertPem = readFileSync(tlsForFake.caCertPath(), "utf-8");

  const receivedByFake = [];
  fakeServer = await startFakeUpstream({
    key: anthropicLeaf.key,
    cert: anthropicLeaf.cert,
    onRequest: (info) => receivedByFake.push(info),
  });

  const sessionsEmitted = [];
  proxySource = new ProxySource({
    port: 0,
    tlsManagerOptions: { caDir: tmpRoot },
    // Short flush idleMs so the test isn't slow. Production default is
    // 30s; we override to 2s here. This is independent of the SESSION
    // BOUNDARY window — reconstructSessions still uses its own 5min
    // default for "different conversation" detection.
    idleMs: 2_000,
    upstreamMap: { "api.anthropic.com": fakeServer.url },
    upstreamCa: [...rootCertificates, caCertPem],
  });
  proxySource.on("session", (session) => {
    sessionsEmitted.push(session);
  });
  proxySource.on("error", (err) => {
    console.error(`proxy-source error: ${err}`);
  });

  const { port: proxyPort, caCertPath } = await proxySource.start();

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(" Layer 7 E2E — real claude CLI through ProxySource");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`  claude binary:  ${claudeBin}`);
  console.log(`  proxy:          http://127.0.0.1:${proxyPort}`);
  console.log(`  fake upstream:  ${fakeServer.url}  (cert for api.anthropic.com)`);
  console.log(`  CA cert:        ${caCertPath}`);
  console.log("  flush idleMs:   2000");
  console.log("──────────────────────────────────────────────────────────────────");

  const prompt = "Reply with only the word PONG. No punctuation.";

  const claudeEnv = {
    ...process.env,
    HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
    HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
    NODE_EXTRA_CA_CERTS: caCertPath,
    ANTHROPIC_API_KEY: "sk-ant-fake-l7-test-key",
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
    console.log(`  stdout:         ${truncate(result.stdout.trim(), 200)}`);
  }
  if (result.stderr.trim()) {
    console.log(`  stderr:         ${truncate(result.stderr.trim(), 200)}`);
  }

  // Wait for ProxySource's idle flush to fire (2s after the last capture).
  console.log("  waiting for flush idleMs to elapse + sessions to emit...");
  await new Promise((r) => setTimeout(r, 3_000));

  console.log("──────────────────────────────────────────────────────────────────");
  console.log(`  fake upstream received ${receivedByFake.length} request(s)`);
  console.log(`  ProxySource emitted ${sessionsEmitted.length} session(s)`);

  for (const s of sessionsEmitted) {
    console.log(`    [${s.tool}] id=${s.id}  messages=${s.messages.length}  startedAt=${s.startedAt}`);
    const lastUser = lastUserText(s.messages);
    console.log(`      lastUser="${truncate(lastUser, 60)}"`);
  }

  console.log("══════════════════════════════════════════════════════════════════");

  if (sessionsEmitted.length === 0) {
    console.error("❌ FAIL: ProxySource emitted zero sessions.");
    console.error("   The proxy may have intercepted but reconstructSessions/idle flush failed.");
    process.exit(1);
  }

  const session = sessionsEmitted[0];
  if (session.messages.length === 0) {
    console.error("❌ FAIL: emitted session has 0 messages.");
    process.exit(1);
  }

  console.log(`✅ PASS — ProxySource emitted ${sessionsEmitted.length} session(s).`);
  console.log(`   First session has ${session.messages.length} message(s), tool=${session.tool}.`);
  console.log("   Layer 7 validates the proxy → buffer → reconstruct → 'session' event pipeline.");
  process.exit(0);
} finally {
  try {
    if (proxySource) await proxySource.stop();
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

// ── Helpers (mirror Layer 5 — kept inline so the script reads stand-alone) ──

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

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    return "<complex>";
  }
  return "";
}

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
  const events = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_fake_layer7",
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
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PONG" } }],
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
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
