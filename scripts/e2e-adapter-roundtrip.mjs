#!/usr/bin/env node
// scripts/e2e-adapter-roundtrip.mjs
//
// MULTI-TOOL ADAPTER E2E.
//
// Validates the FAQ promise — "Capture works with Claude Code, Cursor,
// Codex CLI, and Gemini CLI" — end-to-end. Unit tests at
// mcp/test/unit/capture/{cursor,codex,gemini}.test.ts already prove the
// per-adapter `parse()` function is correct on a fixture. THIS test proves
// the FULL PIPELINE: file appears in watched dir → chokidar detects →
// registry routes to adapter → adapter.parse() → CloudSync POSTs to
// backend → backend creates conversation row.
//
// Bug class under test: "the adapter→watcher→daemon→backend pipeline
// silently breaks for a tool other than Claude Code." Existing
// e2e-happy-flow.mjs covers Claude Code via `claude -p`; this complements
// with Cursor / Codex / Gemini using their existing fixtures.
//
// Uses SYNAPSE_TEST_<TOOL>_PATH env-var overrides on adapter.watchPaths()
// to redirect each watcher to a temp dir without polluting the user's
// real ~/.cursor / ~/.codex / ~/.gemini state. Spawns a fresh
// capture-worker subprocess (NOT the launchctl-managed daemon, which
// doesn't have these env vars).
//
// Usage:
//   npm run test:e2e:adapter-roundtrip
//   node scripts/e2e-adapter-roundtrip.mjs
//
// Requires:
//   - mcp/dist/capture/capture-worker.js (run `cd mcp && npm run build`)
//   - SYNAPSE_API_KEY resolvable from ~/.synapse/config.json or env
//   - Network access to api.synapsesync.app
//
// Cost per run: $0 (no LLM calls — just adapter parsing + DB inserts).
//
// Exit codes:
//   0 — all 3 adapters proven end-to-end
//   1 — one or more adapters failed
//   2 — preflight error (missing API key, dist missing, etc.)

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { sweepArtifacts } from "./e2e-cleanup.mjs";

// ── Config ───────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CAPTURE_WORKER = path.join(REPO_ROOT, "mcp", "dist", "capture", "capture-worker.js");
const CAPTURE_LOG = path.join(homedir(), ".synapse", "capture.log");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";
const RUN_ID = Date.now();
const RUN_TAG = `e2e-roundtrip-${RUN_ID}`;

// Wait knobs.
// Chokidar takes ~2s to fire its 'ready' event on a fresh dir.
const DAEMON_BOOT_MS = 4000;
// Idle window is 3s (set via SYNAPSE_CAPTURE_IDLE_MS); add ~10s budget for
// chokidar debounce + adapter parse + CloudSync HTTP round-trip.
const SYNC_BUDGET_MS = 18_000;

const FIXTURES = {
  cursor: {
    src: path.join(REPO_ROOT, "mcp/test/fixtures/capture/cursor/sample-chat.json"),
    ext: ".json",
    envVar: "SYNAPSE_TEST_CURSOR_PATH",
    // Original sessionId in the canonical fixture.
    nativeId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  },
  codex: {
    src: path.join(REPO_ROOT, "mcp/test/fixtures/capture/codex/rollout-sample.jsonl"),
    ext: ".jsonl",
    envVar: "SYNAPSE_TEST_CODEX_PATH",
    nativeId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  },
  gemini: {
    src: path.join(REPO_ROOT, "mcp/test/fixtures/capture/gemini/sample-chat.json"),
    ext: ".json",
    envVar: "SYNAPSE_TEST_GEMINI_PATH",
    nativeId: "d4e5f6a7-b8c9-0123-defa-234567890123",
  },
};

const TOOLS = Object.keys(FIXTURES);

// ── Logging helpers (mirror happy-flow.mjs shape) ────────────────────────

const results = [];
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

// ── Helpers ──────────────────────────────────────────────────────────────

function resolveApiKey() {
  const configPath = path.join(homedir(), ".synapse", "config.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.api_key) return config.api_key;
    } catch {
      /* fall through */
    }
  }
  return process.env.SYNAPSE_API_KEY ?? null;
}

// Generate a deterministic UUID-shaped string from the run id + tool so the
// session id is unique per-run AND per-tool.
//
// CRITICAL: tool MUST come first in the input string. Why? sessionIdFromNative()
// strips dashes and takes the first 16 hex chars as the session id. If we put
// the runId first, the first 16 hex chars come from hex-encoding the runId's
// ASCII digits — which are IDENTICAL across all 3 adapter calls in the same
// run. The daemon's SessionStore is keyed by ses_id, so identical IDs cause
// the second and third adapter's CapturedSession to overwrite the first's,
// and the backend ends up with 3 copies of whichever ran last. Putting the
// tool name first gives "cursor…", "codex…", "gemini…" — distinct hex
// prefixes ("63757273…", "636f6465…", "67656d69…").
function freshSessionId(tool, runId) {
  const raw = `${tool}${runId}roundtrip`.padEnd(32, "0").slice(0, 32);
  const hex = Buffer.from(raw).toString("hex").slice(0, 32).padEnd(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Take a raw fixture file and substitute the original session id with a
// fresh per-run one. For codex, also substitute the cwd so the resulting
// backend conversation lands under a project named with our RUN_TAG —
// makes the sweep cleanup trivial.
function freshFixtureContent(tool, runId) {
  const cfg = FIXTURES[tool];
  const raw = readFileSync(cfg.src, "utf-8");
  const newId = freshSessionId(tool, runId);

  let swapped = raw.replaceAll(cfg.nativeId, newId);
  if (tool === "codex") {
    swapped = swapped.replaceAll("/Users/test/myproject", `/tmp/${RUN_TAG}-codex`);
  }
  return { content: swapped, sessionId: newId };
}

// Cursor's adapter derives projectPath by splitting on "workspaceStorage" —
// engineering the watch dir to look like a real Cursor path makes the
// resulting backend project name include our RUN_TAG, so the sweep finds
// it. Gemini hardcodes projectPath="unknown" in its adapter, so its sweep
// fallback is "match by recent created_at + title prefix `[gemini]`".
function buildWatchDir(tool) {
  if (tool === "cursor") {
    // /tmp/<random>/<RUN_TAG>/workspaceStorage/cursor-X/
    // → projectPath becomes "/tmp/<random>/<RUN_TAG>"
    // → backend project name = basename = RUN_TAG
    const base = mkdtempSync(path.join(tmpdir(), "synapse-e2e-"));
    const subdir = path.join(base, RUN_TAG, "workspaceStorage", `cursor-${RUN_ID}`);
    mkdirSync(subdir, { recursive: true });
    return { watchDir: subdir, baseToRemove: base };
  }
  // codex + gemini just need a flat temp dir.
  const dir = mkdtempSync(path.join(tmpdir(), `synapse-e2e-${tool}-`));
  return { watchDir: dir, baseToRemove: dir };
}

// Parse the last N lines of capture.log added since `sinceMarker`. We use
// the daemon's own log as the strongest proof that the pipeline ran end-
// to-end: the "Synced session X to cloud" line is only written when
// CloudSync.sync() returned res.ok from the backend POST.
function readDaemonLogSlice(sinceMarker) {
  if (!existsSync(CAPTURE_LOG)) return "";
  const full = readFileSync(CAPTURE_LOG, "utf-8");
  const idx = full.indexOf(sinceMarker);
  return idx >= 0 ? full.slice(idx) : full;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  header(`ADAPTER ROUNDTRIP — RUN_ID=${RUN_ID}`);

  // ── Preflight ──────────────────────────────────────────────────────────
  if (!existsSync(CAPTURE_WORKER)) {
    log(`Missing dist: ${CAPTURE_WORKER}`);
    log("Run: cd mcp && npm run build");
    process.exit(2);
  }
  const apiKey = resolveApiKey();
  if (!apiKey) {
    log("Missing SYNAPSE_API_KEY — run `synapsesync wizard` or set the env var.");
    process.exit(2);
  }
  info(`API key resolved (${apiKey.slice(0, 8)}…)`);
  info(`API base: ${API_BASE}`);

  // ── Stage 1: prep temp watch dirs + fresh fixtures ─────────────────────
  header("STAGE 1 · Prep watch dirs + per-run fixtures");

  const watchDirs = {};
  const sessionIds = {};
  const cleanupDirs = [];
  for (const tool of TOOLS) {
    const { watchDir, baseToRemove } = buildWatchDir(tool);
    watchDirs[tool] = watchDir;
    cleanupDirs.push(baseToRemove);
    info(`${tool}: watchDir = ${watchDir}`);
  }

  // ── Stage 2: spawn capture-worker subprocess with env overrides ────────
  header("STAGE 2 · Spawn capture-worker with watch-path overrides");

  const startMarker = `[ROUNDTRIP-${RUN_ID} START]`;
  // Drop a sentinel line into capture.log so we can later slice the log
  // to just this run's lines. The marker is the run id so concurrent
  // E2Es (shouldn't happen, but defense-in-depth) don't conflate.
  try {
    if (existsSync(CAPTURE_LOG)) {
      appendFileSync(CAPTURE_LOG, `\n${startMarker}\n`);
    }
  } catch {
    /* if append fails we still proceed — log slice fallback is full log */
  }

  // Isolate the test daemon's STATE (sessions/, projects/, sync-states.json)
  // by setting SYNAPSE_HOME to a temp dir. This avoids polluting the user's
  // real ~/.synapse with our synthetic session IDs and project entries.
  // capture.log is hardcoded to ~/.synapse/capture.log so we still share
  // that — but the per-run unique session IDs make assertion lines
  // unambiguously ours.
  const isolatedHome = mkdtempSync(path.join(tmpdir(), `synapse-home-${RUN_ID}-`));
  cleanupDirs.push(isolatedHome);
  const daemonEnv = {
    ...process.env,
    SYNAPSE_API_KEY: apiKey,
    SYNAPSE_HOME: isolatedHome,
    SYNAPSE_TEST_CURSOR_PATH: watchDirs.cursor,
    SYNAPSE_TEST_CODEX_PATH: watchDirs.codex,
    SYNAPSE_TEST_GEMINI_PATH: watchDirs.gemini,
    SYNAPSE_CAPTURE_IDLE_MS: "3000",
  };
  info(`SYNAPSE_HOME isolated to ${isolatedHome}`);

  const daemonProc = spawn("node", [CAPTURE_WORKER], {
    env: daemonEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let daemonExitCode = null;
  daemonProc.on("exit", (code) => {
    daemonExitCode = code;
  });

  info(`spawned capture-worker pid=${daemonProc.pid}, waiting ${DAEMON_BOOT_MS}ms for chokidar ready`);
  await new Promise((r) => setTimeout(r, DAEMON_BOOT_MS));

  if (daemonExitCode !== null) {
    fail("daemon-boot", `capture-worker exited prematurely (code=${daemonExitCode})`);
    cleanup({ daemonProc, cleanupDirs });
    summarize();
    process.exit(1);
  }
  ok("daemon-boot", `capture-worker booted (pid=${daemonProc.pid})`);

  // ── Stage 3: drop fresh fixtures into watch dirs ───────────────────────
  header("STAGE 3 · Drop per-run fixtures");

  for (const tool of TOOLS) {
    const { content, sessionId } = freshFixtureContent(tool, RUN_ID);
    sessionIds[tool] = sessionId;
    const dst = path.join(watchDirs[tool], `${RUN_TAG}-${tool}${FIXTURES[tool].ext}`);
    writeFileSync(dst, content);
    info(`${tool}: dropped fixture session_id=${sessionId.slice(0, 13)}… at ${dst}`);
  }

  // ── Stage 4: wait for sync ─────────────────────────────────────────────
  header(`STAGE 4 · Wait ${SYNC_BUDGET_MS}ms for chokidar + idle + cloud-sync`);
  await new Promise((r) => setTimeout(r, SYNC_BUDGET_MS));

  // ── Stage 5: kill daemon + read its log slice ──────────────────────────
  header("STAGE 5 · Stop daemon, inspect capture.log");

  daemonProc.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  if (daemonExitCode === null) {
    try {
      daemonProc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }

  const logSlice = readDaemonLogSlice(startMarker);
  if (!logSlice) {
    fail("log-slice", `capture.log empty or missing after run`);
  } else {
    info(`captured ${logSlice.length} bytes of daemon log`);
  }

  // ── Stage 6: per-tool assertion: pipeline reached cloud ────────────────
  header("STAGE 6 · Per-tool pipeline assertions");

  // The "Synced session X to cloud" log line is written in capture-worker.ts
  // ONLY when CloudSync.sync() returned ok from the backend POST. So its
  // presence proves: file→watcher→adapter.parse()→store→idle→CloudSync→
  // backend 2xx — the full pipeline.
  for (const tool of TOOLS) {
    // sessionIdFromNative() strips dashes and takes first 16 chars, prefixed
    // with "ses_". Mirror that here to compute the expected ses_ id the
    // daemon will log.
    const cleanId = sessionIds[tool].replace(/-/g, "").slice(0, 16);
    const expectedSesId = `ses_${cleanId}`;
    const syncedPattern = `Synced session ${expectedSesId} to cloud`;
    const capturedPattern = `from ${tool}`;

    const captured = logSlice.includes(capturedPattern);
    const synced = logSlice.includes(syncedPattern);

    if (captured && synced) {
      ok(`pipeline-${tool}`, `captured + synced (${tool}, ${expectedSesId.slice(0, 12)}…)`);
    } else if (captured && !synced) {
      fail(`pipeline-${tool}`, `${tool} captured locally but NOT synced to cloud — backend POST failed silently`);
    } else if (!captured) {
      fail(`pipeline-${tool}`, `${tool} NOT captured — watcher/adapter never fired (chokidar missed the file?)`);
    }
  }

  // ── Stage 7: backend roundtrip — confirm via API ───────────────────────
  header("STAGE 7 · Backend roundtrip — projects API");

  // Cursor's project name should embed RUN_TAG via the workspaceStorage
  // engineering. Codex's project name = RUN_TAG-codex via cwd substitution.
  // Gemini's projectPath is hardcoded "unknown" so we can't filter by name
  // there — but stage 6 already proves gemini synced. The projects sweep
  // catches cursor + codex; the daemon log catches all three.
  try {
    const res = await fetch(`${API_BASE}/api/projects`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      fail("backend-projects", `GET /api/projects → HTTP ${res.status}`);
    } else {
      const projects = await res.json();
      const matched = projects.filter((p) => p.name && p.name.includes(RUN_TAG));
      if (matched.length >= 2) {
        ok("backend-projects", `backend has ${matched.length} project(s) tagged ${RUN_TAG}`);
      } else {
        fail(
          "backend-projects",
          `expected ≥2 projects with name containing ${RUN_TAG} (cursor + codex); got ${matched.length}`,
        );
      }
    }
  } catch (err) {
    fail("backend-projects", `GET /api/projects errored: ${err.message}`);
  }

  // ── Stage 8: cleanup ───────────────────────────────────────────────────
  header("STAGE 8 · Cleanup");

  // Backend: sweep projects whose name contains RUN_TAG.
  await sweepArtifacts({
    apiKey,
    patterns: [RUN_TAG],
    apiUrl: API_BASE,
    log: (m) => info(m.replace(/^\s+/, "")),
    label: "adapter-roundtrip",
    settleMs: 2000,
  });

  // Local: remove temp watch dirs.
  for (const d of cleanupDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* swallow — cleanup is best-effort */
    }
  }
  info(`removed ${cleanupDirs.length} temp watch base dir(s)`);

  summarize();

  const allPass = results.every((r) => r.status === "PASS");
  if (!allPass) {
    log("\n❌ ADAPTER ROUNDTRIP FAILED. The multi-tool pipeline is broken.");
    process.exit(1);
  }
  log("\n✅ All 3 adapters proven end-to-end. The multi-tool capture promise is intact.");
  process.exit(0);
}

function cleanup({ daemonProc, cleanupDirs }) {
  try {
    daemonProc.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  for (const d of cleanupDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function summarize() {
  log("\n────────────────────────────────────────────────────────────────────");
  log("Adapter-roundtrip summary:");
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    log(`  ${icon} ${r.id}: ${r.detail}`);
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  log(`────────────────────────────────────────────────────────────────────`);
  log(`${passed}/${results.length} stages passed`);
}

main().catch((err) => {
  log(`\n💥 FATAL: ${err.stack ?? err.message}`);
  process.exit(2);
});
