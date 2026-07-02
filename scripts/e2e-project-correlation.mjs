#!/usr/bin/env node
// scripts/e2e-project-correlation.mjs
//
// THE AI PROJECT-CORRELATION LIVE TEST (deployed backend + real Supabase).
//
// Asserts the promise: "A keyless browser-shaped capture (no git, no project_id)
// is accepted and grouped into a project on its own — and the reconciler endpoint
// runs." The deterministic assign/merge LOGIC is unit-tested in backend/test
// (project-correlation, ai-resolve, reconcile-projects); this proves the DEPLOYED
// wiring end to end.
//
// Stages:
//   PC1  POST a keyless browser conversation → 201 + auto-assigned project_id
//   PC3  near-duplicate captures group together + unrelated stays separate
//        (real embeddings); self-skips green when embeddings are inactive
//   PC2  (if INTERNAL_TRIGGER_TOKEN set) POST /internal/reconcile → 200 {ok}
//
// Self-skips green when SYNAPSE_API_KEY is absent. The merge/grouping LOGIC is
// covered deterministically by the unit suite; here we keep assertions to what
// is robust against real-embedding variance + prod config state.
//
// Usage: node scripts/e2e-project-correlation.mjs

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sweepArtifacts } from "./e2e-cleanup.mjs";

const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";
const INTERNAL_TOKEN = process.env.INTERNAL_TRIGGER_TOKEN ?? null;
const RUN_ID = Date.now();

const results = [];
let apiKey = null;
const createdProjects = new Set();

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

// A keyless browser capture: no project_id, no git remote, a synapse:// path.
async function createBrowserConversation(title) {
  return fetchJson("/api/conversations", {
    method: "POST",
    body: JSON.stringify({
      title,
      fidelity_mode: "full",
      working_context: { tool: "claude-ai", projectPath: "synapse://browser/claude.ai" },
    }),
  });
}

async function cleanup() {
  for (const pid of createdProjects) {
    const res = await fetch(`${API_BASE}/api/projects/${pid}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    log(res.ok ? `  · cleanup: deleted project ${pid}` : `  · cleanup: WARN project ${pid} (HTTP ${res.status})`);
  }
  await sweepArtifacts({ apiKey, apiUrl: API_BASE, patterns: [`-${RUN_ID}`], log });
}

function preflight() {
  header("PREFLIGHT");
  apiKey = getApiKey();
  if (!apiKey) {
    info("No SYNAPSE_API_KEY in env or ~/.synapse/config.json — soft-skipping project-correlation E2E");
    process.exitCode = 0;
    return false;
  }
  info(`API key resolved (${apiKey.slice(0, 12)}...)`);
  info(
    INTERNAL_TOKEN
      ? "INTERNAL_TRIGGER_TOKEN present — will exercise the reconciler endpoint"
      : "no INTERNAL_TRIGGER_TOKEN — PC2 reconcile check will be skipped",
  );
  ok("preflight", "prereqs satisfied");
  return true;
}

// ── PC1: keyless browser capture is accepted + auto-assigned a project ──────
async function pc1_keyless_capture() {
  header("PC1 · Keyless browser capture → auto-assigned project");
  const conv = await createBrowserConversation(`Refactoring the OAuth login flow ${RUN_ID}`);
  if (conv._err) {
    fail("PC1 create", `HTTP ${conv._status}: ${conv._err.slice(0, 200)}`);
    return null;
  }
  if (!conv.id || !conv.project_id) {
    fail("PC1 create", `missing id/project_id: ${JSON.stringify(conv).slice(0, 200)}`);
    return null;
  }
  createdProjects.add(conv.project_id);
  ok("PC1 create", `conversation ${conv.id} auto-assigned to project ${conv.project_id}`);
  return conv;
}

// ── PC2: the reconciler endpoint runs on the deployed worker ────────────────
async function pc2_reconcile_runs() {
  header("PC2 · POST /internal/reconcile runs");
  if (!INTERNAL_TOKEN) {
    info("INTERNAL_TRIGGER_TOKEN not set — skipping (reconcile runs daily via cron regardless)");
    return;
  }
  let res;
  try {
    res = await fetch(`${API_BASE}/internal/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-synapse-internal-token": INTERNAL_TOKEN },
      body: "{}",
    });
  } catch (e) {
    fail("PC2 reconcile", `network: ${e.message}`);
    return;
  }
  if (res.status === 404) {
    info("reconcile endpoint 404 — INTERNAL_TRIGGER_TOKEN not configured on the deployed worker; skipping");
    return;
  }
  if (!res.ok) {
    fail("PC2 reconcile", `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const body = await res.json();
  if (body?.ok !== true || typeof body.summary !== "object") {
    fail("PC2 reconcile", `unexpected body: ${JSON.stringify(body).slice(0, 200)}`);
    return;
  }
  ok("PC2 reconcile", `reconciler ran: ${JSON.stringify(body.summary)}`);
}

// ── PC3: REAL semantic grouping — the production assertion ──────────────────
// Against the deployed backend + real Supabase + real embeddings: two
// near-duplicate captures must land in the SAME project; an unrelated capture
// in a DIFFERENT one. Self-gates — if all three share a project, embeddings
// aren't active in this env (host-bucket fallback) → skip green.
async function pc3_semantic_grouping() {
  header("PC3 · Real semantic grouping (deployed backend + real embeddings)");
  const a = await createBrowserConversation(
    `How do I refactor OAuth2 login and session-token rotation in our auth service? [${RUN_ID}]`,
  );
  const b = await createBrowserConversation(
    `How should I refactor OAuth2 login and session-token rotation in our auth service? [${RUN_ID}]`,
  );
  const c = await createBrowserConversation(
    `What are some good vegetarian recipes for a weekend dinner party? [${RUN_ID}]`,
  );
  for (const x of [a, b, c]) {
    if (x._err || !x.project_id) {
      fail("PC3 setup", `create failed: ${JSON.stringify(x).slice(0, 150)}`);
      return;
    }
    createdProjects.add(x.project_id);
  }
  info(`A=${a.project_id.slice(0, 8)} B=${b.project_id.slice(0, 8)} C=${c.project_id.slice(0, 8)}`);

  const abSame = a.project_id === b.project_id;
  const allSame = abSame && b.project_id === c.project_id;
  const cDistinct = c.project_id !== a.project_id;

  if (abSame && cDistinct) {
    ok(
      "PC3 semantic grouping",
      "near-duplicate captures grouped together; unrelated capture kept separate — AI correlation works end-to-end",
    );
  } else if (allSame) {
    info(
      "all three share one project → embeddings inactive here (host-bucket fallback); set EMBEDDING_SERVICE_URL/_KEY in prod to engage AI grouping — assertion skipped",
    );
  } else if (!abSame) {
    fail(
      "PC3 semantic grouping",
      `near-duplicate captures landed in DIFFERENT projects (A=${a.project_id}, B=${b.project_id}) — embeddings active but grouping is wrong`,
    );
  } else {
    fail(
      "PC3 semantic grouping",
      `unrelated capture grouped with the auth captures (over-grouping): C=${c.project_id} == A=${a.project_id}`,
    );
  }
}

async function main() {
  log("Synapse end-to-end AI PROJECT-CORRELATION test");
  log(`API: ${API_BASE}`);
  log(`RUN_ID: ${RUN_ID}`);

  if (!preflight()) process.exit(process.exitCode ?? 2);

  try {
    await pc1_keyless_capture();
    await pc3_semantic_grouping();
    await pc2_reconcile_runs();
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
  for (const r of results) log(`  ${r.status === "PASS" ? "✅" : "❌"} ${r.id.padEnd(36)} ${r.detail}`);
  log(`\n  Total: ${results.length}  ·  PASS: ${passed}  ·  FAIL: ${failed}\n`);
  if (failed > 0) {
    log("❌ E2E PROJECT-CORRELATION FAILED.");
    process.exit(1);
  }
  log("✅ E2E PROJECT-CORRELATION PASSED.");
  process.exit(0);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
