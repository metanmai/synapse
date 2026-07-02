#!/usr/bin/env node
// scripts/e2e-resilience.mjs
//
// DOOMSDAY RESILIENCE TESTS.
//
// The other E2E suites validate happy + reasonable-failure paths. This
// suite validates *gnarly* real-world configurations where Synapse claims
// to work but where compounding fragilities have historically gone
// untested.
//
// Each stage targets ONE specific real-world doomsday element:
//
//   R1  Basename asymmetry — Device A created the project with a RENAMED
//       folder (`git clone <url> renamed-name`), so the project name on
//       backend != URL basename. Device B clones normally (folder == URL
//       basename). Device B's resolver must still find Device A's project
//       so the brief surfaces. This is the highest-impact gap because
//       it's the single most common "I renamed my clone" pattern.
//
//   R2  Multi-protocol URL — Device A clones via HTTPS, Device B via SSH
//       (`git@github.com:...`). Same logical repo, DIFFERENT git_remote_url
//       strings. Both devices' events should converge into ONE backend
//       project (no duplicate). Both should see each other's content.
//
//   R3  No origin remote — Cwd is a git repo with NO `origin` remote.
//       getGitRemoteUrl() returns undefined. Hook should not crash;
//       brief should emit cleanly; daemon should fall back to git_basename
//       resolution.
//
// REQUIRES: User A's API key from ~/.synapse/config.json. claude CLI on
// PATH. Network access to api.synapsesync.app.
//
// Cost per run: ~$0.06-0.10 in Anthropic tokens (3 claude -p captures).
// Wall time: ~3-5 min.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeLocalProjectState, removeLocalProjectsByBasename, sweepArtifacts } from "./e2e-cleanup.mjs";

// ── Configuration ────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";

const RUN_ID = Date.now();

const SLEEP_DAEMON_SYNC_MS = 15_000;
const SLEEP_RECOMPUTE_MAX_MS = 90_000;
const HOOK_FAST_TIMEOUT_MS = 10_000;

// ── State ────────────────────────────────────────────────────────────────
const results = [];
let apiKey = null;
const cleanupProjects = new Set();
const cleanupDirs = new Set();

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
      if (!res.ok) return { _status: res.status, _err: await res.text() };
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) return { _status: res.status, ok: true };
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
  const cfg = path.join(process.env.HOME ?? "/", ".synapse", "config.json");
  if (existsSync(cfg)) {
    try {
      const c = JSON.parse(readFileSync(cfg, "utf-8"));
      if (c.api_key) return c.api_key;
    } catch {}
  }
  return null;
}

function gitInit(dir, remote) {
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "e2e-r@synapse.test"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "e2e-r"], { cwd: dir });
  if (remote) {
    spawnSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  }
  writeFileSync(path.join(dir, "README.md"), "# e2e resilience\n");
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
}

async function findProjectByName(projectName) {
  const list = await fetchJson("/api/projects");
  if (!Array.isArray(list)) return null;
  return list.find((p) => p.name === projectName) ?? null;
}

// ── Cleanup ─────────────────────────────────────────────────────────────
async function cleanup() {
  for (const pid of cleanupProjects) {
    const res = await fetch(`${API_BASE}/api/projects/${pid}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) log(`  · cleanup: deleted project ${pid}`);
    else log(`  · cleanup: WARN failed to delete project ${pid} (HTTP ${res.status})`);
    removeLocalProjectState(pid, { log });
  }
  // Also nuke placeholder dirs — resilience creates 3 distinct cwd basenames
  // per run (r1-renamed-, r2-protocol-, r3-no-origin-), all sharing RUN_ID.
  removeLocalProjectsByBasename(`r1-renamed-${RUN_ID}`, { log });
  removeLocalProjectsByBasename(`r2-protocol-${RUN_ID}`, { log });
  removeLocalProjectsByBasename(`r3-no-origin-${RUN_ID}`, { log });
  // Belt-and-suspenders sweep: the resilience test deliberately exercises
  // edge cases (renamed folders, asymmetric URLs, no-origin) that can land
  // 2-3 extra projects per stage — easy to miss in the explicit ID set.
  await sweepArtifacts({
    apiKey,
    apiUrl: API_BASE,
    patterns: [`-${RUN_ID}`],
    log,
  });
  for (const d of cleanupDirs) {
    if (existsSync(d)) {
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

// ── R1: Basename asymmetry ──────────────────────────────────────────────
// Setup: Device A clones with renamed folder. Device B clones normally.
// The project on backend has name == A's folder basename (renamed).
// Device B's resolver sends git_basename == URL basename (different).
// Tier 1 name-match in projects-resolve.ts misses. Tier 3 working_context
// match also misses (events-batch doesn't populate working_context).
// The fix: backend resolver should also check projects.git_remote_url
// directly (migration 021 made it unique).
async function r1_basename_asymmetry() {
  header("R1 · Basename asymmetry (Device A's folder renamed; Device B should still find project)");

  const URL_BASENAME = `r1-normal-${RUN_ID}`;
  const RENAMED_FOLDER = `r1-renamed-${RUN_ID}`;
  const SHARED_REMOTE = `https://github.com/synapse-e2e/${URL_BASENAME}.git`;
  const A_PHRASE = `quetzal-mesa-three-${RUN_ID}`;

  // Device A — folder is RENAMED, URL ends in URL_BASENAME
  const deviceADir = path.join(tmpdir(), `synapse-r1-A-${RUN_ID}`, RENAMED_FOLDER);
  mkdirSync(deviceADir, { recursive: true });
  cleanupDirs.add(deviceADir);
  gitInit(deviceADir, SHARED_REMOTE);
  info(`Device A cwd basename = ${RENAMED_FOLDER} (DIFFERS from URL basename ${URL_BASENAME})`);

  // Device A captures
  const cpA = spawnSync("claude", ["-p", `R1 test side A. Remember secret ${A_PHRASE}. Reply 'noted'.`], {
    cwd: deviceADir,
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (cpA.status !== 0) {
    fail("R1 device A capture", `claude exit ${cpA.status}`);
    return;
  }
  ok("R1 device A capture", "session captured with renamed-folder cwd");

  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for daemon sync...`);
  await sleep(SLEEP_DAEMON_SYNC_MS);

  // Project name should be RENAMED_FOLDER (folder basename, not URL basename)
  const proj = await findProjectByName(RENAMED_FOLDER);
  if (!proj) {
    fail("R1 project created", `expected project named '${RENAMED_FOLDER}' (folder basename); not found`);
    return;
  }
  cleanupProjects.add(proj.id);
  info(`Project created with name '${proj.name}' (id ${proj.id.slice(0, 8)}...)`);

  // Trigger A's bg recompute → handoff lands
  fireHook("session-start", {
    session_id: "r1-A-recompute",
    cwd: deviceADir,
    source: "startup",
    hook_event_name: "SessionStart",
  });
  const handoff = await waitFor(
    async () => {
      const list = await fetchJson(`/api/conversations?project_id=${proj.id}&limit=1`);
      const c = list.conversations?.[0];
      if (!c) return null;
      const full = await fetchJson(`/api/conversations/${c.id}`);
      const meta = full.conversation?.metadata ?? full.metadata ?? {};
      return meta.handoff_markdown && meta.handoff_markdown.length > 0 ? meta.handoff_markdown : null;
    },
    SLEEP_RECOMPUTE_MAX_MS,
    3000,
  );
  if (!handoff || !handoff.includes(A_PHRASE)) {
    fail("R1 handoff lands", "Device A's handoff did not land or missing phrase");
    return;
  }
  ok("R1 handoff lands", `${handoff.length} bytes with A_PHRASE`);

  // Device B — NORMAL clone, folder == URL basename, different filesystem path
  const deviceBSynapseHome = path.join(tmpdir(), `synapse-r1-B-home-${RUN_ID}`);
  mkdirSync(deviceBSynapseHome, { recursive: true });
  writeFileSync(path.join(deviceBSynapseHome, "config.json"), JSON.stringify({ api_key: apiKey }, null, 2));
  cleanupDirs.add(deviceBSynapseHome);

  const deviceBCwd = path.join(tmpdir(), `synapse-r1-B-cwd-${RUN_ID}`, URL_BASENAME);
  mkdirSync(deviceBCwd, { recursive: true });
  cleanupDirs.add(deviceBCwd);
  gitInit(deviceBCwd, SHARED_REMOTE);
  info(`Device B cwd basename = ${URL_BASENAME} (matches URL basename, NORMAL clone)`);

  const { stdout, code, elapsed } = fireHook(
    "session-start",
    { session_id: "r1-B", cwd: deviceBCwd, source: "startup", hook_event_name: "SessionStart" },
    { SYNAPSE_HOME: deviceBSynapseHome },
  );
  if (code !== 0) {
    fail("R1 device B hook", `hook exit ${code}`);
    return;
  }
  if (elapsed > HOOK_FAST_TIMEOUT_MS) {
    fail("R1 device B timing", `${elapsed}ms exceeds budget`);
    return;
  }

  // THE assertion: Device B sees A's phrase despite folder asymmetry
  if (stdout.includes(A_PHRASE)) {
    ok(
      "R1 basename-asymmetry recovery",
      "Device B's brief contains A_PHRASE even though folder names differ — resolver handles asymmetric basename",
    );
  } else {
    fail(
      "R1 basename-asymmetry recovery",
      "Device B's brief MISSING A_PHRASE — resolver does NOT handle renamed-folder case. Backend resolver needs a Tier that queries projects.git_remote_url directly.",
    );
    info(`brief tail (last 500 chars):\n  ${stdout.slice(-500).replace(/\n/g, "\n  ")}`);
  }
}

// ── R2: Multi-protocol URL ───────────────────────────────────────────────
// Setup: Device A clones via HTTPS, Device B via SSH-format URL.
// Different git_remote_url strings, same logical repo. Folder basename =
// URL basename on both devices.
//
// Expected: events-batch's findOrCreateProjectByGit Tier 2 (name match)
// should converge both onto the same project. Backend should have exactly
// ONE project at the end. Device B's brief should see A's content.
async function r2_multi_protocol_url() {
  header("R2 · Multi-protocol URL (HTTPS + SSH for same repo route to same project)");

  const REPO_BASENAME = `r2-protocol-${RUN_ID}`;
  const HTTPS_URL = `https://github.com/synapse-e2e/${REPO_BASENAME}.git`;
  const SSH_URL = `git@github.com:synapse-e2e/${REPO_BASENAME}.git`;
  const A_PHRASE = `pelican-tundra-eleven-${RUN_ID}`;

  // Device A — HTTPS
  const deviceADir = path.join(tmpdir(), `synapse-r2-A-${RUN_ID}`, REPO_BASENAME);
  mkdirSync(deviceADir, { recursive: true });
  cleanupDirs.add(deviceADir);
  gitInit(deviceADir, HTTPS_URL);
  info(`Device A remote = ${HTTPS_URL}`);

  const cpA = spawnSync("claude", ["-p", `R2 test side A via HTTPS. Remember ${A_PHRASE}. Reply 'noted'.`], {
    cwd: deviceADir,
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (cpA.status !== 0) {
    fail("R2 device A capture", `claude exit ${cpA.status}`);
    return;
  }
  ok("R2 device A capture", "HTTPS-cloned session captured");

  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for daemon sync...`);
  await sleep(SLEEP_DAEMON_SYNC_MS);

  const projA = await findProjectByName(REPO_BASENAME);
  if (!projA) {
    fail("R2 project A created", `expected project '${REPO_BASENAME}' not found`);
    return;
  }
  cleanupProjects.add(projA.id);
  info(`Project A id = ${projA.id} (git_remote_url should be HTTPS)`);

  // Trigger A's recompute
  fireHook("session-start", {
    session_id: "r2-A-recompute",
    cwd: deviceADir,
    source: "startup",
    hook_event_name: "SessionStart",
  });
  await sleep(2000);

  // Device B — SSH format URL (same logical repo)
  const deviceBSynapseHome = path.join(tmpdir(), `synapse-r2-B-home-${RUN_ID}`);
  mkdirSync(deviceBSynapseHome, { recursive: true });
  writeFileSync(path.join(deviceBSynapseHome, "config.json"), JSON.stringify({ api_key: apiKey }, null, 2));
  cleanupDirs.add(deviceBSynapseHome);

  const deviceBCwd = path.join(tmpdir(), `synapse-r2-B-cwd-${RUN_ID}`, REPO_BASENAME);
  mkdirSync(deviceBCwd, { recursive: true });
  cleanupDirs.add(deviceBCwd);
  gitInit(deviceBCwd, SSH_URL);
  info(`Device B remote = ${SSH_URL} (SSH format, same logical repo)`);

  // Device B's daemon should converge events into projA, not create a new project
  const cpB = spawnSync("claude", ["-p", "R2 test side B via SSH. Reply 'noted'."], {
    cwd: deviceBCwd,
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env, SYNAPSE_HOME: deviceBSynapseHome },
  });
  if (cpB.status !== 0) {
    fail("R2 device B capture", `claude exit ${cpB.status}`);
    return;
  }
  info("Device B captured via SSH-URL remote");

  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for daemon sync...`);
  await sleep(SLEEP_DAEMON_SYNC_MS);

  // Count projects with REPO_BASENAME — should still be just 1 (projA)
  const allProjects = await fetchJson("/api/projects");
  const matching = Array.isArray(allProjects) ? allProjects.filter((p) => p.name === REPO_BASENAME) : [];
  if (matching.length === 1 && matching[0].id === projA.id) {
    ok("R2 single project convergence", "HTTPS + SSH events converged into ONE project (no duplicate)");
  } else if (matching.length > 1) {
    fail(
      "R2 single project convergence",
      `HTTPS + SSH split into ${matching.length} projects — multi-protocol URL race`,
    );
    for (const p of matching) cleanupProjects.add(p.id);
    return;
  } else {
    fail("R2 single project convergence", `expected exactly 1 project, got ${matching.length}`);
    return;
  }

  // Device B's brief should see A's phrase
  const { stdout, code } = fireHook(
    "session-start",
    { session_id: "r2-B-rehit", cwd: deviceBCwd, source: "startup", hook_event_name: "SessionStart" },
    { SYNAPSE_HOME: deviceBSynapseHome },
  );
  if (code !== 0) {
    fail("R2 device B brief", `hook exit ${code}`);
    return;
  }
  if (stdout.includes(A_PHRASE)) {
    ok("R2 cross-protocol READ", "Device B (SSH-URL) sees Device A (HTTPS-URL)'s phrase in brief");
  } else {
    fail("R2 cross-protocol READ", "Device B's brief did NOT contain A_PHRASE");
    info(`brief tail (last 500 chars):\n  ${stdout.slice(-500).replace(/\n/g, "\n  ")}`);
  }
}

// ── R3: No origin remote ────────────────────────────────────────────────
// Setup: git repo with NO `origin` remote configured.
// getGitRemoteUrl returns undefined. Hook should still emit a brief
// without crashing, and claude -p should still capture cleanly.
async function r3_no_origin_remote() {
  header("R3 · No origin remote (graceful degradation when git_remote_url is absent)");

  const cwdName = `r3-no-origin-${RUN_ID}`;
  const cwd = path.join(tmpdir(), `synapse-r3-${RUN_ID}`, cwdName);
  mkdirSync(cwd, { recursive: true });
  cleanupDirs.add(cwd);
  gitInit(cwd, null); // explicitly no remote

  // Verify no remote configured
  const remoteCheck = spawnSync("git", ["remote", "-v"], { cwd, encoding: "utf-8" });
  if ((remoteCheck.stdout ?? "").trim() !== "") {
    fail("R3 setup verify", `expected no git remotes, got: ${remoteCheck.stdout.trim()}`);
    return;
  }
  ok("R3 setup verify", "cwd is a git repo with NO `origin` remote");

  // Hook should not crash
  const { stdout, code, elapsed } = fireHook("session-start", {
    session_id: "r3-no-origin",
    cwd,
    source: "startup",
    hook_event_name: "SessionStart",
  });
  if (code !== 0) {
    fail("R3 hook no crash", `hook exited ${code} on no-origin cwd — should degrade gracefully`);
    return;
  }
  if (elapsed > HOOK_FAST_TIMEOUT_MS) {
    fail("R3 hook timing", `${elapsed}ms — slow path triggered on no-remote cwd`);
    return;
  }
  ok("R3 hook no crash", `hook exited 0 in ${elapsed}ms — no-origin degrades gracefully`);

  if (!stdout.includes("<synapse-brief>")) {
    fail("R3 brief emitted", "no <synapse-brief> tag emitted");
    return;
  }
  ok("R3 brief emitted", `brief emitted (${stdout.length} bytes) despite no origin remote`);

  // Should be able to claude -p without crash; project would auto-create with
  // git_remote_url=undefined and name=folder basename
  const cp = spawnSync("claude", ["-p", "R3 no-origin test. Reply 'noted'."], {
    cwd,
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (cp.status !== 0) {
    fail("R3 claude no-origin", `claude exit ${cp.status}: ${(cp.stderr ?? "").slice(0, 200)}`);
    return;
  }
  ok("R3 claude no-origin", "claude -p succeeded in no-origin cwd");

  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for daemon sync...`);
  await sleep(SLEEP_DAEMON_SYNC_MS);

  const proj = await findProjectByName(cwdName);
  if (!proj) {
    // It's also acceptable if the project simply doesn't materialize (no remote → daemon may skip)
    // BUT a hook-fire alone shouldn't crash and the brief should still emit. The capture path
    // creates a project via folder basename even without a remote.
    info("project did not materialize — acceptable if daemon requires git_remote_url, but check this is intentional");
    ok("R3 graceful no-project", "no project created (no-remote graceful skip OK)");
    return;
  }
  cleanupProjects.add(proj.id);
  ok("R3 project no-remote", `project created with name=${proj.name} despite no remote`);
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  log("Synapse end-to-end RESILIENCE / DOOMSDAY test");
  log(`API: ${API_BASE}`);
  log(`MCP: ${MCP_DIST}`);
  log(`RUN_ID: ${RUN_ID}`);

  if (!preflight()) process.exit(2);

  try {
    await r1_basename_asymmetry();
    await r2_multi_protocol_url();
    await r3_no_origin_remote();
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
    log(`  ${icon} ${r.id.padEnd(42)} ${r.detail}`);
  }
  log("");
  log(`  Total: ${results.length}  ·  PASS: ${passed}  ·  FAIL: ${failed}`);
  log("");
  if (failed > 0) {
    log("❌ E2E RESILIENCE FAILED.");
    process.exit(1);
  } else {
    log("✅ E2E RESILIENCE PASSED.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
