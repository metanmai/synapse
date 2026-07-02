#!/usr/bin/env node
// scripts/e2e-conversation-lru.mjs
//
// E2E for Phase 03-03: per-project conversation LRU on Free.
//
// Bug class under test: "the conversation cap fires at the wrong moment
// (after-insert instead of before), evicts the wrong row (newest instead
// of oldest by updated_at), or evicts loudly (alerts the user)". The
// design says: BEFORE-insert silent eviction, oldest-by-updated_at,
// cascade-delete the messages.
//
// Strategy:
//   1. Pre-cleanup: delete any e2e-lru-conv-* leftover projects
//   2. Pre-check: account must be on Free tier (otherwise the eviction
//      branch never fires; we skip with a clear note)
//   3. Setup: create a dedicated test project (so we control its
//      conversation set independently)
//   4. Saturate: create 10 conversations (named e2e-lru-conv-{i}), record
//      IDs in insertion order. All must succeed.
//   5. Assert at cap: GET conversations → count == 10
//   6. Eviction: create the 11th. List → count still == 10. The ORIGINAL
//      FIRST conversation (e2e-lru-conv-0, oldest updated_at at the time
//      of eviction) must be GONE. e2e-lru-conv-1 through e2e-lru-conv-10
//      must all be present.
//   7. Write-bumps-updated_at: append a message to e2e-lru-conv-1 (now
//      the oldest). Then create e2e-lru-conv-11. List → e2e-lru-conv-2
//      must be the evicted one (because conv-1 just got bumped past it),
//      conv-1 survives.
//   8. Cleanup: delete the test project (cascades to all conversations
//      + messages)
//
// Skip rules:
//   - Account is on Plus: skip the eviction-firing stages (cap is 50,
//     not 10; saturating is out of scope for this slice)
//   - GET /api/projects fails: error exit
//
// Self-cleaning, self-bounded, bug-class assertions (not magic strings).
//
// Cost: ~$0. ~25 API calls. Wall time ~10s.
//
// Exit codes:
//   0 — all phases pass (or skipped with a reason)
//   1 — any phase fails (assertion violated)
//   2 — preflight error

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";
const FREE_CONV_CAP = 10;
const PREFIX = "e2e-lru-conv-";
const TEST_PROJECT_NAME = `e2e-lru-test-${Date.now()}`;

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

async function main() {
  header("E2E · Phase 03-03 · Conversation LRU on Free (cap=10)");

  const key = readApiKey();
  if (!key) {
    log("✗ No API key (SYNAPSE_API_KEY env or ~/.synapse/config.json)");
    process.exit(2);
  }
  info(`API: ${API_BASE}`);

  // ── Stage 0: tier check ─────────────────────────────────────────────
  header("Stage 0 · Tier check (Free required for LRU branch to fire)");
  const billing = await api("GET", "/api/billing/status", key);
  if (billing.status !== 200) {
    fail("preflight", `GET /api/billing/status → ${billing.status}`);
    return;
  }
  const tier = billing.body?.tier ?? "unknown";
  info(`tier: ${tier}`);
  if (tier !== "free") {
    skip(`account is on ${tier}; LRU eviction only fires on Free. Run with a Free-tier API key.`);
    return;
  }
  ok("tier-check", "account is Free");

  // ── Stage 1: pre-cleanup ────────────────────────────────────────────
  header("Stage 1 · Pre-cleanup (delete e2e-lru-test-* projects from prior runs)");
  const projList = await api("GET", "/api/projects", key);
  if (projList.status !== 200) {
    fail("preflight", `GET /api/projects → ${projList.status}`);
    return;
  }
  const leftover = (projList.body ?? []).filter(
    (p) => p.role === "owner" && typeof p.name === "string" && p.name.startsWith("e2e-lru-test-"),
  );
  for (const p of leftover) {
    await api("DELETE", `/api/projects/${p.id}?force=true`, key);
  }
  ok("pre-cleanup", `removed ${leftover.length} stale test project(s)`);

  // ── Stage 2: setup ──────────────────────────────────────────────────
  header("Stage 2 · Create dedicated test project");
  const create = await api("POST", "/api/projects", key, { name: TEST_PROJECT_NAME });
  if (create.status !== 201) {
    fail("setup", `POST /api/projects → ${create.status}: ${JSON.stringify(create.body).slice(0, 120)}`);
    return;
  }
  const projectId = create.body.id;
  ok("setup", `project ${projectId} created (name=${TEST_PROJECT_NAME})`);

  try {
    // ── Stage 3: saturate to cap ──────────────────────────────────────
    header(`Stage 3 · Saturate (create ${FREE_CONV_CAP} conversations)`);
    const convIds = [];
    for (let i = 0; i < FREE_CONV_CAP; i++) {
      const r = await api("POST", "/api/conversations", key, {
        project_id: projectId,
        title: `${PREFIX}${i}`,
      });
      if (r.status !== 201) {
        fail("saturate", `conv ${i} → ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`);
        return;
      }
      convIds.push(r.body.id);
      // Tiny sleep so updated_at timestamps differ — otherwise multiple
      // creates within the same millisecond can make ordering ambiguous.
      await new Promise((res) => setTimeout(res, 20));
    }
    ok("saturate", `${convIds.length} conversations created`);

    // Verify count at cap
    const atCap = await api("GET", `/api/conversations?project_id=${projectId}&limit=50`, key);
    const atCapCount = atCap.body?.conversations?.length ?? atCap.body?.length ?? 0;
    if (atCapCount !== FREE_CONV_CAP) {
      fail("at-cap-count", `expected ${FREE_CONV_CAP} conversations after saturation, got ${atCapCount}`);
      return;
    }
    ok("at-cap-count", `${atCapCount} conversations visible`);

    // ── Stage 4: eviction on 11th ─────────────────────────────────────
    header("Stage 4 · 11th create triggers LRU eviction (oldest gone)");
    const overflow = await api("POST", "/api/conversations", key, {
      project_id: projectId,
      title: `${PREFIX}10`, // 11th — would push count to 11 without eviction
    });
    if (overflow.status !== 201) {
      fail("eviction-create", `11th create → ${overflow.status} (cap should evict, not reject)`);
      return;
    }
    const overflowId = overflow.body.id;
    ok("eviction-create", `11th create succeeded (201), id=${overflowId}`);

    // List and verify exactly 10 still
    const post = await api("GET", `/api/conversations?project_id=${projectId}&limit=50`, key);
    const remaining = post.body?.conversations ?? post.body ?? [];
    if (!Array.isArray(remaining) || remaining.length !== FREE_CONV_CAP) {
      fail(
        "eviction-count",
        `expected ${FREE_CONV_CAP} after eviction, got ${Array.isArray(remaining) ? remaining.length : "non-array"}`,
      );
      return;
    }
    ok("eviction-count", `count back to ${FREE_CONV_CAP} (eviction fired)`);

    // The ORIGINAL FIRST conv must be GONE (oldest by updated_at at moment of eviction)
    const remainingIds = new Set(remaining.map((c) => c.id));
    if (remainingIds.has(convIds[0])) {
      fail("eviction-oldest", `oldest conversation (id=${convIds[0]}, title=${PREFIX}0) survived eviction`);
      return;
    }
    ok("eviction-oldest", `oldest (${PREFIX}0) was evicted`);

    // The 11th overflow conv must be present
    if (!remainingIds.has(overflowId)) {
      fail("eviction-newest", "newly-created 11th conversation is not in the list");
      return;
    }
    ok("eviction-newest", `newest (${PREFIX}10) is present`);

    // ── Stage 5: write-bumps-updated_at ───────────────────────────────
    header("Stage 5 · Write-bumps-updated_at (touch second-oldest → it survives next eviction)");

    // Currently the oldest is convIds[1] (since convIds[0] got evicted).
    // Append a message to it — that should bump its updated_at, making it
    // newer than convIds[2]. Next eviction should target convIds[2].
    const touch = await api("POST", `/api/conversations/${convIds[1]}/messages`, key, {
      messages: [{ role: "user", content: "touch — bump updated_at" }],
    });
    if (touch.status !== 200 && touch.status !== 201) {
      // Adapter may not be wired in this env; fall back to PATCH conversation
      const patch = await api("PATCH", `/api/conversations/${convIds[1]}`, key, { title: `${PREFIX}1-touched` });
      if (patch.status !== 200) {
        fail("touch", `neither POST messages (${touch.status}) nor PATCH (${patch.status}) succeeded`);
        return;
      }
    }
    ok("touch", `bumped updated_at for ${PREFIX}1 (now should be newer than ${PREFIX}2)`);
    await new Promise((res) => setTimeout(res, 50));

    // Now create a 12th — should evict convIds[2] (which is now the oldest)
    const overflow2 = await api("POST", "/api/conversations", key, {
      project_id: projectId,
      title: `${PREFIX}11`,
    });
    if (overflow2.status !== 201) {
      fail("eviction-2-create", `12th create → ${overflow2.status}`);
      return;
    }

    const final = await api("GET", `/api/conversations?project_id=${projectId}&limit=50`, key);
    const finalArr = final.body?.conversations ?? final.body ?? [];
    const finalIds = new Set(finalArr.map((c) => c.id));

    if (finalIds.has(convIds[2])) {
      fail("eviction-2-target", `${PREFIX}2 (now-oldest) survived second eviction`);
    } else {
      ok("eviction-2-target", `${PREFIX}2 was evicted (was the new oldest)`);
    }
    if (!finalIds.has(convIds[1])) {
      fail("touch-protects", `${PREFIX}1 was evicted despite being touched`);
    } else {
      ok("touch-protects", `${PREFIX}1 survived (touch bumped its updated_at)`);
    }
  } finally {
    // ── Stage 6: cleanup (always run) ─────────────────────────────────
    header("Stage 6 · Cleanup (delete test project — cascades to convs + messages)");
    const del = await api("DELETE", `/api/projects/${projectId}?force=true`, key);
    if (del.status === 200) {
      ok("cleanup", `test project ${projectId} deleted (cascade dropped all convs + messages)`);
    } else {
      fail("cleanup", `delete project ${projectId} → ${del.status}`);
    }
  }

  header(process.exitCode ? "❌ FAILED" : "✅ ALL STAGES PASSED");
}

main().catch((e) => {
  log(`\n✗ Unhandled error: ${e instanceof Error ? e.stack : e}`);
  process.exit(2);
});
