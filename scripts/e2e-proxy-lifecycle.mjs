#!/usr/bin/env node
// scripts/e2e-proxy-lifecycle.mjs
//
// LAYER 9 E2E — proxy enable / disable lifecycle + restart race guard.
//
// Unit tests at mcp/test/unit/capture/proxy/proxy-config.test.ts already
// cover the 12 file-ops cases (read/write/delete + env-vs-config
// resolution). They CANNOT cover the daemon-restart race because
// spawning real daemons in unit tests is forbidden. THIS test covers
// that exact gap: the full CLI dispatch + actual subprocess spawn +
// real port binding + actual PID transitions.
//
// Bug class under test: "the proxy enable/disable subcommand drops
// state, leaks daemon processes, races on the proxy port, or silently
// fails the daemon restart." Specifically:
//   * Enable writes config but daemon doesn't bind the proxy port.
//   * Disable removes config but old daemon keeps listening.
//   * Rapid enable/disable cycles trigger EADDRINUSE on bind — the
//     exact bug class `restartDaemon()`'s `waitForProcessExit` polling
//     was designed to prevent (see mcp/src/capture/cli.ts).
//   * PID file gets out of sync with actual daemon process.
//
// Isolation strategy:
//   * SYNAPSE_HOME=mktemp_dir — proxy-config.json + capture.pid both
//     land in tmpdir (handoff-paths.ts:synapseRoot() honors it; Commit 1
//     also wired daemon.ts to honor it).
//   * SYNAPSE_PROXY_PORT=17727 — avoid colliding with the real daemon
//     which uses the default 7727. Bug class is "race on bind" not
//     "race on port 7727 specifically." Same restartDaemon code path
//     either way.
//   * NO keychain interaction — Layer 9 has zero keychain calls. Safe
//     on MDM-managed Macs (memory feedback_corp_keychain_blocked).
//
// Note: capture-worker.ts:11 hardcodes the log file to
// `~/.synapse/capture.log` (does NOT honor SYNAPSE_HOME). Our test
// daemon will append to that file. This is harmless — log lines are
// identifiable by the tmpdir paths they reference — but worth flagging
// for anyone diagnosing test runs.
//
// Usage:
//   cd mcp && npm run build      # ensures dist/ is current
//   node scripts/e2e-proxy-lifecycle.mjs
//
// Soft-skips (exit 0):
//   * `lsof` AND `nc` both missing (can't probe port state).
//   * mcp/dist not built (exit 2 — preflight error).
//
// Exit codes:
//   0 — all stages passed, OR soft-skipped
//   1 — one or more stages failed (bug found)
//   2 — preflight error

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The package entry — dispatches to runCapture(). Invoking
// mcp/dist/capture/cli.js directly is a no-op (only exports runCapture).
const DIST_CLI = path.join(REPO_ROOT, "mcp", "dist", "index.js");

// Custom port to avoid colliding with the user's real daemon on 7727.
const PROXY_PORT = 17727;

// ── Preflight ────────────────────────────────────────────────────────────

if (!existsSync(DIST_CLI)) {
  console.error(`❌ Missing ${DIST_CLI}.`);
  console.error("   Run: cd mcp && npm run build");
  process.exit(2);
}

const haveLsof = spawnSync("which", ["lsof"]).status === 0;
const haveNc = spawnSync("which", ["nc"]).status === 0;
if (!haveLsof && !haveNc) {
  console.log("ℹ️  Neither lsof nor nc on PATH — cannot probe port state. Soft-skip.");
  process.exit(0);
}

// ── Logging helpers ──────────────────────────────────────────────────────

const results = [];
function log(m) {
  process.stdout.write(`${m}\n`);
}
function header(s) {
  log("\n══════════════════════════════════════════════════════════════════");
  log(s);
  log("══════════════════════════════════════════════════════════════════");
}
function ok(id, detail) {
  results.push({ id, status: "PASS", detail });
  log(`  ✅ PASS · ${detail}`);
}
function fail(id, detail) {
  results.push({ id, status: "FAIL", detail });
  log(`  ❌ FAIL · ${detail}`);
}
function info(d) {
  log(`  · ${d}`);
}

// ── Port + process helpers ───────────────────────────────────────────────

function portListening(port) {
  if (haveLsof) {
    const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return r.status === 0;
  }
  // Fallback: nc -z probes connect, exit 0 = connection succeeded = listening.
  const r = spawnSync("nc", ["-z", "127.0.0.1", String(port)]);
  return r.status === 0;
}

async function waitForPortState(port, wantListening, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (portListening(port) === wantListening) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// ── Setup ────────────────────────────────────────────────────────────────

header(`Layer 9 E2E — proxy enable/disable lifecycle + race guard (port ${PROXY_PORT})`);

const tmpSynapseHome = mkdtempSync(path.join(tmpdir(), "synapse-proxy-lifecycle-"));
const configPath = path.join(tmpSynapseHome, "proxy-config.json");
const pidPath = path.join(tmpSynapseHome, "capture.pid");

info(`tmpSynapseHome: ${tmpSynapseHome}`);
info(`configPath:     ${configPath}`);
info(`pidPath:        ${pidPath}`);
info(`PROXY_PORT:     ${PROXY_PORT}`);
info(`DIST_CLI:       ${DIST_CLI}`);

const env = {
  ...process.env,
  SYNAPSE_HOME: tmpSynapseHome,
  SYNAPSE_PROXY_PORT: String(PROXY_PORT),
  // Placeholder — daemon doesn't crash on bogus key; CloudSyncer just
  // fails individual syncs. Lifecycle test doesn't generate traffic.
  SYNAPSE_API_KEY: process.env.SYNAPSE_API_KEY ?? "sk-test-e2e-lifecycle",
};

// Preflight: ensure custom test port is free. Real daemon (if any) is on
// 7727 so this rarely matters, but defense-in-depth.
if (portListening(PROXY_PORT)) {
  console.error(`❌ Port ${PROXY_PORT} is already in use. Cannot proceed.`);
  console.error("   Stop whatever is listening and re-run.");
  rmSync(tmpSynapseHome, { recursive: true, force: true });
  process.exit(2);
}

let exitCode = 0;
let lastSpawnedPid = null;

try {
  // ── STAGE 1: initial status (clean state) ────────────────────────────
  header("STAGE 1 · proxy status (initial, clean state)");

  const status0 = spawnSync("node", [DIST_CLI, "capture", "proxy", "status"], {
    env,
    encoding: "utf-8",
    timeout: 15_000,
  });
  const status0Out = `${status0.stdout ?? ""}${status0.stderr ?? ""}`;

  if (status0Out.includes("off")) {
    ok("status0-off", "status shows Enabled 'off' (clean state — correct)");
  } else {
    fail("status0-off", "status doesn't show 'off' in clean state");
  }

  if (!existsSync(configPath)) {
    ok("status0-no-config", "no proxy-config.json yet (clean state)");
  } else {
    fail("status0-no-config", "proxy-config.json exists in clean state — leftover from prior run?");
  }

  // ── STAGE 2: enable ──────────────────────────────────────────────────
  header("STAGE 2 · proxy enable");

  const enable1 = spawnSync("node", [DIST_CLI, "capture", "proxy", "enable"], {
    env,
    encoding: "utf-8",
    timeout: 30_000,
  });
  const enable1Out = `${enable1.stdout ?? ""}${enable1.stderr ?? ""}`;

  // Stdout sanity (lightweight format check).
  if (enable1Out.includes("Proxy enabled")) {
    ok("enable1-stdout-enabled", "stdout includes 'Proxy enabled' marker");
  } else {
    fail("enable1-stdout-enabled", "stdout missing 'Proxy enabled' marker");
  }
  if (enable1Out.includes("Daemon running")) {
    ok("enable1-stdout-daemon", "stdout indicates daemon is running");
  } else {
    fail("enable1-stdout-daemon", "stdout missing 'Daemon running' — daemon spawn failed silently?");
  }

  // State assertions — the load-bearing ones.
  if (existsSync(configPath)) {
    ok("enable1-config-written", "proxy-config.json was written");
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      if (cfg.enabled === true && typeof cfg.enabledAt === "string") {
        ok("enable1-config-shape", "config has { enabled: true, enabledAt: <iso> }");
      } else {
        fail("enable1-config-shape", `config wrong shape: ${JSON.stringify(cfg)}`);
      }
    } catch (err) {
      fail("enable1-config-shape", `config file unparseable: ${err.message}`);
    }
  } else {
    fail("enable1-config-written", "proxy-config.json was NOT written — enable did nothing");
  }

  if (existsSync(pidPath)) {
    const pid1 = Number.parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    if (Number.isFinite(pid1) && isProcessAlive(pid1)) {
      ok("enable1-daemon-alive", `daemon PID ${pid1} is alive`);
      lastSpawnedPid = pid1;
    } else {
      fail("enable1-daemon-alive", `daemon PID ${pid1} from file is NOT alive (zombie or stale PID)`);
    }
  } else {
    fail("enable1-daemon-alive", "capture.pid was NOT written by enable");
  }

  // Wait for proxy port to bind. This is the critical "daemon actually
  // honored effectiveProxyEnabled()" check.
  const bound1 = await waitForPortState(PROXY_PORT, true, 5000);
  if (bound1) {
    ok("enable1-port-listening", `port ${PROXY_PORT} is listening within 5s of enable`);
  } else {
    fail(
      "enable1-port-listening",
      `port ${PROXY_PORT} never bound — daemon ignored proxy config OR proxy failed to start`,
    );
  }

  // ── STAGE 3: status (post-enable) ────────────────────────────────────
  header("STAGE 3 · proxy status (post-enable)");

  const status1 = spawnSync("node", [DIST_CLI, "capture", "proxy", "status"], {
    env,
    encoding: "utf-8",
    timeout: 15_000,
  });
  const status1Out = `${status1.stdout ?? ""}${status1.stderr ?? ""}`;

  // ANSI-resilient check: "since" appears ONLY in the enabled-via-config
  // status output ("Enabled  on (since <iso>)"), never in "off" or
  // "via env override". `" on "` would be ambiguous because clack wraps
  // the token with ANSI codes that break literal-substring matching.
  if (status1Out.includes("since") && status1Out.includes("Enabled")) {
    ok("status1-on", "status shows Enabled 'on (since ...)' — config was read");
  } else {
    fail("status1-on", "status doesn't show 'since' after enable — effectiveProxyEnabled() not reading config");
  }

  // ── STAGE 4: disable ─────────────────────────────────────────────────
  header("STAGE 4 · proxy disable");

  const disable1 = spawnSync("node", [DIST_CLI, "capture", "proxy", "disable"], {
    env,
    encoding: "utf-8",
    timeout: 30_000,
  });
  const disable1Out = `${disable1.stdout ?? ""}${disable1.stderr ?? ""}`;

  if (disable1Out.includes("Proxy disabled")) {
    ok("disable1-stdout-disabled", "stdout includes 'Proxy disabled' marker");
  } else {
    fail("disable1-stdout-disabled", "stdout missing 'Proxy disabled' marker");
  }
  if (disable1Out.includes("without proxy")) {
    ok("disable1-stdout-daemon", "stdout indicates daemon is running without proxy");
  } else {
    fail("disable1-stdout-daemon", "stdout missing 'without proxy' — restart shape changed?");
  }

  if (!existsSync(configPath)) {
    ok("disable1-config-removed", "proxy-config.json removed");
  } else {
    fail("disable1-config-removed", "proxy-config.json still exists after disable");
  }

  // PID transition — proves real daemon restart, not just config flip.
  const pid2Raw = existsSync(pidPath) ? readFileSync(pidPath, "utf-8").trim() : null;
  const pid2 = pid2Raw ? Number.parseInt(pid2Raw, 10) : null;
  if (pid2 && lastSpawnedPid && pid2 !== lastSpawnedPid) {
    ok("disable1-pid-changed", `daemon PID changed ${lastSpawnedPid} → ${pid2} (restart confirmed)`);
    // Old daemon must be dead now.
    const oldDead = await waitForProcessExit(lastSpawnedPid, 3000);
    if (oldDead) {
      ok("disable1-old-pid-dead", `old daemon PID ${lastSpawnedPid} exited`);
    } else {
      fail("disable1-old-pid-dead", `old daemon PID ${lastSpawnedPid} did NOT exit — daemon leak`);
    }
    lastSpawnedPid = pid2;
  } else {
    fail("disable1-pid-changed", `PID didn't change after disable (${lastSpawnedPid} → ${pid2})`);
  }

  // Port must be released within 5s.
  const released1 = await waitForPortState(PROXY_PORT, false, 5000);
  if (released1) {
    ok("disable1-port-released", `port ${PROXY_PORT} was released within 5s`);
  } else {
    fail("disable1-port-released", `port ${PROXY_PORT} still listening 5s after disable — daemon leak`);
  }

  // ── STAGE 5: race guard ──────────────────────────────────────────────
  header("STAGE 5 · race guard (3× rapid enable/disable)");

  // The bug class restartDaemon's waitForProcessExit polling exists to
  // prevent: rapid cycles where new daemon hits EADDRINUSE because old
  // daemon hasn't released the port yet. State-transition assertions
  // (port binds, port releases, PIDs differ) cover this completely.
  let raceFailed = false;
  for (let i = 1; i <= 3; i++) {
    info(`race iteration ${i}/3 — enable`);
    const re = spawnSync("node", [DIST_CLI, "capture", "proxy", "enable"], {
      env,
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (re.status !== 0) {
      fail(`race-iter${i}-enable-exit`, `enable exited ${re.status} (race guard broken)`);
      raceFailed = true;
      break;
    }
    const bound = await waitForPortState(PROXY_PORT, true, 5000);
    if (!bound) {
      fail(
        `race-iter${i}-port-bind`,
        `iter ${i}: port ${PROXY_PORT} never bound — likely EADDRINUSE from previous daemon`,
      );
      raceFailed = true;
      break;
    }
    const enabledPid = existsSync(pidPath) ? Number.parseInt(readFileSync(pidPath, "utf-8").trim(), 10) : null;
    if (!enabledPid || !isProcessAlive(enabledPid)) {
      fail(`race-iter${i}-pid-alive`, `iter ${i}: daemon PID not alive after enable`);
      raceFailed = true;
      break;
    }
    if (lastSpawnedPid && enabledPid === lastSpawnedPid) {
      fail(`race-iter${i}-pid-changed`, `iter ${i}: PID didn't change (${lastSpawnedPid}) — restart didn't happen`);
      raceFailed = true;
      break;
    }
    lastSpawnedPid = enabledPid;

    info(`race iteration ${i}/3 — disable`);
    const rd = spawnSync("node", [DIST_CLI, "capture", "proxy", "disable"], {
      env,
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (rd.status !== 0) {
      fail(`race-iter${i}-disable-exit`, `disable exited ${rd.status}`);
      raceFailed = true;
      break;
    }
    const released = await waitForPortState(PROXY_PORT, false, 5000);
    if (!released) {
      fail(`race-iter${i}-port-release`, `iter ${i}: port ${PROXY_PORT} not released`);
      raceFailed = true;
      break;
    }
    const disabledPid = existsSync(pidPath) ? Number.parseInt(readFileSync(pidPath, "utf-8").trim(), 10) : null;
    if (disabledPid && lastSpawnedPid && disabledPid === lastSpawnedPid) {
      fail(`race-iter${i}-restart-disable`, `iter ${i}: disable PID didn't change`);
      raceFailed = true;
      break;
    }
    if (disabledPid) lastSpawnedPid = disabledPid;
  }
  if (!raceFailed) {
    ok("race-guard-3x", "3× rapid enable/disable completed: no EADDRINUSE, all PIDs transitioned");
  }

  // ── STAGE 6: final cleanup verification ─────────────────────────────
  header("STAGE 6 · final cleanup verification");

  // Best-effort: ensure proxy is OFF at end of test.
  if (existsSync(configPath)) {
    spawnSync("node", [DIST_CLI, "capture", "proxy", "disable"], { env, timeout: 15_000 });
  }
  const finalReleased = await waitForPortState(PROXY_PORT, false, 3000);
  if (finalReleased) {
    ok("final-port-free", `port ${PROXY_PORT} is free at end of test`);
  } else {
    fail("final-port-free", `port ${PROXY_PORT} still listening at end of test`);
  }

  // ── Summary ──────────────────────────────────────────────────────────
  log("");
  log("────────────────────────────────────────────────────────────────────");
  log("Layer 9 lifecycle E2E summary:");
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    log(`  ${icon} ${r.id}: ${r.detail}`);
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  log("────────────────────────────────────────────────────────────────────");
  log(`${passed}/${results.length} stages passed`);

  if (results.some((r) => r.status === "FAIL")) {
    log("\n❌ LAYER 9 LIFECYCLE E2E FAILED. Proxy enable/disable/restart has a bug.");
    exitCode = 1;
  } else {
    log("\n✅ Layer 9 lifecycle proven end-to-end including 3× race guard.");
    exitCode = 0;
  }
} catch (err) {
  log(`\n💥 FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  if (exitCode === 0) exitCode = 2;
} finally {
  // Kill any daemon we spawned. Read PID from file; if file is gone, try
  // last known PID.
  try {
    let pid = null;
    if (existsSync(pidPath)) {
      pid = Number.parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    }
    pid = pid && Number.isFinite(pid) ? pid : lastSpawnedPid;
    if (pid && isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      const exited = await waitForProcessExit(pid, 3000);
      if (!exited) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* cleanup is best-effort */
  }
  try {
    rmSync(tmpSynapseHome, { recursive: true, force: true });
  } catch {
    /* swallow */
  }
}

process.exit(exitCode);
