#!/usr/bin/env node
// scripts/e2e-insight-roundtrip.mjs
//
// THE INSIGHT-ROUNDTRIP CROSS-SESSION TEST.
//
// Asserts the promise: "When the user (or an agent) saves an insight in
// session N, session N+1 starting in the same project sees it in the brief
// without explicitly calling list_insights."
//
// This catches the bug class where insights are write-only — save_insight
// returns OK and list_insights retrieves them, but the SessionStart hook
// never pulls them into the brief, so the cross-session promise silently
// doesn't work.
//
// Stages:
//   IR1  Create temp cwd + git remote
//   IR2  claude -p captures session — backend project is auto-created
//   IR3  Resolve testProjectId from /api/projects
//   IR4  POST /api/insights with a UNIQUE_PHRASE in the summary
//   IR5  Fire SessionStart on the same cwd
//   IR6  Assert UNIQUE_PHRASE appears in the brief output
//
// Usage:
//   npm run test:e2e:insight
//   node scripts/e2e-insight-roundtrip.mjs
//
// Cost per run: ~$0.02-0.05 in Anthropic tokens (one claude -p capture).
// Wall time: ~30-45s.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ── Configuration ────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";

const RUN_ID = Date.now();
const UNIQUE_PHRASE = `owlfish-bridge-eleven-${RUN_ID}`;
const INSIGHT_SUMMARY = `Cross-session test — should appear in next brief: ${UNIQUE_PHRASE}`;
const INSIGHT_DETAIL = `Detail line for ${UNIQUE_PHRASE} — if this surfaces in the brief, the round-trip works end-to-end.`;

const SLEEP_DAEMON_SYNC_MS = 15_000;
const HOOK_FAST_TIMEOUT_MS = 10_000;

// ── State ────────────────────────────────────────────────────────────────
const results = [];
let testDir = null;
let apiKey = null;
let testProjectId = null;
let testInsightId = null;

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
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_TRIES) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  return { _status: 0, _err: `network: ${lastErr?.message ?? lastErr}` };
}

function fireHook(name, payload) {
  const start = Date.now();
  const out = spawnSync(process.execPath, [MCP_DIST, "hook", name], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
  });
  return { elapsed: Date.now() - start, stdout: out.stdout ?? "", stderr: out.stderr ?? "", code: out.status };
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

// ── Cleanup ─────────────────────────────────────────────────────────────
async function cleanup() {
  if (testInsightId) {
    const res = await fetch(`${API_BASE}/api/insights/${testInsightId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) log(`  · cleanup: deleted insight ${testInsightId}`);
    else log(`  · cleanup: WARN failed to delete insight (HTTP ${res.status})`);
  }
  if (testProjectId) {
    const res = await fetch(`${API_BASE}/api/projects/${testProjectId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) log(`  · cleanup: deleted project ${testProjectId}`);
    else log(`  · cleanup: WARN failed to delete project (HTTP ${res.status})`);
  }
  if (testDir && existsSync(testDir)) {
    try {
      rmSync(testDir, { recursive: true, force: true });
      log(`  · cleanup: removed ${testDir}`);
    } catch (e) {
      log(`  · cleanup: WARN failed to rm ${testDir}: ${e.message}`);
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

// ── IR1: Setup ───────────────────────────────────────────────────────────
async function ir1_setup() {
  header("IR1 · Create temp cwd + git repo");

  const basename = `insight-roundtrip-${RUN_ID}`;
  testDir = path.join(tmpdir(), `synapse-e2e-${RUN_ID}`, basename);
  mkdirSync(testDir, { recursive: true });

  spawnSync("git", ["init", "-q"], { cwd: testDir });
  spawnSync("git", ["config", "user.email", "e2e-ir@synapse.test"], { cwd: testDir });
  spawnSync("git", ["config", "user.name", "e2e-ir"], { cwd: testDir });
  const remote = `https://github.com/synapse-e2e/${basename}.git`;
  spawnSync("git", ["remote", "add", "origin", remote], { cwd: testDir });
  writeFileSync(path.join(testDir, "README.md"), "# e2e insight roundtrip\n");
  spawnSync("git", ["add", "-A"], { cwd: testDir });
  spawnSync("git", ["commit", "-q", "-m", "initial"], { cwd: testDir });

  info(`cwd = ${testDir}`);
  ok("IR1 setup", "temp git repo created");
}

// ── IR2: claude -p captures, daemon syncs, project materializes ─────────
async function ir2_capture_and_sync() {
  header("IR2 · claude -p capture + daemon sync");

  const prompt = "E2E insight-roundtrip test. Reply 'noted' and nothing else.";
  info("Running claude -p...");
  const cp = spawnSync("claude", ["-p", prompt], { cwd: testDir, encoding: "utf-8", timeout: 120_000 });
  if (cp.status !== 0) {
    fail("IR2 claude -p", `claude exit ${cp.status}: ${(cp.stderr ?? "").slice(0, 200)}`);
    return;
  }
  ok("IR2 claude -p", "session captured");

  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for daemon sync...`);
  await sleep(SLEEP_DAEMON_SYNC_MS);
}

// ── IR3: Resolve testProjectId ──────────────────────────────────────────
async function ir3_resolve_project() {
  header("IR3 · Resolve project_id from backend");

  const testBasename = path.basename(testDir);
  const projects = await fetchJson("/api/projects");
  if (!Array.isArray(projects)) {
    fail("IR3 list projects", `non-array response: ${JSON.stringify(projects).slice(0, 200)}`);
    return;
  }
  const match = projects.find((p) => p.name === testBasename);
  if (!match) {
    try {
      writeFileSync(path.join(process.env.HOME ?? "/", ".synapse", "daemon-flush-now"), "");
    } catch {}
    await sleep(5000);
    const retry = await fetchJson("/api/projects");
    const m2 = Array.isArray(retry) ? retry.find((p) => p.name === testBasename) : null;
    if (!m2) {
      fail("IR3 project resolved", `project '${testBasename}' not found after retry`);
      return;
    }
    testProjectId = m2.id;
  } else {
    testProjectId = match.id;
  }
  ok("IR3 project resolved", `${testProjectId}`);
}

// ── IR4: Save insight with UNIQUE_PHRASE ────────────────────────────────
async function ir4_save_insight() {
  header("IR4 · POST /api/insights with UNIQUE_PHRASE in summary");

  const save = await fetchJson("/api/insights", {
    method: "POST",
    body: JSON.stringify({
      project_id: testProjectId,
      type: "decision",
      summary: INSIGHT_SUMMARY,
      detail: INSIGHT_DETAIL,
    }),
  });
  if (save._err) {
    fail("IR4 save_insight", `HTTP ${save._status}: ${save._err.slice(0, 200)}`);
    return;
  }
  if (!save.id) {
    fail("IR4 save_insight", `no id in response: ${JSON.stringify(save).slice(0, 200)}`);
    return;
  }
  testInsightId = save.id;
  info(`UNIQUE_PHRASE = ${UNIQUE_PHRASE}`);
  ok("IR4 save_insight", `insight ${testInsightId} created`);
}

// ── IR5: Fire SessionStart, capture brief ───────────────────────────────
async function ir5_fire_hook() {
  header("IR5 · Fire SessionStart on the same cwd");

  const { elapsed, stdout, stderr, code } = fireHook("session-start", {
    session_id: "e2e-ir-recall",
    cwd: testDir,
    source: "startup",
    hook_event_name: "SessionStart",
  });

  if (code !== 0) {
    fail("IR5 hook exit", `hook exited ${code}; stderr=${(stderr ?? "").slice(0, 200)}`);
    return;
  }
  if (elapsed > HOOK_FAST_TIMEOUT_MS) {
    fail("IR5 hook timing", `${elapsed}ms exceeds ${HOOK_FAST_TIMEOUT_MS}ms budget`);
  } else {
    ok("IR5 hook timing", `${elapsed}ms`);
  }

  if (!stdout.includes("<synapse-brief>")) {
    fail("IR5 brief shape", "no <synapse-brief> tag emitted");
    return;
  }
  ok("IR5 brief shape", `<synapse-brief> tag present (${stdout.length} bytes)`);

  results._brief = stdout;
}

// ── IR6: Assert UNIQUE_PHRASE in brief (THE TEST) ───────────────────────
async function ir6_assert_recall() {
  header("IR6 · Brief contains UNIQUE_PHRASE (THE INSIGHT-ROUNDTRIP TEST)");

  const brief = results._brief ?? "";
  if (!brief) {
    fail("IR6 cross-session recall", "no brief captured from IR5");
    return;
  }

  if (brief.includes(UNIQUE_PHRASE)) {
    ok("IR6 cross-session recall", "brief contains UNIQUE_PHRASE — insight → brief loop works");
  } else {
    fail("IR6 cross-session recall", "brief does NOT contain UNIQUE_PHRASE — insight save was write-only theater");
    info(`brief preview (last 1000 chars):\n  ${brief.slice(-1000).replace(/\n/g, "\n  ")}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  log("Synapse end-to-end INSIGHT-ROUNDTRIP cross-session test");
  log(`API: ${API_BASE}`);
  log(`MCP: ${MCP_DIST}`);
  log(`RUN_ID: ${RUN_ID}`);

  if (!preflight()) process.exit(2);

  try {
    await ir1_setup();
    await ir2_capture_and_sync();
    await ir3_resolve_project();
    if (testProjectId) {
      await ir4_save_insight();
      if (testInsightId) {
        await ir5_fire_hook();
        await ir6_assert_recall();
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
    log("❌ E2E INSIGHT-ROUNDTRIP FAILED.");
    process.exit(1);
  } else {
    log("✅ E2E INSIGHT-ROUNDTRIP PASSED.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
