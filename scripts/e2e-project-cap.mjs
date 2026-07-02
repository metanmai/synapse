#!/usr/bin/env node
// scripts/e2e-project-cap.mjs
//
// E2E for Phase 03-02: 50-project cap on both tiers + structured 402
// PROJECT_QUOTA_EXCEEDED error code.
//
// Bug class under test: "the project-create cap silently 500s on the
// 51st create instead of returning a structured error the CLI and
// browser can render". The previous code threw a generic TIER_LIMIT
// 403; this test pins the new 402 PROJECT_QUOTA_EXCEEDED contract.
//
// Strategy:
//   1. Pre-cleanup: delete any `e2e-cap-test-*` projects from prior runs
//   2. Pre-check: count current owned projects. If > 45, skip (not
//      enough room to saturate safely without risking the user's real
//      projects).
//   3. Saturate: create (50 - currentOwned) projects to fill the cap.
//      All should return 201. Track IDs for cleanup.
//   4. Assert cap: try to create one more. MUST return 402 + body.code
//      === "PROJECT_QUOTA_EXCEEDED".
//   5. Idempotency: retry the cap-hit. MUST return the same 402 (the
//      cap is a hard fail, not a one-shot).
//   6. Free-on-delete: delete one of the saturator projects. The next
//      create MUST succeed with 201 — proving the cap frees on delete.
//   7. Final cleanup: delete all e2e-cap-test-* projects we created.
//
// Self-cleaning. Self-bounded. Asserts the BUG CLASS, not specific
// project IDs or strings.
//
// Cost: ~$0. ~50-100 API calls. Wall time ~5-10s.
//
// Exit codes:
//   0 — all phases pass (or skipped with a clear reason)
//   1 — any phase fails (assertion violated)
//   2 — preflight error (no API key, network down, etc.)

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";
const TARGET_CAP = 50;
const SAFE_HEADROOM = 45; // skip if currentOwned > this
const TEST_PREFIX = "e2e-cap-test-";

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

function readApiKey() {
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
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body
  }
  return { status: res.status, body: json, raw: text };
}

async function main() {
  header("E2E · Phase 03-02 · Project cap (50 hard, PROJECT_QUOTA_EXCEEDED)");

  const key = readApiKey();
  if (!key) {
    log("✗ No API key in env (SYNAPSE_API_KEY) or ~/.synapse/config.json");
    process.exit(2);
  }
  info(`API: ${API_BASE}`);

  // ── Stage 1: pre-cleanup ─────────────────────────────────────────────
  header("Stage 1 · Pre-cleanup (delete any e2e-cap-test-* from prior runs)");
  const listed = await api("GET", "/api/projects", key);
  if (listed.status !== 200) {
    fail("preflight", `GET /api/projects → ${listed.status}: ${listed.raw.slice(0, 120)}`);
    return;
  }
  const allProjects = listed.body ?? [];
  const ownedAll = allProjects.filter((p) => p.role === "owner");
  const leftover = ownedAll.filter((p) => typeof p.name === "string" && p.name.startsWith(TEST_PREFIX));
  if (leftover.length > 0) {
    info(`Deleting ${leftover.length} leftover test project(s)...`);
    for (const p of leftover) {
      const del = await api("DELETE", `/api/projects/${p.id}?force=true`, key);
      if (del.status !== 200 && del.status !== 404) {
        fail("pre-cleanup", `DELETE ${p.id} → ${del.status}`);
        return;
      }
    }
  }
  ok("pre-cleanup", `removed ${leftover.length} stale project(s)`);

  // ── Stage 2: pre-check ───────────────────────────────────────────────
  header("Stage 2 · Pre-check (room available)");
  const recheck = await api("GET", "/api/projects", key);
  const currentOwned = (recheck.body ?? []).filter((p) => p.role === "owner").length;
  info(`current owned: ${currentOwned}`);
  if (currentOwned > SAFE_HEADROOM) {
    skip(`account has ${currentOwned} owned projects (> ${SAFE_HEADROOM}). Manual cleanup required first.`);
    info("Run the dashboard cleanup, or `synapsesync purge-empty`, then re-run this test.");
    return;
  }
  ok("pre-check", `${TARGET_CAP - currentOwned} slots available to saturate`);

  // ── Stage 3: saturate until cap fires ───────────────────────────────
  // Note: backend's countOwnedProjects queries `projects.owner_id` directly
  // while listProjectsForUser joins project_members. These can diverge if
  // an account has orphan owner-id rows (owner_id set but no membership
  // row — a data inconsistency from older schema migrations). The cap
  // counts the projects-table view, the listing shows the memberships
  // view. So the saturation budget can be less than (50 - visibleOwned).
  // We saturate empirically — POST until we get the FIRST 402, which IS
  // the cap-firing event we want to validate.
  header(`Stage 3 · Saturate (POST until 402, budget ≤ ${TARGET_CAP - currentOwned + 5})`);
  const created = [];
  let overflow = null;
  // budget = visible headroom + small slack for hidden owner-id rows
  const SATURATION_BUDGET = TARGET_CAP - currentOwned + 5;
  for (let i = 0; i < SATURATION_BUDGET; i++) {
    const name = `${TEST_PREFIX}${Date.now()}-${i}`;
    const r = await api("POST", "/api/projects", key, { name });
    if (r.status === 201) {
      created.push(r.body.id);
      continue;
    }
    if (r.status === 402) {
      // Cap fired — this is the response we want to validate in Stage 4.
      overflow = r;
      break;
    }
    fail("saturate", `unexpected status ${r.status} on attempt ${i + 1}: ${JSON.stringify(r.body).slice(0, 120)}`);
    for (const p of created) await api("DELETE", `/api/projects/${p}?force=true`, key);
    return;
  }
  if (!overflow) {
    fail(
      "saturate",
      `cap never fired after ${SATURATION_BUDGET} successful creates — backend cap may be misconfigured or higher than expected`,
    );
    for (const p of created) await api("DELETE", `/api/projects/${p}?force=true`, key);
    return;
  }
  ok("saturate", `${created.length} created, cap fired on attempt ${created.length + 1}`);

  // ── Stage 4: assert structured cap error (from the first 402 above) ─
  header("Stage 4 · Cap fires with structured 402 PROJECT_QUOTA_EXCEEDED");
  if (overflow.status !== 402) {
    fail("cap-status", `expected 402, got ${overflow.status} (body=${JSON.stringify(overflow.body).slice(0, 120)})`);
  } else {
    ok("cap-status", "status 402");
  }
  if (overflow.body?.code !== "PROJECT_QUOTA_EXCEEDED") {
    fail("cap-code", `expected body.code='PROJECT_QUOTA_EXCEEDED', got ${overflow.body?.code ?? "(missing)"}`);
  } else {
    ok("cap-code", "body.code = PROJECT_QUOTA_EXCEEDED");
  }
  if (typeof overflow.body?.error !== "string" || overflow.body.error.length === 0) {
    fail("cap-message", "expected non-empty body.error string for user-facing message");
  } else {
    ok("cap-message", `body.error: "${overflow.body.error.slice(0, 60)}..."`);
  }

  // ── Stage 5: idempotency at the boundary ────────────────────────────
  header("Stage 5 · Idempotent (retry still 402, not flaky)");
  const overflow2 = await api("POST", "/api/projects", key, { name: `${TEST_PREFIX}overflow-2` });
  if (overflow2.status === 402 && overflow2.body?.code === "PROJECT_QUOTA_EXCEEDED") {
    ok("idempotent", "second 51st-create attempt also 402 PROJECT_QUOTA_EXCEEDED");
  } else {
    fail("idempotent", `retry returned ${overflow2.status} code=${overflow2.body?.code ?? "(missing)"}`);
  }

  // ── Stage 6: free-on-delete ─────────────────────────────────────────
  header("Stage 6 · Free-on-delete (next create succeeds after one delete)");
  const victim = created.pop();
  const del = await api("DELETE", `/api/projects/${victim}?force=true`, key);
  if (del.status !== 200) {
    fail("free-on-delete", `delete ${victim} → ${del.status}`);
  } else {
    const retry = await api("POST", "/api/projects", key, { name: `${TEST_PREFIX}post-delete` });
    if (retry.status === 201) {
      created.push(retry.body.id);
      ok("free-on-delete", "deleted one, next create returned 201");
    } else {
      fail("free-on-delete", `post-delete create returned ${retry.status}`);
    }
  }

  // ── Stage 7: final cleanup ──────────────────────────────────────────
  header("Stage 7 · Cleanup (delete all e2e-cap-test-* we created)");
  let deleted = 0;
  for (const id of created) {
    const r = await api("DELETE", `/api/projects/${id}?force=true`, key);
    if (r.status === 200 || r.status === 404) deleted++;
  }
  ok("cleanup", `deleted ${deleted}/${created.length} test project(s)`);

  // Verify zero leak by listing again
  const final = await api("GET", "/api/projects", key);
  const remaining = (final.body ?? []).filter((p) => typeof p.name === "string" && p.name.startsWith(TEST_PREFIX));
  if (remaining.length > 0) {
    fail("zero-leak", `${remaining.length} e2e-cap-test-* project(s) survived cleanup`);
  } else {
    ok("zero-leak", "no test artifacts remaining on account");
  }

  header(process.exitCode ? "❌ FAILED" : "✅ ALL STAGES PASSED");
}

main().catch((e) => {
  log(`\n✗ Unhandled error: ${e instanceof Error ? e.stack : e}`);
  process.exit(2);
});
