#!/usr/bin/env node
// scripts/e2e-insight-cap.mjs
//
// E2E for Phase 03-04: per-project insight cap (Free LRU + Plus LLM-consolidate).
//
// Two parts (each skipped if the corresponding API key isn't available):
//
//   PART A — Free LRU at 10
//   1. Create a test project on a FREE account
//   2. POST 10 insights; all 201
//   3. POST the 11th; 201 (eviction happens silently pre-insert)
//   4. List active insights; count == 10. The first-created insight is gone.
//   5. Cleanup project (cascades).
//
//   PART B — Plus LLM consolidation at 50
//   1. Create a test project on a PLUS account
//   2. POST 50 insights; all 201
//   3. POST the 51st; 201 IMMEDIATELY (ctx.waitUntil runs in background)
//   4. Poll for up to 30s until active count drops to ≤ cap.
//      The drop proves consolidation fired and supersession stamped.
//   5. Verify some of the new replacements have source.type === "consolidation"
//   6. Cleanup project (cascades).
//
// Skip rules:
//   - Account is on Plus but only SYNAPSE_E2E_FREE_API_KEY is set: skip PART A
//   - Account is on Free but only SYNAPSE_E2E_PLUS_API_KEY is set: skip PART B
//   - Neither key set: fall back to the user's default key; only the part
//     matching the user's actual tier runs (the other auto-skips on tier check)
//
// Cost: Free portion ~$0 (no LLM). Plus portion ~$0.001 (one Haiku call).
// Wall time: ~30s combined.
//
// Exit codes:
//   0 — all enabled parts pass (or were skipped with a reason)
//   1 — any phase fails
//   2 — preflight error

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";
const FREE_INSIGHT_CAP = 10;
const PLUS_INSIGHT_CAP = 50;
const PLUS_POLL_TIMEOUT_MS = 30_000;
const PLUS_POLL_INTERVAL_MS = 2_000;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}
function header(s) {
  log("\n════════════════════════════════════════════════════════════════════");
  log(s);
  log("════════════════════════════════════════════════════════════════════");
}
function ok(stage, detail) {
  log(`  ✅ PASS · ${stage} · ${detail}`);
}
function fail(stage, detail) {
  log(`  ❌ FAIL · ${stage} · ${detail}`);
  process.exitCode = 1;
}
function info(s) {
  log(`  · ${s}`);
}
function skip(s) {
  log(`  ⏭  SKIP · ${s}`);
}

function defaultApiKey() {
  if (process.env.SYNAPSE_API_KEY) return process.env.SYNAPSE_API_KEY;
  const cfgPath = path.join(homedir(), ".synapse", "config.json");
  if (!existsSync(cfgPath)) return null;
  try {
    return JSON.parse(readFileSync(cfgPath, "utf-8")).api_key ?? null;
  } catch {
    return null;
  }
}

async function api(method, pathStr, key, body) {
  const res = await fetch(`${API_BASE}${pathStr}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON
  }
  return { status: res.status, body: json, raw: text };
}

async function getTier(key) {
  const r = await api("GET", "/api/billing/status", key);
  if (r.status !== 200) return null;
  return r.body?.tier ?? null;
}

async function createTestProject(key, prefix) {
  const r = await api("POST", "/api/projects", key, { name: `${prefix}-${Date.now()}` });
  if (r.status !== 201) {
    throw new Error(`createTestProject ${prefix} → ${r.status}: ${r.raw.slice(0, 120)}`);
  }
  return r.body.id;
}

async function deleteProjectForce(key, projectId) {
  await api("DELETE", `/api/projects/${projectId}?force=true`, key);
}

async function listActiveInsights(key, projectId) {
  // Need the COUNT of active (non-superseded). The list endpoint returns
  // both the array and a total count.
  const r = await api("GET", `/api/insights?project_id=${projectId}&limit=200`, key);
  return {
    insights: r.body?.insights ?? [],
    total: r.body?.total ?? 0,
  };
}

// ────────────────────────────────────────────────────────────────────
// PART A — Free LRU
// ────────────────────────────────────────────────────────────────────
async function runFreePart(key) {
  header("PART A · Free LRU at 10 insights");
  const tier = await getTier(key);
  if (tier !== "free") {
    skip(`account is on '${tier}'; PART A requires Free`);
    return;
  }

  let projectId;
  try {
    projectId = await createTestProject(key, "e2e-insight-cap-free");
  } catch (e) {
    fail("setup", e.message);
    return;
  }
  info(`project: ${projectId}`);

  try {
    // Saturate
    const firstId = await postInsight(key, projectId, "decision", "free-0", "first");
    const restIds = [];
    for (let i = 1; i < FREE_INSIGHT_CAP; i++) {
      const id = await postInsight(key, projectId, "decision", `free-${i}`, null);
      restIds.push(id);
      await new Promise((r) => setTimeout(r, 15)); // ensure distinct updated_at
    }

    const atCap = await listActiveInsights(key, projectId);
    if (atCap.total !== FREE_INSIGHT_CAP) {
      fail("saturate", `expected ${FREE_INSIGHT_CAP} active, got ${atCap.total}`);
      return;
    }
    ok("saturate", `${atCap.total} active insights`);

    // Overflow — should evict firstId silently
    const overflowId = await postInsight(key, projectId, "decision", "free-overflow", null);

    const post = await listActiveInsights(key, projectId);
    if (post.total !== FREE_INSIGHT_CAP) {
      fail("eviction-count", `expected ${FREE_INSIGHT_CAP} after eviction, got ${post.total}`);
      return;
    }
    ok("eviction-count", `still ${post.total} active`);

    const survivingIds = new Set(post.insights.map((i) => i.id));
    if (survivingIds.has(firstId)) {
      fail("eviction-oldest", `oldest insight (id=${firstId}) survived`);
      return;
    }
    ok("eviction-oldest", "oldest insight was evicted");
    if (!survivingIds.has(overflowId)) {
      fail("eviction-newest", `new 11th insight (id=${overflowId}) is missing`);
      return;
    }
    ok("eviction-newest", "new 11th insight is present");
  } finally {
    await deleteProjectForce(key, projectId);
    info(`cleaned up project ${projectId}`);
  }
}

async function postInsight(key, projectId, type, summary, detail) {
  const r = await api("POST", "/api/insights", key, {
    project_id: projectId,
    type,
    summary,
    ...(detail ? { detail } : {}),
  });
  if (r.status !== 201) {
    throw new Error(`POST /api/insights → ${r.status}: ${r.raw.slice(0, 120)}`);
  }
  return r.body.id;
}

// ────────────────────────────────────────────────────────────────────
// PART B — Plus LLM consolidation
// ────────────────────────────────────────────────────────────────────
async function runPlusPart(key) {
  header("PART B · Plus LLM consolidation at 50 insights");
  const tier = await getTier(key);
  if (tier !== "plus") {
    skip(`account is on '${tier}'; PART B requires Plus`);
    return;
  }

  let projectId;
  try {
    projectId = await createTestProject(key, "e2e-insight-cap-plus");
  } catch (e) {
    fail("setup", e.message);
    return;
  }
  info(`project: ${projectId}`);

  try {
    // Saturate to PLUS cap (50) — this is the expensive part
    info(`creating ${PLUS_INSIGHT_CAP} insights (this takes a few seconds)...`);
    for (let i = 0; i < PLUS_INSIGHT_CAP; i++) {
      await postInsight(key, projectId, "decision", `plus-${i}`, `detail-${i}`);
      // No sleep — we want to write fast; updated_at ordering is by insert time
    }

    const atCap = await listActiveInsights(key, projectId);
    if (atCap.total !== PLUS_INSIGHT_CAP) {
      fail("saturate", `expected ${PLUS_INSIGHT_CAP} active, got ${atCap.total}`);
      return;
    }
    ok("saturate", `${atCap.total} active insights`);

    // Trigger overflow — POST returns 201 IMMEDIATELY; consolidation runs in background
    const overflowStart = Date.now();
    await postInsight(key, projectId, "decision", "plus-overflow-trigger", "should trigger consolidation");
    const overflowLatencyMs = Date.now() - overflowStart;
    if (overflowLatencyMs > 5000) {
      fail("overflow-non-blocking", `POST took ${overflowLatencyMs}ms — should NOT block on LLM`);
      // continue — the count assertion is what matters
    } else {
      ok("overflow-non-blocking", `POST returned in ${overflowLatencyMs}ms (non-blocking confirmed)`);
    }

    // Poll for the active count to drop. ctx.waitUntil runs the consolidation
    // after the response; expect it to complete within ~5-30s depending on
    // Anthropic latency.
    const pollStart = Date.now();
    let final = null;
    while (Date.now() - pollStart < PLUS_POLL_TIMEOUT_MS) {
      const r = await listActiveInsights(key, projectId);
      if (r.total <= PLUS_INSIGHT_CAP) {
        final = r;
        break;
      }
      await new Promise((res) => setTimeout(res, PLUS_POLL_INTERVAL_MS));
    }

    if (!final) {
      fail(
        "consolidation-drop",
        `active count never dropped to ≤${PLUS_INSIGHT_CAP} within ${PLUS_POLL_TIMEOUT_MS / 1000}s — consolidation didn't fire (or LLM failed)`,
      );
      return;
    }
    const elapsedSec = ((Date.now() - pollStart) / 1000).toFixed(1);
    ok("consolidation-drop", `active count dropped to ${final.total} within ${elapsedSec}s`);

    // Verify some of the visible insights have source.type === "consolidation"
    const consolidations = final.insights.filter((i) => {
      try {
        const src = typeof i.source === "string" ? JSON.parse(i.source) : i.source;
        return src?.type === "consolidation";
      } catch {
        return false;
      }
    });
    if (consolidations.length === 0) {
      fail("consolidation-source", "no insights with source.type='consolidation' visible after drop");
      return;
    }
    ok("consolidation-source", `${consolidations.length} replacement(s) tagged source.type='consolidation'`);
  } finally {
    await deleteProjectForce(key, projectId);
    info(`cleaned up project ${projectId}`);
  }
}

async function main() {
  header("E2E · Phase 03-04 · Insight cap (Free LRU + Plus LLM-consolidate)");

  const freeKey = process.env.SYNAPSE_E2E_FREE_API_KEY ?? null;
  const plusKey = process.env.SYNAPSE_E2E_PLUS_API_KEY ?? null;
  const defaultKey = defaultApiKey();

  if (!freeKey && !plusKey && !defaultKey) {
    log(
      "✗ No API key found (SYNAPSE_API_KEY, SYNAPSE_E2E_FREE_API_KEY, SYNAPSE_E2E_PLUS_API_KEY, or ~/.synapse/config.json)",
    );
    process.exit(2);
  }

  info(`API: ${API_BASE}`);

  // Run PART A with Free key (or default if no explicit Free key)
  const aKey = freeKey ?? defaultKey;
  if (aKey) await runFreePart(aKey);

  // Run PART B with Plus key (or default if no explicit Plus key)
  const bKey = plusKey ?? defaultKey;
  if (bKey) await runPlusPart(bKey);

  header(process.exitCode ? "❌ FAILED" : "✅ ALL ENABLED PARTS PASSED");
}

main().catch((e) => {
  log(`\n✗ Unhandled error: ${e instanceof Error ? e.stack : e}`);
  process.exit(2);
});
