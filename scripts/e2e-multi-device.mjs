#!/usr/bin/env node
// scripts/e2e-multi-device.mjs
//
// THE STANDARD MULTI-DEVICE PROPAGATION TEST.
//
// Simulates two devices using the SAME user account on the SAME git repo
// (same remote URL) but with DIFFERENT SYNAPSE_HOME directories — which is
// the real device boundary in Synapse's data model (each device has its
// own project-map cache + events.jsonl inbox; backend is the shared state).
//
// Bidirectional flow:
//   A → B: Device A captures, daemon syncs, handoff lands on backend.
//          Device B (cold project-map) fires SessionStart → Tier 2 routing
//          via git_remote_url → fetches Device A's handoff → brief contains
//          Device A's facts. (cross-device READ proven)
//   B → A: Device B captures via a SEPARATE daemon (its own SYNAPSE_HOME),
//          waits for the second handoff to land on backend, then Device A
//          re-fires SessionStart → brief now contains Device B's facts.
//          (cross-device WRITE-BACK proven)
//
// What this catches that single-device E2E does NOT:
//   - Tier 2 (git_remote_url) routing breakage on cold project-map
//   - Cloud-handoff backfill not reading from cloud
//   - Per-device daemon state colliding (project-map under wrong key,
//     dual-key realpath vs raw issues, etc.)
//   - Conversation reconciliation when two devices write to one project
//
// Usage:
//   npm run test:e2e:multi-device
//   node scripts/e2e-multi-device.mjs
//
// Requires:
//   - claude (Claude Code CLI) on PATH
//   - SYNAPSE_API_KEY resolvable from ~/.synapse/config.json or env
//   - Network access to api.synapsesync.app
//   - The host synapsesync daemon running (for Device A; Device B daemon
//     is spawned by this test under its own SYNAPSE_HOME)
//
// Cost per run: ~$0.05-0.10 in Anthropic tokens (2 claude -p captures +
// 2 background recomputes via claude-haiku).
//
// Exit codes:
//   0 — all stages passed
//   1 — one or more stages failed
//   2 — preflight error

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeLocalProjectState, removeLocalProjectsByBasename, sweepArtifacts } from "./e2e-cleanup.mjs";

// ── Configuration ────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";

// Unique unguessable facts per device — if a model can produce these from
// cold (without reading the brief), the test is meaningless.
const RUN_ID = Date.now();
const A_TEST_ID = `MULTI-DEV-A-${RUN_ID}`;
const A_TEST_PHRASE = "salamander river nine";
const B_TEST_ID = `MULTI-DEV-B-${RUN_ID}`;
const B_TEST_PHRASE = "ocelot canyon four";

// Mirror real-world `git clone <url>` behavior: the folder basename matches
// the URL basename. Without this match, the backend's resolver can't find
// the project on a cold Device B (Tier 1 name-match misses; Tier 3 origin
// match misses too because events-batch doesn't populate working_context).
const PROJECT_BASENAME = `multi-device-${RUN_ID}`;
const SHARED_REMOTE = `https://github.com/synapse-e2e/${PROJECT_BASENAME}.git`;

const SLEEP_DAEMON_SYNC_MS = 15_000;
const SLEEP_RECOMPUTE_MAX_MS = 90_000;
const HOOK_FAST_TIMEOUT_MS = 10_000;
const DAEMON_BOOT_WAIT_MS = 4_000;

// ── State ────────────────────────────────────────────────────────────────
const results = [];
let apiKey = null;
let deviceADir = null;
let deviceBSynapseHome = null;
let deviceBCwd = null;
let deviceBDaemonProc = null;
let testProjectId = null;
let aConvId = null;
let bConvId = null;

// ── Helpers ──────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(`${msg}\n`);
}
function header(s) {
  log("\n════════════════════════════════════════════════════════════════════");
  log(s);
  log("════════════════════════════════════════════════════════════════════");
}
function ok(stage, detail) {
  results.push({ id: stage, status: "PASS", detail });
  log(`  ✅ PASS · ${detail}`);
}
function fail(stage, detail) {
  results.push({ id: stage, status: "FAIL", detail });
  log(`  ❌ FAIL · ${detail}`);
}
function info(detail) {
  log(`  · ${detail}`);
}

// Retry transient network failures (IPv6 socket resets, connect timeouts).
// These flake the test without indicating a real logic bug — and the daemon
// itself has the same vulnerability (a real product issue tracked separately).
async function fetchJson(pathname, init = {}) {
  const MAX_TRIES = 4;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${pathname}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        return { _status: res.status, _err: await res.text() };
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_TRIES) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  return { _status: 0, _err: `network: ${lastErr?.message ?? lastErr}` };
}

function fireHook(name, payload, envOverride = {}) {
  const start = Date.now();
  const out = spawnSync(process.execPath, [MCP_DIST, "hook", name], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, ...envOverride },
  });
  return { elapsed: Date.now() - start, stdout: out.stdout ?? "", stderr: out.stderr ?? "", code: out.status };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(check, timeoutMs, intervalMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
}

function getApiKey() {
  if (process.env.SYNAPSE_API_KEY && process.env.SYNAPSE_API_KEY !== "undefined") {
    return process.env.SYNAPSE_API_KEY;
  }
  const configPath = path.join(process.env.HOME ?? "/", ".synapse", "config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      if (cfg.api_key) return cfg.api_key;
    } catch {}
  }
  return null;
}

function gitInit(dir, remote) {
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "e2e-md@synapse.test"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "e2e-md"], { cwd: dir });
  spawnSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  writeFileSync(path.join(dir, "README.md"), "# e2e multi-device\n");
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
}

// ── Cleanup ─────────────────────────────────────────────────────────────
async function cleanup() {
  // Dump the Device B daemon log BEFORE killing the daemon — it's the only
  // record of what the secondary daemon actually did during the test.
  if (deviceBSynapseHome) {
    for (const logName of ["daemon.log", "pull-compact-bg.log"]) {
      const dlog = path.join(deviceBSynapseHome, logName);
      if (existsSync(dlog)) {
        try {
          const content = readFileSync(dlog, "utf-8");
          if (content.length > 0) {
            log(`  · Device B ${logName} (${content.length} bytes, last 2000 chars):`);
            log(`    ${content.slice(-2000).replace(/\n/g, "\n    ")}`);
          } else {
            log(`  · Device B ${logName} is empty`);
          }
        } catch (e) {
          log(`  · WARN failed to read ${logName}: ${e.message}`);
        }
      } else {
        log(`  · Device B ${logName} does not exist`);
      }
    }
  }

  if (deviceBDaemonProc) {
    try {
      deviceBDaemonProc.kill("SIGTERM");
      log(`  · cleanup: sent SIGTERM to Device B daemon (pid ${deviceBDaemonProc.pid})`);
    } catch (e) {
      log(`  · cleanup: WARN failed to kill Device B daemon: ${e.message}`);
    }
    deviceBDaemonProc = null;
  }

  // Also nuke any cwd_<hash> placeholder dirs (both daemons may have created
  // them pre-canonical UUID resolution).
  removeLocalProjectsByBasename(PROJECT_BASENAME, { log });
  // Belt-and-suspenders sweep: device-B daemon may have created auxiliary
  // projects via auto-route; the named testProjectId may not be the only one.
  await sweepArtifacts({
    apiKey,
    apiUrl: API_BASE,
    patterns: [`-${RUN_ID}`],
    log,
  });

  if (testProjectId) {
    const res = await fetch(`${API_BASE}/api/projects/${testProjectId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) log(`  · cleanup: deleted test project ${testProjectId}`);
    else log(`  · cleanup: WARN failed to delete project (HTTP ${res.status})`);
    removeLocalProjectState(testProjectId, { log });
  }

  for (const d of [deviceADir, deviceBCwd, deviceBSynapseHome]) {
    if (d && existsSync(d)) {
      try {
        rmSync(d, { recursive: true, force: true });
        log(`  · cleanup: removed ${d}`);
      } catch (e) {
        log(`  · cleanup: WARN failed to rm ${d}: ${e.message}`);
      }
    }
  }
}

// ── Preflight ───────────────────────────────────────────────────────────
function preflight() {
  header("PREFLIGHT");

  if (!existsSync(MCP_DIST)) {
    fail("preflight", "MCP dist not built. Run: cd mcp && npm run build");
    return false;
  }
  info(`MCP dist at ${MCP_DIST}`);

  apiKey = getApiKey();
  if (!apiKey) {
    fail("preflight", "No SYNAPSE_API_KEY in env or ~/.synapse/config.json");
    return false;
  }
  info(`API key resolved (${apiKey.slice(0, 12)}...)`);

  const claude = spawnSync("which", ["claude"], { encoding: "utf-8" });
  if (claude.status !== 0) {
    fail("preflight", "claude CLI not on PATH");
    return false;
  }
  info(`claude at ${claude.stdout.trim()}`);
  ok("preflight", "all prereqs satisfied");
  return true;
}

// ── MD1: Device A setup ──────────────────────────────────────────────────
async function md1_device_a_setup() {
  header("MD1 · Device A setup (host SYNAPSE_HOME, fresh cwd)");

  // Folder basename = URL basename so the project name on backend (derived
  // from folder basename by getGitBasename) matches what the resolver sends
  // from a cold Device B (URL basename).
  deviceADir = path.join(tmpdir(), `synapse-md-A-${RUN_ID}`, PROJECT_BASENAME);
  mkdirSync(deviceADir, { recursive: true });
  gitInit(deviceADir, SHARED_REMOTE);

  info(`Device A cwd = ${deviceADir}`);
  info(`shared git remote = ${SHARED_REMOTE}`);
  ok("MD1 device A setup", "Device A git repo initialized with shared remote URL");
}

// ── MD2: Device A captures ───────────────────────────────────────────────
async function md2_device_a_captures() {
  header("MD2 · Device A claude -p captures session");

  const prompt = `E2E multi-device test, Device A side. Remember: (a) test_id is ${A_TEST_ID}, (b) secret_phrase is '${A_TEST_PHRASE}'. Reply 'noted' only.`;
  info("Running claude -p in Device A cwd...");
  const start = Date.now();
  const cp = spawnSync("claude", ["-p", prompt], { cwd: deviceADir, encoding: "utf-8", timeout: 120_000 });
  const elapsed = Date.now() - start;

  if (cp.status !== 0) {
    fail("MD2 device A capture", `claude exit ${cp.status}: ${(cp.stderr ?? "").slice(0, 200)}`);
    return;
  }
  ok("MD2 device A capture", `claude -p responded in ${elapsed}ms`);
}

// ── MD3: Daemon syncs Device A's session to backend ──────────────────────
async function md3_a_syncs() {
  header("MD3 · Host daemon syncs Device A's session to backend");

  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for daemon sync...`);
  await sleep(SLEEP_DAEMON_SYNC_MS);

  const testBasename = path.basename(deviceADir);
  const projects = await fetchJson("/api/projects");
  if (!Array.isArray(projects)) {
    fail("MD3 backend project", `/api/projects returned non-array: ${JSON.stringify(projects).slice(0, 200)}`);
    return;
  }
  let match = projects.find((p) => p.name === testBasename);

  if (!match) {
    try {
      writeFileSync(path.join(process.env.HOME ?? "/", ".synapse", "daemon-flush-now"), "");
    } catch {}
    await sleep(5000);
    const retry = await fetchJson("/api/projects");
    match = Array.isArray(retry) ? retry.find((p) => p.name === testBasename) : null;
  }

  if (!match) {
    fail("MD3 backend project", `project ${testBasename} not found after sync wait`);
    return;
  }
  testProjectId = match.id;
  ok("MD3 backend project", `created: ${match.id}`);

  const list = await fetchJson(`/api/conversations?project_id=${testProjectId}&limit=5`);
  const convs = list.conversations ?? [];
  if (convs.length === 0) {
    fail("MD3 conversation A", "no conversations in project");
    return;
  }
  aConvId = convs[0].id;
  ok("MD3 conversation A", `synced: ${aConvId}`);
}

// ── MD3.5: Re-fire Device A SessionStart to trigger fast-mode bg recompute ─
//
// claude -p doesn't auto-compact, and SessionEnd doesn't trigger handoff
// generation. The handoff_markdown is only posted when fast-mode pullHandoff
// spawns a background recompute. Firing SessionStart again on Device A's
// cwd (now with the project cached on backend) triggers that path.
async function md3_5_trigger_recompute_a() {
  header("MD3.5 · Re-fire Device A SessionStart to trigger bg recompute");

  const { elapsed, code } = fireHook("session-start", {
    session_id: "e2e-md-A-rehit-for-recompute",
    cwd: deviceADir,
    source: "startup",
    hook_event_name: "SessionStart",
  });

  if (code !== 0) {
    fail("MD3.5 re-fire", `hook exited ${code}`);
    return;
  }
  ok("MD3.5 re-fire", `${elapsed}ms — background recompute spawned`);
}

// ── MD4: Device A handoff lands ──────────────────────────────────────────
async function md4_a_handoff_lands() {
  header("MD4 · Device A handoff_markdown lands on backend");

  info(`Polling /api/conversations/${aConvId} for handoff (max ${SLEEP_RECOMPUTE_MAX_MS / 1000}s)...`);
  const handoff = await waitFor(
    async () => {
      const full = await fetchJson(`/api/conversations/${aConvId}`);
      const meta = full.conversation?.metadata ?? full.metadata ?? {};
      return meta.handoff_markdown && meta.handoff_markdown.length > 0 ? meta.handoff_markdown : null;
    },
    SLEEP_RECOMPUTE_MAX_MS,
    3000,
  );

  if (!handoff) {
    fail("MD4 handoff A posted", `no handoff_markdown after ${SLEEP_RECOMPUTE_MAX_MS / 1000}s`);
    return;
  }
  ok("MD4 handoff A posted", `${handoff.length} bytes`);

  const hasId = handoff.includes(A_TEST_ID);
  const hasPhrase = handoff.includes(A_TEST_PHRASE);
  if (hasId && hasPhrase) {
    ok("MD4 handoff A content", "captures A_TEST_ID + A_TEST_PHRASE");
  } else {
    fail("MD4 handoff A content", `phrases missing — A_TEST_ID=${hasId} A_TEST_PHRASE=${hasPhrase}`);
  }
}

// ── MD5: Device B setup (different SYNAPSE_HOME + cwd, SAME remote) ─────
async function md5_device_b_setup() {
  header("MD5 · Device B setup (cold project-map, same remote)");

  // Different SYNAPSE_HOME — fresh project-map.json. Seed with the same
  // API key so Device B is the same *user* on a different *device*.
  deviceBSynapseHome = path.join(tmpdir(), `synapse-md-B-home-${RUN_ID}`);
  mkdirSync(deviceBSynapseHome, { recursive: true });
  writeFileSync(path.join(deviceBSynapseHome, "config.json"), JSON.stringify({ api_key: apiKey }, null, 2));
  info(`Device B SYNAPSE_HOME = ${deviceBSynapseHome}`);

  // Different filesystem path — but SAME git remote URL, the routing key.
  // Device B path is DIFFERENT (different parent dir) but basename matches
  // — exactly what a second `git clone <url>` on a different machine produces.
  deviceBCwd = path.join(tmpdir(), `synapse-md-B-cwd-${RUN_ID}`, PROJECT_BASENAME);
  mkdirSync(deviceBCwd, { recursive: true });
  gitInit(deviceBCwd, SHARED_REMOTE);
  info(`Device B cwd = ${deviceBCwd}`);
  info("Device B project-map.json = (does not exist yet — Tier 2 lookup territory)");
  ok("MD5 device B setup", "fresh SYNAPSE_HOME + new cwd with shared remote URL");
}

// ── MD6: Device B SessionStart hook fires ────────────────────────────────
async function md6_device_b_hook_fires() {
  header("MD6 · Device B SessionStart hook fires");

  const { elapsed, stdout, stderr, code } = fireHook(
    "session-start",
    {
      session_id: "e2e-md-B",
      cwd: deviceBCwd,
      source: "startup",
      hook_event_name: "SessionStart",
    },
    { SYNAPSE_HOME: deviceBSynapseHome },
  );

  if (code !== 0) {
    fail("MD6 hook exit", `hook exited ${code}; stderr=${(stderr ?? "").slice(0, 200)}`);
    return;
  }

  if (elapsed > HOOK_FAST_TIMEOUT_MS) {
    fail("MD6 hook timing", `hook took ${elapsed}ms — exceeds ${HOOK_FAST_TIMEOUT_MS}ms budget`);
  } else {
    ok("MD6 hook timing", `${elapsed}ms`);
  }

  if (!stdout.includes("<synapse-brief>")) {
    fail("MD6 brief shape", `no <synapse-brief> tag; stdout head: ${stdout.slice(0, 200)}`);
    return;
  }
  ok("MD6 brief shape", `<synapse-brief> tag present (${stdout.length} bytes)`);

  // Stash stdout on results for the next stage's assertion
  results._md6_brief = stdout;
}

// ── MD7: Cross-device READ assertion (THE TEST) ──────────────────────────
async function md7_b_sees_a() {
  header("MD7 · Device B brief contains Device A's facts (cross-device READ — THE TEST)");

  const brief = results._md6_brief ?? "";
  if (!brief) {
    fail("MD7 cross-device READ", "no brief captured from MD6");
    return;
  }

  const hasA_Id = brief.includes(A_TEST_ID);
  const hasA_Phrase = brief.includes(A_TEST_PHRASE);
  if (hasA_Id && hasA_Phrase) {
    ok("MD7 cross-device READ", "Device B's brief contains BOTH A_TEST_ID and A_TEST_PHRASE");
  } else {
    fail(
      "MD7 cross-device READ",
      `Device B did NOT see Device A's facts — A_TEST_ID=${hasA_Id} A_TEST_PHRASE=${hasA_Phrase}`,
    );
    info(`brief preview (last 600 chars):\n  ${brief.slice(-600).replace(/\n/g, "\n  ")}`);
  }
}

// ── MD8: Start Device B daemon ───────────────────────────────────────────
async function md8_start_b_daemon() {
  header("MD8 · Start Device B daemon (separate SYNAPSE_HOME)");

  const logPath = path.join(deviceBSynapseHome, "daemon.log");
  const logStream = createWriteStream(logPath, { flags: "a" });

  deviceBDaemonProc = spawn(process.execPath, [MCP_DIST, "daemon"], {
    env: { ...process.env, SYNAPSE_HOME: deviceBSynapseHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  deviceBDaemonProc.stdout.pipe(logStream);
  deviceBDaemonProc.stderr.pipe(logStream);

  // Surface unexpected death — the daemon should outlive this test.
  deviceBDaemonProc.on("exit", (code, signal) => {
    if (signal === "SIGTERM") return; // expected
    log(`  ⚠️  Device B daemon exited unexpectedly: code=${code} signal=${signal}`);
  });

  info(`Device B daemon pid = ${deviceBDaemonProc.pid}, logs → ${logPath}`);
  info(`Waiting ${DAEMON_BOOT_WAIT_MS / 1000}s for boot...`);
  await sleep(DAEMON_BOOT_WAIT_MS);

  if (deviceBDaemonProc.killed || deviceBDaemonProc.exitCode !== null) {
    fail("MD8 daemon boot", `daemon died during boot — exitCode=${deviceBDaemonProc.exitCode}. See ${logPath}`);
    return;
  }
  ok("MD8 daemon boot", `Device B daemon running (pid ${deviceBDaemonProc.pid})`);
}

// ── MD9: Device B claude -p captures ─────────────────────────────────────
async function md9_device_b_captures() {
  header("MD9 · Device B claude -p captures session");

  const prompt = `E2E multi-device test, Device B side. Remember: (a) test_id is ${B_TEST_ID}, (b) secret_phrase is '${B_TEST_PHRASE}'. Reply 'noted' only.`;
  info("Running claude -p in Device B cwd with SYNAPSE_HOME override...");
  const start = Date.now();
  const cp = spawnSync("claude", ["-p", prompt], {
    cwd: deviceBCwd,
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env, SYNAPSE_HOME: deviceBSynapseHome },
  });
  const elapsed = Date.now() - start;

  if (cp.status !== 0) {
    fail("MD9 device B capture", `claude exit ${cp.status}: ${(cp.stderr ?? "").slice(0, 200)}`);
    return;
  }
  ok("MD9 device B capture", `claude -p responded in ${elapsed}ms`);
}

// ── MD9.5: Re-fire Device B SessionStart to trigger bg recompute ────────
async function md9_5_trigger_recompute_b() {
  header("MD9.5 · Re-fire Device B SessionStart to trigger bg recompute");

  // First let the daemon sync the just-captured events
  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for Device B daemon to sync events...`);
  await sleep(SLEEP_DAEMON_SYNC_MS);

  const { elapsed, code } = fireHook(
    "session-start",
    {
      session_id: "e2e-md-B-rehit-for-recompute",
      cwd: deviceBCwd,
      source: "startup",
      hook_event_name: "SessionStart",
    },
    { SYNAPSE_HOME: deviceBSynapseHome },
  );

  if (code !== 0) {
    fail("MD9.5 re-fire", `hook exited ${code}`);
    return;
  }
  ok("MD9.5 re-fire", `${elapsed}ms — background recompute spawned for Device B`);
}

// ── MD10: Device B handoff lands ─────────────────────────────────────────
async function md10_b_handoff_lands() {
  header("MD10 · Device B handoff lands on backend (separate conversation)");

  // Find Device B's conversation — it should be a NEW conv under the same project.
  const list = await fetchJson(`/api/conversations?project_id=${testProjectId}&limit=10`);
  const convs = list.conversations ?? [];
  // Device B's conv is whichever is NOT aConvId
  const bConv = convs.find((c) => c.id !== aConvId);
  if (!bConv) {
    fail("MD10 conv B exists", `no Device B conversation — convs found: ${convs.map((c) => c.id).join(", ")}`);
    return;
  }
  bConvId = bConv.id;
  ok("MD10 conv B exists", `Device B conv ${bConvId} synced to backend by Device B daemon`);

  // Diagnostic: log Device B's conv working_context — bg recompute needs
  // working_context.capturedSessionId to find the local session.
  const bFull = await fetchJson(`/api/conversations/${bConvId}`);
  const bWc = bFull.conversation?.working_context ?? bFull.working_context ?? null;
  info(`Conv B working_context = ${JSON.stringify(bWc)}`);

  info(`Polling Device B handoff (max ${SLEEP_RECOMPUTE_MAX_MS / 1000}s)...`);
  const handoff = await waitFor(
    async () => {
      const full = await fetchJson(`/api/conversations/${bConvId}`);
      const meta = full.conversation?.metadata ?? full.metadata ?? {};
      return meta.handoff_markdown && meta.handoff_markdown.length > 0 ? meta.handoff_markdown : null;
    },
    SLEEP_RECOMPUTE_MAX_MS,
    3000,
  );

  if (!handoff) {
    fail("MD10 handoff B posted", "no Device B handoff_markdown after wait");
    return;
  }
  ok("MD10 handoff B posted", `${handoff.length} bytes`);

  const hasId = handoff.includes(B_TEST_ID);
  const hasPhrase = handoff.includes(B_TEST_PHRASE);
  if (hasId && hasPhrase) {
    ok("MD10 handoff B content", "captures B_TEST_ID + B_TEST_PHRASE");
  } else {
    fail("MD10 handoff B content", `phrases missing — B_TEST_ID=${hasId} B_TEST_PHRASE=${hasPhrase}`);
  }
}

// ── MD11: Cross-device WRITE-BACK assertion ──────────────────────────────
async function md11_a_sees_b() {
  header("MD11 · Device A SessionStart re-fires, brief contains Device B's facts (WRITE-BACK)");

  const { elapsed, stdout, code } = fireHook(
    "session-start",
    {
      session_id: "e2e-md-A-rehit",
      cwd: deviceADir,
      source: "startup",
      hook_event_name: "SessionStart",
    },
    // NO SYNAPSE_HOME override — uses host's, just like Device A normally would
  );

  if (code !== 0) {
    fail("MD11 hook exit", `re-fire exited ${code}`);
    return;
  }
  info(`hook re-fired in ${elapsed}ms (${stdout.length} bytes)`);

  const hasB_Id = stdout.includes(B_TEST_ID);
  const hasB_Phrase = stdout.includes(B_TEST_PHRASE);
  if (hasB_Id && hasB_Phrase) {
    ok("MD11 cross-device WRITE-BACK", "Device A now sees BOTH B_TEST_ID and B_TEST_PHRASE in its brief");
  } else {
    fail(
      "MD11 cross-device WRITE-BACK",
      `Device A did NOT see Device B's facts — B_TEST_ID=${hasB_Id} B_TEST_PHRASE=${hasB_Phrase}`,
    );
    info(`brief preview (last 600 chars):\n  ${stdout.slice(-600).replace(/\n/g, "\n  ")}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  log("Synapse end-to-end MULTI-DEVICE bidirectional propagation test");
  log(`API: ${API_BASE}`);
  log(`MCP: ${MCP_DIST}`);
  log(`RUN_ID: ${RUN_ID}`);

  if (!preflight()) process.exit(2);

  try {
    await md1_device_a_setup();
    await md2_device_a_captures();
    await md3_a_syncs();
    if (!testProjectId || !aConvId) {
      log("\n⚠️  Skipping remaining stages — Device A did not sync properly.");
    } else {
      await md3_5_trigger_recompute_a();
      await md4_a_handoff_lands();
      await md5_device_b_setup();
      await md6_device_b_hook_fires();
      await md7_b_sees_a();
      await md8_start_b_daemon();
      if (deviceBDaemonProc && !deviceBDaemonProc.killed) {
        await md9_device_b_captures();
        await md9_5_trigger_recompute_b();
        await md10_b_handoff_lands();
        if (bConvId) {
          await md11_a_sees_b();
        }
      }
    }
  } catch (err) {
    log(`\n🚨 UNEXPECTED ERROR: ${err.message}\n${err.stack}`);
    results.push({ id: "uncaught", status: "FAIL", detail: err.message });
  } finally {
    header("CLEANUP");
    await cleanup();
  }

  header("SUMMARY");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    log(`  ${icon} ${r.id.padEnd(40)} ${r.detail}`);
  }
  log("");
  log(`  Total: ${results.length}  ·  PASS: ${passed}  ·  FAIL: ${failed}`);
  log("");
  if (failed > 0) {
    log("❌ E2E MULTI-DEVICE FAILED. Do not merge until all stages pass.");
    process.exit(1);
  } else {
    log("✅ E2E MULTI-DEVICE PASSED.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
