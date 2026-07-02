#!/usr/bin/env node
// scripts/test-pgvector-rpcs.mjs
//
// REAL pgvector test of the two AI-correlation RPCs against a real Postgres —
// not a mock. Proves the actual vector-similarity SQL behind project assignment
// (match_conversations) and merge detection (find_merge_candidates):
//   - owner-scoped kNN, similarity-threshold filtering, status filtering;
//   - cross-project merge-candidate detection with canonical pair ordering.
//
// The function bodies under test are EXTRACTED from migrations 029/030 at run
// time (not retyped) so the test can't drift from what ships. Embeddings are
// deterministic 768-dim vectors (near-identical → must group/merge; orthogonal
// → must not), so assertions are exact without depending on the nomic model.
//
// Connects by shelling `psql` (no Node pg client needed). Skips green if no
// Postgres is reachable. Locally: brew postgres. CI: a pgvector service container.
//
// Usage: node scripts/test-pgvector-rpcs.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIG = path.join(REPO, "supabase", "migrations");
const ADMIN_DB = process.env.RPC_TEST_ADMIN_DB ?? "postgres";
const TEST_DB = process.env.RPC_TEST_DB ?? "synapse_rpctest";

const results = [];
const log = (m) => process.stdout.write(`${m}\n`);
const ok = (d) => {
  results.push({ ok: true, d });
  log(`  ✅ ${d}`);
};
const fail = (d) => {
  results.push({ ok: false, d });
  log(`  ❌ ${d}`);
};

function psql(db, sql, { quiet = true } = {}) {
  const args = ["-d", db, "-v", "ON_ERROR_STOP=1", "-X"];
  if (quiet) args.push("-q");
  args.push("-c", sql);
  return execFileSync("psql", args, { encoding: "utf8" });
}
function psqlValue(db, sql) {
  return execFileSync("psql", ["-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-t", "-A", "-c", sql], {
    encoding: "utf8",
  }).trim();
}
function psqlFile(db, file) {
  return execFileSync("psql", ["-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", file], { encoding: "utf8" });
}

// Pull a `CREATE OR REPLACE FUNCTION <name> ... $$ ... $$;` block out of a migration.
function extractFunction(migrationFile, fnName) {
  const text = readFileSync(path.join(MIG, migrationFile), "utf8");
  const re = new RegExp(`CREATE OR REPLACE FUNCTION ${fnName}[\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`);
  const m = text.match(re);
  if (!m) throw new Error(`could not extract ${fnName} from ${migrationFile}`);
  return m[0];
}

// 768-dim vector literal with the given non-zero dims, e.g. vec({ 0: 1, 1: 0.05 }).
function vec(entries) {
  const a = new Array(768).fill(0);
  for (const [i, v] of Object.entries(entries)) a[Number(i)] = v;
  return `[${a.join(",")}]`;
}

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const P1 = "aaaaaaaa-0000-0000-0000-000000000001";
const P2 = "aaaaaaaa-0000-0000-0000-000000000002"; // P1 < P2 < P3 lexicographically
const P3 = "aaaaaaaa-0000-0000-0000-000000000003";
const P4 = "bbbbbbbb-0000-0000-0000-000000000004";

// A and its near-neighbours (cosine ≈ 1); B is orthogonal to A (cosine ≈ 0).
const A = vec({ 0: 1 });
const A1 = vec({ 0: 1, 1: 0.03 });
const A2 = vec({ 0: 1, 2: 0.05 });
const B = vec({ 5: 1 });

function reachable() {
  try {
    execFileSync("psql", ["-d", ADMIN_DB, "-X", "-t", "-A", "-c", "select 1"], { encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function setup() {
  psql(ADMIN_DB, `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE);`);
  psql(ADMIN_DB, `CREATE DATABASE ${TEST_DB};`);

  const tmp = mkdtempSync(path.join(tmpdir(), "rpctest-"));
  const setupSql = path.join(tmp, "setup.sql");
  writeFileSync(
    setupSql,
    [
      "CREATE EXTENSION IF NOT EXISTS vector;",
      // Minimal subset of conversations — only the columns the RPCs touch.
      `CREATE TABLE conversations (
         id uuid PRIMARY KEY,
         user_id uuid NOT NULL,
         project_id uuid NOT NULL,
         embedding vector(768),
         status text NOT NULL DEFAULT 'active'
       );`,
      extractFunction("029_conversation_embeddings.sql", "match_conversations"),
      extractFunction("030_find_merge_candidates.sql", "find_merge_candidates"),
      // Seed. Same user, A-cluster spans P1+P2 (mergeable); P3 is orthogonal.
      `INSERT INTO conversations (id, user_id, project_id, embedding, status) VALUES
         ('cccccccc-0000-0000-0000-000000000001','${U1}','${P1}','${A}'::vector,'active'),
         ('cccccccc-0000-0000-0000-000000000002','${U1}','${P1}','${A1}'::vector,'active'),
         ('cccccccc-0000-0000-0000-000000000003','${U1}','${P2}','${A2}'::vector,'active'),
         ('cccccccc-0000-0000-0000-000000000004','${U1}','${P3}','${B}'::vector,'active'),
         ('cccccccc-0000-0000-0000-000000000006','${U1}','${P1}','${A}'::vector,'deleted'),
         ('cccccccc-0000-0000-0000-000000000005','${U2}','${P4}','${A}'::vector,'active');`,
    ].join("\n\n"),
  );
  psqlFile(TEST_DB, setupSql);
  rmSync(tmp, { recursive: true, force: true });
}

function testMatchConversations() {
  log("\nmatch_conversations (owner-scoped kNN)");
  const call = `match_conversations('${A}'::vector, '${U1}'::uuid, 0.5, 20)`;

  const count = Number(psqlValue(TEST_DB, `SELECT count(*) FROM ${call};`));
  count === 3
    ? ok("returns 3 rows (U1 active + similar): c1, c2 (P1), c3 (P2)")
    : fail(`expected 3 rows, got ${count} (deleted/orthogonal/other-user not excluded?)`);

  const projects = psqlValue(
    TEST_DB,
    `SELECT string_agg(DISTINCT project_id::text, ',' ORDER BY project_id::text) FROM ${call};`,
  );
  projects === `${P1},${P2}`
    ? ok("matches only P1 + P2 — orthogonal P3 excluded, other-user U2 excluded")
    : fail(`expected projects '${P1},${P2}', got '${projects}'`);

  const top = Number(psqlValue(TEST_DB, `SELECT round(max(similarity)::numeric, 4) FROM ${call};`));
  top > 0.99 ? ok(`exact-match similarity ≈ 1 (got ${top})`) : fail(`expected top similarity > 0.99, got ${top}`);

  const leaked = psqlValue(
    TEST_DB,
    `SELECT count(*) FROM ${call} WHERE id IN ('cccccccc-0000-0000-0000-000000000005','cccccccc-0000-0000-0000-000000000006');`,
  );
  leaked === "0"
    ? ok("deleted conversation + other-user conversation never returned")
    : fail(`leaked ${leaked} excluded row(s) into results`);
}

function testFindMergeCandidates() {
  log("\nfind_merge_candidates (cross-project similarity + hysteresis pairing)");

  const rows = psqlValue(TEST_DB, `SELECT count(*) FROM find_merge_candidates('${U1}'::uuid, 0.85, 20);`);
  rows === "1"
    ? ok("exactly 1 candidate pair for U1 (P1↔P2 similar; P3 orthogonal → no pair)")
    : fail(`expected 1 pair, got ${rows}`);

  const pair = psqlValue(
    TEST_DB,
    `SELECT project_a || '|' || project_b FROM find_merge_candidates('${U1}'::uuid, 0.85, 20) LIMIT 1;`,
  );
  pair === `${P1}|${P2}`
    ? ok(`pair is canonical-ordered (project_a=${P1} < project_b=${P2})`)
    : fail(`expected '${P1}|${P2}', got '${pair}'`);

  const score = Number(
    psqlValue(TEST_DB, `SELECT round(max(score)::numeric, 4) FROM find_merge_candidates('${U1}'::uuid, 0.85, 20);`),
  );
  score >= 0.85 ? ok(`pair score ≥ MERGE threshold (got ${score})`) : fail(`expected score ≥ 0.85, got ${score}`);

  const u2 = psqlValue(TEST_DB, `SELECT count(*) FROM find_merge_candidates('${U2}'::uuid, 0.85, 20);`);
  u2 === "0"
    ? ok("U2 (single project, cross-user isolated) yields no pairs")
    : fail(`expected 0 pairs for U2, got ${u2}`);
}

function cleanup() {
  try {
    psql(ADMIN_DB, `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE);`);
  } catch {}
}

function main() {
  log("Synapse REAL pgvector RPC test (match_conversations + find_merge_candidates)");
  if (!reachable()) {
    log(`  · no Postgres reachable on '${ADMIN_DB}' — soft-skipping (set up brew postgres / a pgvector service)`);
    process.exit(0);
  }
  try {
    setup();
    testMatchConversations();
    testFindMergeCandidates();
  } catch (err) {
    fail(`harness error: ${err.message?.slice(0, 400)}`);
  } finally {
    cleanup();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  log(`\n  Total: ${results.length}  ·  PASS: ${passed}  ·  FAIL: ${failed}`);
  if (failed > 0) {
    log("❌ pgvector RPC test FAILED.");
    process.exit(1);
  }
  log("✅ pgvector RPC test PASSED.");
  process.exit(0);
}

main();
