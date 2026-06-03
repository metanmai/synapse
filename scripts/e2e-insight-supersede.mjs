#!/usr/bin/env node
// scripts/e2e-insight-supersede.mjs
//
// THE INSIGHT-SUPERSESSION CROSS-SESSION TEST.
//
// Asserts the promise: "When an AI saves a new insight with
// supersedes=[old_id], the OLD insight stops appearing in the brief and
// the NEW one starts appearing in its place."
//
// This catches the bug class where superseded insights leak into the
// brief: save_insight with supersedes={old_id} returns OK, but the
// backend doesn't actually mark the old row superseded — or it marks it
// but the brief query doesn't filter it out. Either failure leaves stale
// decisions surfacing across sessions and breaks the trust promise that
// "supersedes" is how an agent overwrites prior knowledge.
//
// Stages:
//   IS1  Create temp cwd + git remote
//   IS2  claude -p captures session — backend project is auto-created
//   IS3  Resolve testProjectId from /api/projects
//   IS4  POST /api/insights with OLD_PHRASE → store oldInsightId
//   IS5  POST /api/insights with NEW_PHRASE, supersedes=[oldInsightId]
//   IS6  GET /api/insights?project_id=X — assert OLD absent, NEW present;
//        and GET with ?include_superseded=true DOES include OLD
//   IS7  Fire SessionStart on the same cwd
//   IS8  THE KEY ASSERTION: brief INCLUDES NEW_PHRASE and DOES NOT
//        INCLUDE OLD_PHRASE
//
// REQUIRES BACKEND DEPLOY: This test exercises the LIVE backend at
// api.synapsesync.app. The `supersedes` array on POST /api/insights and
// the default-exclude-superseded behavior on GET /api/insights are NEW
// backend behaviors. Until the parallel agent's backend changes are
// deployed, this test will FAIL at IS5/IS6 — the POST will succeed but
// the supersession won't actually apply, so the old insight will keep
// showing up. That is the correct red signal for the merge gate.
//
// Usage:
//   npm run test:e2e:supersede
//   node scripts/e2e-insight-supersede.mjs
//
// Cost per run: ~$0.02-0.05 in Anthropic tokens (one claude -p capture).
// Wall time: ~30-45s.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeLocalProjectState, removeLocalProjectsByBasename, sweepArtifacts } from "./e2e-cleanup.mjs";
import { generateSession } from "./e2e-llm-driver.mjs";

// ── Configuration ────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";

const RUN_ID = Date.now();
// Unique unguessable phrases — a model can't fabricate these from cold,
// so the assertion can't pass without the real supersession behavior.
const OLD_PHRASE = `raven-valley-three-${RUN_ID}`;
const NEW_PHRASE = `tortoise-plateau-eight-${RUN_ID}`;
const OLD_SUMMARY = `Cross-session test OLD — should be superseded and disappear: ${OLD_PHRASE}`;
const OLD_DETAIL = `Detail for ${OLD_PHRASE} — if the brief still mentions this after supersession, the filter is broken.`;
const NEW_SUMMARY = `Cross-session test NEW — should replace OLD in the brief: ${NEW_PHRASE}`;
const NEW_DETAIL = `Detail for ${NEW_PHRASE} — supersedes the prior insight via the new backend contract.`;

// Edge case phrases — each unique so the brief assertions can't collide.
// IS9: multi-supersede (one new insight replaces three old)
const A1_PHRASE = `lemur-fjord-twelve-${RUN_ID}`;
const A2_PHRASE = `manatee-glacier-fifteen-${RUN_ID}`;
const A3_PHRASE = `narwhal-canyon-twenty-${RUN_ID}`;
const B_PHRASE = `osprey-meadow-thirteen-${RUN_ID}`;
// IS10: chain supersession C1 → C2 → C3
const C1_PHRASE = `pangolin-tundra-six-${RUN_ID}`;
const C2_PHRASE = `quokka-savanna-nine-${RUN_ID}`;
const C3_PHRASE = `rhinoceros-archipelago-two-${RUN_ID}`;
// IS11: non-existent UUID in supersedes (must not error)
const D_PHRASE = `serval-volcano-seven-${RUN_ID}`;
// IS12: idempotent re-supersede (saving E with supersedes=[A1,A2,A3] must NOT
// overwrite their existing pointer to B — protects history from race-corruption)
const E_PHRASE = `tapir-mesa-four-${RUN_ID}`;
// A real v4 UUID, freshly generated — passes Zod's `.uuid()` validator at
// the API boundary, but the probability it collides with any auto-generated
// insight id in the DB is ~1 in 2^122. Used for IS11.
const NONEXISTENT_UUID = randomUUID();

const SLEEP_DAEMON_SYNC_MS = 15_000;
const HOOK_FAST_TIMEOUT_MS = 10_000;

// ── State ────────────────────────────────────────────────────────────────
const results = [];
let testDir = null;
let apiKey = null;
let testProjectId = null;
let oldInsightId = null;
let newInsightId = null;
// Edge case insight ids — captured so final assertions can spot them and
// cleanup (force-delete via project cascade) doesn't strictly depend on them.
let a1Id = null;
let a2Id = null;
let a3Id = null;
let bId = null;
let c1Id = null;
let c2Id = null;
let c3Id = null;
let dId = null;
let eId = null;

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

// Retry transient network failures (IPv6 socket resets, connect timeouts)
// that flake the test without indicating a real logic bug.
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
  // Delete both insights so cleanup leaves no residue even when the test
  // fails partway through. Use include_superseded so superseded rows are
  // also reachable for deletion.
  for (const [label, id] of [
    ["new insight", newInsightId],
    ["old insight", oldInsightId],
  ]) {
    if (!id) continue;
    const res = await fetch(`${API_BASE}/api/insights/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) log(`  · cleanup: deleted ${label} ${id}`);
    else log(`  · cleanup: WARN failed to delete ${label} (HTTP ${res.status})`);
  }
  if (testProjectId) {
    const res = await fetch(`${API_BASE}/api/projects/${testProjectId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) log(`  · cleanup: deleted project ${testProjectId}`);
    else log(`  · cleanup: WARN failed to delete project (HTTP ${res.status})`);
    removeLocalProjectState(testProjectId, { log });
  }
  // Also nuke any cwd_<hash> placeholder dirs the daemon wrote pre-canonical
  // resolution — they retry post-cleanup if left behind.
  removeLocalProjectsByBasename(`insight-supersede-${RUN_ID}`, { log });
  // Belt-and-suspenders sweep: if anything created additional projects
  // tagged with this RUN_ID (auto-route side-effects, retried daemon syncs),
  // force-delete them too. Catches the single-ID-tracking miss class.
  await sweepArtifacts({
    apiKey,
    apiUrl: API_BASE,
    patterns: [`-${RUN_ID}`],
    log,
  });
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

// ── IS1: Setup ───────────────────────────────────────────────────────────
async function is1_setup() {
  header("IS1 · Create temp cwd + git repo");

  const basename = `insight-supersede-${RUN_ID}`;
  testDir = path.join(tmpdir(), `synapse-e2e-${RUN_ID}`, basename);
  mkdirSync(testDir, { recursive: true });

  spawnSync("git", ["init", "-q"], { cwd: testDir });
  spawnSync("git", ["config", "user.email", "e2e-is@synapse.test"], { cwd: testDir });
  spawnSync("git", ["config", "user.name", "e2e-is"], { cwd: testDir });
  const remote = `https://github.com/synapse-e2e/${basename}.git`;
  spawnSync("git", ["remote", "add", "origin", remote], { cwd: testDir });
  writeFileSync(path.join(testDir, "README.md"), "# e2e insight supersede\n");
  spawnSync("git", ["add", "-A"], { cwd: testDir });
  spawnSync("git", ["commit", "-q", "-m", "initial"], { cwd: testDir });

  info(`cwd = ${testDir}`);
  ok("IS1 setup", "temp git repo created");
}

// ── IS2: LLM captures, daemon syncs, project materializes ──────────────
async function is2_capture_and_sync() {
  header("IS2 · LLM capture + daemon sync");

  const prompt = "E2E insight-supersede test. Reply 'noted' and nothing else.";
  info("Running LLM driver (direct-API curl OR CLI driver, auto-selected)...");
  let driver;
  let mode;
  try {
    const result = generateSession({ prompt, cwd: testDir, timeoutMs: 120_000 });
    driver = result.driver;
    mode = result.mode;
  } catch (err) {
    fail("IS2 LLM capture", `${err.message}`.slice(0, 300));
    return;
  }
  ok("IS2 LLM capture", `session captured via ${mode} (${driver})`);

  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for daemon sync...`);
  await sleep(SLEEP_DAEMON_SYNC_MS);
}

// ── IS3: Resolve testProjectId ──────────────────────────────────────────
async function is3_resolve_project() {
  header("IS3 · Resolve project_id from backend");

  const testBasename = path.basename(testDir);
  const projects = await fetchJson("/api/projects");
  if (!Array.isArray(projects)) {
    fail("IS3 list projects", `non-array response: ${JSON.stringify(projects).slice(0, 200)}`);
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
      fail("IS3 project resolved", `project '${testBasename}' not found after retry`);
      return;
    }
    testProjectId = m2.id;
  } else {
    testProjectId = match.id;
  }
  ok("IS3 project resolved", `${testProjectId}`);
}

// ── IS4: Save the OLD insight ───────────────────────────────────────────
async function is4_save_old() {
  header("IS4 · POST /api/insights with OLD_PHRASE (the to-be-superseded one)");

  const save = await fetchJson("/api/insights", {
    method: "POST",
    body: JSON.stringify({
      project_id: testProjectId,
      type: "decision",
      summary: OLD_SUMMARY,
      detail: OLD_DETAIL,
    }),
  });
  if (save._err) {
    fail("IS4 save OLD", `HTTP ${save._status}: ${save._err.slice(0, 200)}`);
    return;
  }
  if (!save.id) {
    fail("IS4 save OLD", `no id in response: ${JSON.stringify(save).slice(0, 200)}`);
    return;
  }
  oldInsightId = save.id;
  info(`OLD_PHRASE = ${OLD_PHRASE}`);
  ok("IS4 save OLD", `OLD insight ${oldInsightId} created`);
}

// ── IS5: Save the NEW insight, superseding the OLD one ──────────────────
async function is5_save_new_with_supersedes() {
  header("IS5 · POST /api/insights with NEW_PHRASE and supersedes=[oldInsightId]");

  const save = await fetchJson("/api/insights", {
    method: "POST",
    body: JSON.stringify({
      project_id: testProjectId,
      type: "decision",
      summary: NEW_SUMMARY,
      detail: NEW_DETAIL,
      supersedes: [oldInsightId],
    }),
  });
  if (save._err) {
    fail("IS5 save NEW", `HTTP ${save._status}: ${save._err.slice(0, 200)}`);
    return;
  }
  if (!save.id) {
    fail("IS5 save NEW", `no id in response: ${JSON.stringify(save).slice(0, 200)}`);
    return;
  }
  newInsightId = save.id;
  info(`NEW_PHRASE = ${NEW_PHRASE}`);
  ok("IS5 save NEW", `NEW insight ${newInsightId} created (supersedes ${oldInsightId})`);
}

// ── IS6: Verify supersession at the API layer ───────────────────────────
async function is6_verify_api_filter() {
  header("IS6 · GET /api/insights filters out the superseded OLD row");

  const list = await fetchJson(`/api/insights?project_id=${testProjectId}`);
  if (list._err) {
    fail("IS6 default list", `HTTP ${list._status}: ${list._err.slice(0, 200)}`);
    return;
  }
  const items = Array.isArray(list) ? list : (list.insights ?? []);
  const hasNew = items.some((i) => i.id === newInsightId);
  const hasOld = items.some((i) => i.id === oldInsightId);

  if (hasNew && !hasOld) {
    ok("IS6 default list", "NEW present, OLD absent — default query filters superseded");
  } else {
    fail("IS6 default list", `expected NEW present + OLD absent — got hasNew=${hasNew} hasOld=${hasOld}`);
    info(`items: ${items.map((i) => i.id).join(", ")}`);
  }

  // Sanity check: include_superseded=true should bring the OLD row back.
  const listAll = await fetchJson(`/api/insights?project_id=${testProjectId}&include_superseded=true`);
  if (listAll._err) {
    fail("IS6 include_superseded list", `HTTP ${listAll._status}: ${listAll._err.slice(0, 200)}`);
    return;
  }
  const itemsAll = Array.isArray(listAll) ? listAll : (listAll.insights ?? []);
  const hasOldWhenIncluded = itemsAll.some((i) => i.id === oldInsightId);
  const hasNewWhenIncluded = itemsAll.some((i) => i.id === newInsightId);
  if (hasOldWhenIncluded && hasNewWhenIncluded) {
    ok("IS6 include_superseded list", "both OLD and NEW visible when include_superseded=true");
  } else {
    fail(
      "IS6 include_superseded list",
      `expected both visible with include_superseded — got OLD=${hasOldWhenIncluded} NEW=${hasNewWhenIncluded}`,
    );
  }
}

// ── IS7: Fire SessionStart, capture brief ───────────────────────────────
async function is7_fire_hook() {
  header("IS7 · Fire SessionStart on the same cwd");

  const { elapsed, stdout, stderr, code } = fireHook("session-start", {
    session_id: "e2e-is-supersede",
    cwd: testDir,
    source: "startup",
    hook_event_name: "SessionStart",
  });

  if (code !== 0) {
    fail("IS7 hook exit", `hook exited ${code}; stderr=${(stderr ?? "").slice(0, 200)}`);
    return;
  }
  if (elapsed > HOOK_FAST_TIMEOUT_MS) {
    fail("IS7 hook timing", `${elapsed}ms exceeds ${HOOK_FAST_TIMEOUT_MS}ms budget`);
  } else {
    ok("IS7 hook timing", `${elapsed}ms`);
  }

  if (!stdout.includes("<synapse-brief>")) {
    fail("IS7 brief shape", "no <synapse-brief> tag emitted");
    return;
  }
  ok("IS7 brief shape", `<synapse-brief> tag present (${stdout.length} bytes)`);

  results._brief = stdout;
}

// ── IS8: THE KEY ASSERTION — NEW in brief, OLD not in brief ─────────────
async function is8_assert_supersession() {
  header("IS8 · Brief contains NEW_PHRASE and NOT OLD_PHRASE (THE SUPERSESSION TEST)");

  const brief = results._brief ?? "";
  if (!brief) {
    fail("IS8 supersession", "no brief captured from IS7");
    return;
  }

  const hasNew = brief.includes(NEW_PHRASE);
  const hasOld = brief.includes(OLD_PHRASE);

  if (hasNew && !hasOld) {
    ok("IS8 supersession", "brief contains NEW_PHRASE and OMITS OLD_PHRASE — supersession works end-to-end");
  } else {
    fail(
      "IS8 supersession",
      `supersession broken — hasNew=${hasNew} hasOld=${hasOld} (need hasNew=true and hasOld=false)`,
    );
    info(`brief preview (last 1200 chars):\n  ${brief.slice(-1200).replace(/\n/g, "\n  ")}`);
  }
}

// ── Helper: save an insight, return id or null on error ────────────────
async function saveInsight(summary, detail, supersedes) {
  const body = { project_id: testProjectId, type: "decision", summary, detail };
  if (supersedes && supersedes.length > 0) body.supersedes = supersedes;
  const res = await fetchJson("/api/insights", { method: "POST", body: JSON.stringify(body) });
  if (res._err || !res.id) {
    return { err: res._err ?? "missing id", status: res._status };
  }
  return { id: res.id };
}

async function findRow(id, includeSuperseded) {
  const qs = includeSuperseded ? "&include_superseded=true" : "";
  const list = await fetchJson(`/api/insights?project_id=${testProjectId}${qs}&limit=50`);
  if (list._err) return null;
  const items = Array.isArray(list) ? list : (list.insights ?? []);
  return items.find((i) => i.id === id) ?? null;
}

// ── IS9: Multi-supersede — one new insight replaces THREE old ones ───────
async function is9_multi_supersede() {
  header("IS9 · Multi-supersede (B supersedes A1, A2, A3 in one call)");

  const r1 = await saveInsight(`A1 multi-supersede ${A1_PHRASE}`, "first of three to be replaced", null);
  const r2 = await saveInsight(`A2 multi-supersede ${A2_PHRASE}`, "second of three to be replaced", null);
  const r3 = await saveInsight(`A3 multi-supersede ${A3_PHRASE}`, "third of three to be replaced", null);
  if (r1.err || r2.err || r3.err) {
    fail("IS9 setup A1-A3", `failed to create old triple — ${r1.err ?? r2.err ?? r3.err}`);
    return;
  }
  a1Id = r1.id;
  a2Id = r2.id;
  a3Id = r3.id;

  const rb = await saveInsight(`B multi-supersedes ${B_PHRASE}`, "replaces A1, A2, and A3 in one shot", [
    a1Id,
    a2Id,
    a3Id,
  ]);
  if (rb.err) {
    fail("IS9 save B", `failed to create B — ${rb.err}`);
    return;
  }
  bId = rb.id;
  ok("IS9 multi-supersede save", `B ${bId.slice(0, 8)}… created with supersedes=[A1,A2,A3]`);

  // All three As should be filtered from the default list.
  const defaultList = await fetchJson(`/api/insights?project_id=${testProjectId}&limit=50`);
  const items = Array.isArray(defaultList) ? defaultList : (defaultList.insights ?? []);
  const ids = new Set(items.map((i) => i.id));
  const a1Visible = ids.has(a1Id);
  const a2Visible = ids.has(a2Id);
  const a3Visible = ids.has(a3Id);
  const bVisible = ids.has(bId);
  if (!a1Visible && !a2Visible && !a3Visible && bVisible) {
    ok("IS9 default filter", "A1, A2, A3 all hidden; B visible — multi-supersede filter works");
  } else {
    fail(
      "IS9 default filter",
      `expected A1/A2/A3=hidden, B=visible — got A1=${a1Visible} A2=${a2Visible} A3=${a3Visible} B=${bVisible}`,
    );
    return;
  }

  // Verify ALL three As point at B in the full history.
  const a1Row = await findRow(a1Id, true);
  const a2Row = await findRow(a2Id, true);
  const a3Row = await findRow(a3Id, true);
  if (a1Row?.superseded_by === bId && a2Row?.superseded_by === bId && a3Row?.superseded_by === bId) {
    ok("IS9 superseded_by pointers", "all three A rows point at B");
  } else {
    fail(
      "IS9 superseded_by pointers",
      `expected all three to point at B — got A1=${a1Row?.superseded_by} A2=${a2Row?.superseded_by} A3=${a3Row?.superseded_by}`,
    );
  }
}

// ── IS10: Chain supersession — C1 ← C2 ← C3, brief sees only C3 ─────────
async function is10_chain_supersession() {
  header("IS10 · Chain supersession (C1 superseded by C2, C2 superseded by C3)");

  const r1 = await saveInsight(`C1 chain ${C1_PHRASE}`, "chain link 1 — earliest", null);
  if (r1.err) {
    fail("IS10 save C1", `${r1.err}`);
    return;
  }
  c1Id = r1.id;

  const r2 = await saveInsight(`C2 chain ${C2_PHRASE}`, "chain link 2 — replaces C1", [c1Id]);
  if (r2.err) {
    fail("IS10 save C2", `${r2.err}`);
    return;
  }
  c2Id = r2.id;

  const r3 = await saveInsight(`C3 chain ${C3_PHRASE}`, "chain link 3 — replaces C2", [c2Id]);
  if (r3.err) {
    fail("IS10 save C3", `${r3.err}`);
    return;
  }
  c3Id = r3.id;
  ok("IS10 chain save", `C1 ${c1Id.slice(0, 8)}… ← C2 ${c2Id.slice(0, 8)}… ← C3 ${c3Id.slice(0, 8)}…`);

  // Only C3 should remain in the default list.
  const list = await fetchJson(`/api/insights?project_id=${testProjectId}&limit=50`);
  const items = Array.isArray(list) ? list : (list.insights ?? []);
  const ids = new Set(items.map((i) => i.id));
  const c1Vis = ids.has(c1Id);
  const c2Vis = ids.has(c2Id);
  const c3Vis = ids.has(c3Id);
  if (!c1Vis && !c2Vis && c3Vis) {
    ok("IS10 chain filter", "only C3 visible in default list — chain collapses correctly");
  } else {
    fail("IS10 chain filter", `expected only C3 visible — got C1=${c1Vis} C2=${c2Vis} C3=${c3Vis}`);
    return;
  }

  // Verify the pointer chain is intact in the audit view.
  const c1Row = await findRow(c1Id, true);
  const c2Row = await findRow(c2Id, true);
  const c3Row = await findRow(c3Id, true);
  if (c1Row?.superseded_by === c2Id && c2Row?.superseded_by === c3Id && (c3Row?.superseded_by ?? null) === null) {
    ok("IS10 chain pointers", "C1→C2, C2→C3, C3=active — chain is well-formed");
  } else {
    fail(
      "IS10 chain pointers",
      `chain corrupted — C1.by=${c1Row?.superseded_by} C2.by=${c2Row?.superseded_by} C3.by=${c3Row?.superseded_by}`,
    );
  }
}

// ── IS11: Non-existent UUID in supersedes — must not error ───────────────
async function is11_nonexistent_uuid() {
  header("IS11 · supersedes=[<non-existent UUID>] — must succeed, no side effects");

  const r = await saveInsight(`D nonexistent-uuid ${D_PHRASE}`, "supersedes a UUID that doesn't exist", [
    NONEXISTENT_UUID,
  ]);
  if (r.err) {
    fail("IS11 save D", `unexpected error on bogus supersedes — ${r.err} (status ${r.status})`);
    return;
  }
  dId = r.id;
  ok("IS11 save D", `D ${dId.slice(0, 8)}… created even with non-existent UUID in supersedes`);

  // Sanity: D is active.
  const dRow = await findRow(dId, false);
  if (dRow && (dRow.superseded_by ?? null) === null) {
    ok("IS11 D active", "D is active in default list — bogus supersedes was correctly ignored");
  } else {
    fail("IS11 D active", `D should be active — got ${JSON.stringify(dRow)}`);
  }
}

// ── IS12: Idempotent re-supersede — already-superseded rows are NOT moved ─
async function is12_idempotent_resupersede() {
  header("IS12 · Re-supersede already-superseded rows (E claims A1, A2, A3 again)");

  // A1, A2, A3 already point at B (from IS9). If E tries to supersede them,
  // the .is('superseded_by', null) guard should leave their pointers alone.
  const r = await saveInsight(`E idempotent ${E_PHRASE}`, "tries to re-claim A1, A2, A3 — should be ignored", [
    a1Id,
    a2Id,
    a3Id,
  ]);
  if (r.err) {
    fail("IS12 save E", `${r.err}`);
    return;
  }
  eId = r.id;
  ok("IS12 save E", `E ${eId.slice(0, 8)}… created with supersedes=[A1,A2,A3] (already superseded by B)`);

  // The critical assertion: A1, A2, A3 must STILL point at B, NOT at E.
  const a1Row = await findRow(a1Id, true);
  const a2Row = await findRow(a2Id, true);
  const a3Row = await findRow(a3Id, true);
  if (a1Row?.superseded_by === bId && a2Row?.superseded_by === bId && a3Row?.superseded_by === bId) {
    ok("IS12 idempotent guard", "A1/A2/A3 still point at B — re-supersede did NOT corrupt history");
  } else {
    fail(
      "IS12 idempotent guard",
      `history was corrupted by re-supersede — A1=${a1Row?.superseded_by} A2=${a2Row?.superseded_by} A3=${a3Row?.superseded_by} (expected all = B ${bId})`,
    );
  }
}

// ── IS13: Final comprehensive brief check ───────────────────────────────
async function is13_final_brief_check() {
  header("IS13 · Final brief reflects all supersession states correctly");

  const { code, stdout } = fireHook("session-start", {
    session_id: "e2e-is-final",
    cwd: testDir,
    source: "startup",
    hook_event_name: "SessionStart",
  });
  if (code !== 0) {
    fail("IS13 hook exit", `hook exited ${code}`);
    return;
  }
  if (!stdout.includes("<synapse-brief>")) {
    fail("IS13 brief shape", "no <synapse-brief> tag");
    return;
  }
  ok("IS13 brief emitted", `${stdout.length} bytes`);

  // Active phrases must appear; superseded phrases must NOT.
  const active = [
    { name: "NEW", phrase: NEW_PHRASE },
    { name: "B (multi-supersede winner)", phrase: B_PHRASE },
    { name: "C3 (chain head)", phrase: C3_PHRASE },
    { name: "D (bogus-supersede survivor)", phrase: D_PHRASE },
    { name: "E (idempotent re-supersede attempt)", phrase: E_PHRASE },
  ];
  const superseded = [
    { name: "OLD", phrase: OLD_PHRASE },
    { name: "A1", phrase: A1_PHRASE },
    { name: "A2", phrase: A2_PHRASE },
    { name: "A3", phrase: A3_PHRASE },
    { name: "C1", phrase: C1_PHRASE },
    { name: "C2", phrase: C2_PHRASE },
  ];

  let allActivePresent = true;
  for (const a of active) {
    if (!stdout.includes(a.phrase)) {
      fail(`IS13 active: ${a.name}`, `missing from brief — phrase ${a.phrase}`);
      allActivePresent = false;
    }
  }
  if (allActivePresent) ok("IS13 active set", `all ${active.length} active phrases present in brief`);

  let allSupersededAbsent = true;
  for (const s of superseded) {
    if (stdout.includes(s.phrase)) {
      fail(`IS13 superseded: ${s.name}`, `leaked into brief — phrase ${s.phrase}`);
      allSupersededAbsent = false;
    }
  }
  if (allSupersededAbsent)
    ok("IS13 superseded set", `all ${superseded.length} superseded phrases correctly hidden from brief`);

  if (!allActivePresent || !allSupersededAbsent) {
    info(`brief tail (last 1500 chars):\n  ${stdout.slice(-1500).replace(/\n/g, "\n  ")}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  log("Synapse end-to-end INSIGHT-SUPERSESSION cross-session test");
  log(`API: ${API_BASE}`);
  log(`MCP: ${MCP_DIST}`);
  log(`RUN_ID: ${RUN_ID}`);

  if (!preflight()) process.exit(2);

  try {
    await is1_setup();
    await is2_capture_and_sync();
    await is3_resolve_project();
    if (testProjectId) {
      await is4_save_old();
      if (oldInsightId) {
        await is5_save_new_with_supersedes();
        if (newInsightId) {
          await is6_verify_api_filter();
          await is7_fire_hook();
          await is8_assert_supersession();
          await is9_multi_supersede();
          await is10_chain_supersession();
          await is11_nonexistent_uuid();
          await is12_idempotent_resupersede();
          await is13_final_brief_check();
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
    log("❌ E2E INSIGHT-SUPERSEDE FAILED.");
    process.exit(1);
  } else {
    log("✅ E2E INSIGHT-SUPERSEDE PASSED.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
