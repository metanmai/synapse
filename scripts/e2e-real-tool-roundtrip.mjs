#!/usr/bin/env node
// scripts/e2e-real-tool-roundtrip.mjs
//
// REAL-TOOL ROUNDTRIP: run each supported AI harness against fake creds
// and verify Synapse captures the resulting session.
//
// This is the format-drift regression test. Each harness writes its
// own session-file format (or makes its own HTTPS request shape).
// When upstream tools rev their format unilaterally (the codex 0.50
// incident), Synapse's adapter silently rejects the new shape and the
// user sees nothing — no error, no log, no capture. Synthesized-
// fixture tests can't catch this because they encode the format
// Synapse already knows. ONLY running the real tool and verifying
// capture surfaces format drift.
//
// Two test tiers based on capture path:
//   • File-watcher tier (tools with a Synapse adapter): claude-code,
//     codex, gemini, copilot-cli. Each writes a session file in its
//     own location. The watcher fires, the adapter parses, capture.log
//     records "Captured session ... from <tool>". We invoke each tool
//     with a fake API key — most tools write session metadata BEFORE
//     the LLM call, so auth failure doesn't block the file write that
//     Synapse needs.
//   • Proxy tier (tools without a file-watcher adapter): opencode,
//     crush. These talk to HTTPS endpoints; Synapse intercepts via
//     the TLS-MITM proxy. We invoke with HTTPS_PROXY + a fake key —
//     the HTTPS call happens, gets captured, then fails auth.
//
// Failure modes (all LOUD — no soft-skip):
//   • Tool not on PATH → preflight fails, exit 2. The whole point of
//     this test is "real tools, ran for real" — silently skipping
//     defeats the purpose.
//   • Tool ran but no session file / no proxy event → likely format
//     or path drift in that tool. Adapter needs updating.
//   • capture.log has the line but with wrong tool tag → indicates
//     UA classifier or adapter routing regression.
//
// Usage:
//   cd mcp && npm run build   # ensure latest adapters
//   node scripts/e2e-real-tool-roundtrip.mjs            # all harnesses
//   node scripts/e2e-real-tool-roundtrip.mjs --only=codex,claude-code

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// ── Configuration ────────────────────────────────────────────────────────

const RUN_ID = Date.now();
const TEST_PROMPT = "Reply with only the word PING and nothing else.";
const CAPTURE_LOG = path.join(homedir(), ".synapse", "capture.log");
// How long to wait after spawning a tool before scanning capture.log.
// File-watcher tier: chokidar scans every 5s plus the inner debounce —
// 15-20s is enough.
// Proxy tier: ProxySource buffers + idle-flushes when no new requests
// arrive for `idleMs` (default 30s — see proxy-source.ts:41). After the
// tool exits, we have to wait the FULL idle window before the flush
// fires. 40s = 30s idle + 10s buffer for SSE response assembly +
// emit-to-log latency.
const POST_RUN_WAIT_MS = 40_000;
const TOOL_TIMEOUT_MS = 30_000;

// ── Output helpers ───────────────────────────────────────────────────────

const results = [];
function header(s) {
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  ${s}`);
  console.log("══════════════════════════════════════════════════════════════════");
}
function ok(name, detail) {
  results.push({ name, status: "PASS", detail });
  console.log(`  ✅ PASS · ${name} — ${detail}`);
}
function fail(name, detail) {
  results.push({ name, status: "FAIL", detail });
  console.log(`  ❌ FAIL · ${name} — ${detail}`);
}
function info(s) {
  console.log(`  · ${s}`);
}

// ── Harness configs ──────────────────────────────────────────────────────
//
// Each harness has the same lifecycle (preflight → spawn → verify),
// just with different env + expected tool tag. Shape kept uniform so
// adding a new harness is a single object literal.

const HARNESSES = [
  {
    name: "claude-code",
    tier: "file-watcher",
    binary: "claude",
    expectedTool: "claude-code",
    spawn(testDir) {
      return {
        cmd: "claude",
        args: ["-p", TEST_PROMPT, "--max-turns", "1"],
        cwd: testDir,
        // Fake key — claude validates server-side, but writes the
        // session file in ~/.claude/projects/<encoded-cwd>/ BEFORE
        // calling Anthropic. The "Invalid API key" exit code 1 is
        // expected and harmless for the capture assertion.
        env: { ANTHROPIC_API_KEY: `sk-ant-fake-real-${RUN_ID}` },
      };
    },
  },
  {
    name: "codex",
    tier: "file-watcher",
    binary: "codex",
    expectedTool: "codex",
    spawn(testDir) {
      return {
        cmd: "codex",
        args: ["exec", "--skip-git-repo-check", TEST_PROMPT],
        cwd: testDir,
        // codex.0.50 honors ~/.codex/config.toml; it points at Ollama
        // on this machine, which is the local LLM. A fake key is
        // irrelevant — Ollama doesn't authenticate. Session file
        // lands at ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
        // regardless of LLM success.
        env: {},
      };
    },
  },
  {
    name: "gemini",
    tier: "file-watcher",
    binary: "gemini",
    expectedTool: "gemini",
    spawn(testDir) {
      return {
        cmd: "gemini",
        // --skip-trust avoids the interactive "trust this dir?" prompt;
        // -p sets the prompt non-interactively.
        args: ["--skip-trust", "-p", TEST_PROMPT],
        cwd: testDir,
        env: { GEMINI_API_KEY: `fake-real-${RUN_ID}`, GEMINI_CLI_TRUST_WORKSPACE: "true" },
      };
    },
  },
  {
    name: "copilot-cli",
    tier: "file-watcher",
    binary: "copilot",
    expectedTool: "copilot-cli",
    spawn(testDir) {
      return {
        cmd: "copilot",
        // copilot expects -p / a one-shot mode; we drive it
        // non-interactively. If auth fails, the session-state file
        // should still land.
        args: ["-p", TEST_PROMPT, "--allow-all-tools"],
        cwd: testDir,
        env: { GH_COPILOT_TOKEN: `fake-real-${RUN_ID}` },
      };
    },
  },
  {
    name: "opencode",
    tier: "proxy",
    binary: "opencode",
    // Proxy-tier tools have no file-watcher adapter; they're captured
    // by the proxy intercepting api.anthropic.com. UA-based classifier
    // assigns the `opencode` tool tag (registered in
    // mcp/src/capture/proxy/user-agent-classify.ts).
    //
    // Pollution-avoidance for first-run: opencode does a network probe
    // against github.com / objects.githubusercontent.com (ripgrep cache
    // validation) on every run. With HTTPS_PROXY set, that probe routes
    // through the MITM proxy → Bun's BoringSSL doesn't trust the Synapse
    // CA for github leaves → handshake stalls → opencode never reaches
    // the LLM call. NO_PROXY for github keeps the cache check direct;
    // the LLM call still routes through the proxy. Documented in
    // BUGS.md.
    expectedTool: "opencode",
    spawn(testDir) {
      return {
        cmd: "opencode",
        args: ["run", TEST_PROMPT],
        cwd: testDir,
        env: {
          ANTHROPIC_API_KEY: `sk-ant-fake-real-${RUN_ID}`,
          HTTPS_PROXY: "http://127.0.0.1:7727",
          HTTP_PROXY: "http://127.0.0.1:7727",
          NO_PROXY: "github.com,objects.githubusercontent.com,models.dev",
          no_proxy: "github.com,objects.githubusercontent.com,models.dev",
          NODE_EXTRA_CA_CERTS: path.join(homedir(), ".synapse", "proxy", "ca.pem"),
          SSL_CERT_FILE: path.join(homedir(), ".synapse", "proxy", "ca.pem"),
        },
      };
    },
  },
  {
    name: "crush",
    tier: "proxy",
    binary: "crush",
    // UA-based classifier assigns the `crush` tool tag (registered in
    // user-agent-classify.ts). crush honors HTTPS_PROXY (probe confirmed
    // it dials the proxy), BUT brew-built Go binaries on macOS use
    // Apple's Security.framework for TLS verification, which consults
    // the system keychain — NOT env-var CA pools. So SSL_CERT_FILE /
    // SSL_CERT_DIR / GODEBUG=x509usefallbackroots=1 are all ignored.
    // On a machine where the Synapse CA can be installed in the user's
    // login keychain (or system keychain), this test PASSES. On a
    // corporate-managed Mac where keychain modification is blocked, it
    // fails with `tls: failed to verify certificate`. Documented in
    // BUGS.md as a known environmental blocker; not a Synapse bug.
    expectedTool: "crush",
    spawn(testDir) {
      return {
        cmd: "crush",
        args: ["run", TEST_PROMPT],
        cwd: testDir,
        env: {
          ANTHROPIC_API_KEY: `sk-ant-fake-real-${RUN_ID}`,
          HTTPS_PROXY: "http://127.0.0.1:7727",
          HTTP_PROXY: "http://127.0.0.1:7727",
          // Best-effort CA env vars — some Go builds honor these.
          // No-op on brew's macOS build (CGO_ENABLED=1 keychain path).
          SSL_CERT_FILE: path.join(homedir(), ".synapse", "proxy", "ca.pem"),
          SSL_CERT_DIR: path.join(homedir(), ".synapse", "proxy"),
        },
      };
    },
  },
];

// ── Capture verification ─────────────────────────────────────────────────

/**
 * Read capture.log and return entries from `since` (epoch ms) onwards
 * that match a "Captured session ... from <tool>" line. For proxy-tier
 * tools we accept "Captured proxy session ... from <any>" too.
 */
function newCapturesSince(sinceEpochMs, expectedTool, tier) {
  if (!existsSync(CAPTURE_LOG)) return [];
  const raw = readFileSync(CAPTURE_LOG, "utf-8");
  const lines = raw.split("\n");
  const captureRe =
    tier === "proxy"
      ? /^\[([\d\-T:.Z]+)\] Captured proxy session (ses_\w+) from (\S+)/
      : /^\[([\d\-T:.Z]+)\] Captured session (ses_\w+) from (\S+)/;
  const matches = [];
  for (const line of lines) {
    const m = line.match(captureRe);
    if (!m) continue;
    const ts = Date.parse(m[1]);
    if (Number.isNaN(ts) || ts < sinceEpochMs) continue;
    if (expectedTool && m[3] !== expectedTool) continue;
    matches.push({ timestamp: m[1], sessionId: m[2], tool: m[3] });
  }
  return matches;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Per-harness lifecycle ────────────────────────────────────────────────

async function runHarness(h) {
  header(`HARNESS: ${h.name} (${h.tier})`);

  // 1. Preflight — binary on PATH.
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [h.binary], { encoding: "utf-8" });
  if (which.status !== 0) {
    fail(h.name, `binary "${h.binary}" not on PATH — install it first (this test does NOT soft-skip)`);
    return;
  }
  info(`binary: ${which.stdout.toString().trim().split(/\r?\n/)[0]}`);

  // 2. Make a tmp cwd. Synapse's skip predicate normally drops
  //    /var/folders tests, but `SYNAPSE_DISPATCH_FORCE_ALLOW=1` is
  //    set on the parent (us); spawned tools inherit, hooks honor it.
  const testDir = mkdtempSync(path.join(tmpdir(), `synapse-real-${h.name}-`));
  info(`testDir: ${testDir}`);

  // 3. Spawn the tool. Async — must not block the event loop
  //    because the file watcher + proxy live in the same daemon.
  const cfg = h.spawn(testDir);
  const t0 = Date.now();
  info(`spawning: ${cfg.cmd} ${cfg.args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);

  const exitInfo = await new Promise((resolve) => {
    const proc = spawn(cfg.cmd, cfg.args, {
      cwd: cfg.cwd ?? testDir,
      env: { ...process.env, ...cfg.env },
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
    const timer = setTimeout(() => proc.kill("SIGKILL"), TOOL_TIMEOUT_MS);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });

  info(`exit=${exitInfo.code} (${Date.now() - t0}ms)`);
  if (exitInfo.stderr.trim()) {
    const head = exitInfo.stderr.trim().slice(0, 200);
    info(`stderr: ${head.replace(/\n/g, " | ")}`);
  }

  // 4. Wait for Synapse to catch up + scan capture.log.
  info(`waiting ${POST_RUN_WAIT_MS / 1000}s for capture pipeline...`);
  await sleep(POST_RUN_WAIT_MS);

  const captures = newCapturesSince(t0, h.expectedTool, h.tier);
  if (captures.length === 0) {
    fail(
      h.name,
      `no Synapse ${h.tier === "proxy" ? "proxy " : ""}capture after ${POST_RUN_WAIT_MS / 1000}s${
        h.expectedTool ? ` with tool=${h.expectedTool}` : ""
      } — possible adapter / classifier / format drift`,
    );
  } else {
    const c = captures[captures.length - 1];
    ok(h.name, `captured ${c.sessionId} tool=${c.tool} via ${h.tier}`);
  }

  // 5. Cleanup — testDir + any tool-specific session-file detritus
  //    is left for the user to inspect on failure; on success we
  //    rm the testDir. Tool session files in ~/.codex/sessions/,
  //    ~/.claude/projects/, etc. are NOT removed here because
  //    they're inside the user's persistent state; cleanup of those
  //    happens via the broader sweepArtifacts pattern in cleanup
  //    helpers, out of scope for this test.
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    /* */
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  // Like other E2E scripts: force-allow the skip predicate so tmpdir
  // cwds get past `shouldSkipDispatch`. Child tool processes inherit.
  process.env.SYNAPSE_DISPATCH_FORCE_ALLOW = "1";

  console.log("Synapse real-tool roundtrip");
  console.log("Runs each supported AI harness with fake creds; asserts capture fires.");
  console.log(`capture.log: ${CAPTURE_LOG}`);

  // Filter by --only=name1,name2 if present.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
  const harnesses = only ? HARNESSES.filter((h) => only.includes(h.name)) : HARNESSES;
  if (harnesses.length === 0) {
    console.error(`No matching harness for --only=${only?.join(",")}`);
    process.exit(2);
  }

  // Sanity check: Synapse daemon is alive + proxy enabled (proxy-tier
  // tools need it). If daemon is dead, no capture is possible —
  // fail-fast with a clearer message than per-harness "no capture".
  if (!existsSync(path.join(homedir(), ".synapse", "daemon.healthcheck"))) {
    console.error("❌ Synapse daemon healthcheck file missing — start the daemon first");
    process.exit(2);
  }
  const proxyConfigPath = path.join(homedir(), ".synapse", "proxy-config.json");
  const proxyNeeded = harnesses.some((h) => h.tier === "proxy");
  if (proxyNeeded) {
    let proxyEnabled = false;
    try {
      proxyEnabled = JSON.parse(readFileSync(proxyConfigPath, "utf-8")).enabled === true;
    } catch {
      /* */
    }
    if (!proxyEnabled) {
      console.error("❌ Proxy-tier harnesses need the Synapse proxy enabled. Run: synapsesync capture proxy enable");
      process.exit(2);
    }
  }

  for (const h of harnesses) {
    await runHarness(h);
  }

  // ── Summary ──
  const pass = results.filter((r) => r.status === "PASS").length;
  const failC = results.filter((r) => r.status === "FAIL").length;
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("══════════════════════════════════════════════════════════════════");
  for (const r of results) {
    console.log(`  ${r.status === "PASS" ? "✅" : "❌"} ${r.name}: ${r.detail}`);
  }
  console.log(`\n  Total: ${results.length} · PASS: ${pass} · FAIL: ${failC}`);

  if (failC > 0) {
    console.log("\n❌ Real-tool roundtrip FAILED. Likely adapter or classifier drift.");
    process.exit(1);
  }
  console.log("\n✅ All harnesses captured by Synapse.");
}

main().catch((err) => {
  console.error(`FATAL: ${err.stack ?? err.message}`);
  process.exit(2);
});
