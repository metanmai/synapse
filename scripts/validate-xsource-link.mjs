#!/usr/bin/env node
// LOCAL validation: cross-source project auto-link.
//
// Scenario (the marquee promise):
//   1. A browser chat gives some project context (keyless capture, no git).
//   2. A local agent (Claude Code) works on the SAME project (creates project X).
//   3. The backend auto-links the browser capture into project X.
//
// What's REAL here: the embedding service (real nomic-embed-text-v1.5), the
// cosine metric pgvector's match_conversations uses, and the SHIPPED
// decideAssignment + thresholds imported straight from backend/src. What's
// MOCKED: only the browser payload text (synthesized) and the DB round-trip —
// the match_conversations / find_merge_candidates SQL is validated separately
// against real pgvector by scripts/test-pgvector-rpcs.mjs.
//
// Usage: node scripts/validate-xsource-link.mjs   (run from repo root)

import { spawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { PROJECT_ASSIGN_THRESHOLD, PROJECT_CREATE_THRESHOLD } from "../backend/src/lib/constants.ts";
import { decideAssignment } from "../backend/src/lib/project-correlation.ts";

const PORT = 8123;
const KEY = "xsrc-validate-key";
const BASE = `http://127.0.0.1:${PORT}`;
const log = (m) => process.stdout.write(`${m}\n`);

// The local agent's project (as if created deterministically from a git repo).
const PROJECT_X = "11111111-1111-1111-1111-111111111111";

// ── the three captures ──────────────────────────────────────────────────────
// LOCAL AGENT capture (Claude Code, in a git repo → deterministically project X):
const localAgent =
  "Claude Code session in the auth-service repo: implemented the OAuth2 " +
  "authorization-code flow with PKCE, added refresh-token rotation, and fixed " +
  "the session cookie SameSite=None bug so login works cross-site. Also wired " +
  "token revocation on logout.";

// BROWSER capture (claude.ai, keyless) about the SAME work, phrased differently:
const browserSameProject =
  "Chat on claude.ai: How should I design OAuth2 login with refresh-token " +
  "rotation for our web auth service? And what SameSite value should the " +
  "session cookie use so the login flow works across sites?";

// BROWSER capture (keyless) about something UNRELATED — negative control:
const browserUnrelated =
  "Chat on claude.ai: What are some good vegetarian recipes for a weekend " +
  "dinner party, and how do I make a decent risotto?";

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embed(text) {
  // aiResolveProject embeds the seed as "search_document"; stored conversation
  // embeddings use the same type, so cosine is document-vs-document — mirror that.
  const r = await fetch(`${BASE}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ texts: [text], type: "search_document" }),
  });
  if (!r.ok) throw new Error(`/embed ${r.status}: ${await r.text()}`);
  return (await r.json()).embeddings[0];
}

async function waitHealth(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      const j = await r.json();
      if (j.status === "ok") return true;
    } catch {}
    await new Promise((res) => setTimeout(res, 1000));
  }
  return false;
}

async function main() {
  log("Cross-source auto-link validation (real embeddings + shipped decideAssignment)");
  log(`thresholds: ASSIGN(confident) ≥ ${PROJECT_ASSIGN_THRESHOLD}, link ≥ CREATE ${PROJECT_CREATE_THRESHOLD}\n`);

  const svcLog = openSync("/tmp/xsrc-svc.log", "w");
  const svc = spawn("python3", ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: "embedding-service",
    env: { ...process.env, EMBED_API_KEY: KEY },
    stdio: ["ignore", svcLog, svcLog],
  });

  let code = 1;
  try {
    log("· starting embedding service (loading cached nomic model)…");
    if (!(await waitHealth(120_000))) throw new Error("embedding service did not become healthy in 120s");
    log("· service healthy\n");

    // Sequential, not Promise.all — the model serves one encode at a time;
    // concurrent requests to the dev server can 500 on the shared model.
    const eLocal = await embed(localAgent);
    const eSame = await embed(browserSameProject);
    const eUnrel = await embed(browserUnrelated);

    const simSame = cosine(eSame, eLocal);
    const simUnrel = cosine(eUnrel, eLocal);

    const th = { assign: PROJECT_ASSIGN_THRESHOLD, create: PROJECT_CREATE_THRESHOLD };
    // Mirror aiResolveProject: match_conversations rows → per-project best score →
    // decideAssignment. Each browser capture is matched against project X (the
    // local agent's conversation is the only candidate row).
    const decSame = decideAssignment([{ projectId: PROJECT_X, score: simSame }], th);
    const decUnrel = decideAssignment([{ projectId: PROJECT_X, score: simUnrel }], th);

    log(`browser(same project)  ↔ local-agent  cosine = ${simSame.toFixed(4)}  →  ${JSON.stringify(decSame)}`);
    log(`browser(unrelated)     ↔ local-agent  cosine = ${simUnrel.toFixed(4)}  →  ${JSON.stringify(decUnrel)}\n`);

    let pass = 0;
    let fail = 0;
    const chk = (cond, msg) => {
      if (cond) {
        log(`  ✅ ${msg}`);
        pass++;
      } else {
        log(`  ❌ ${msg}`);
        fail++;
      }
    };

    chk(
      decSame.action === "assign" && decSame.projectId === PROJECT_X,
      `same-project browser capture LINKS to the local agent's project X (action=${decSame.action})`,
    );
    chk(
      simSame >= PROJECT_ASSIGN_THRESHOLD,
      `same-project similarity ${simSame.toFixed(4)} clears the CONFIDENT assign band (≥ ${PROJECT_ASSIGN_THRESHOLD})${
        simSame >= PROJECT_CREATE_THRESHOLD && simSame < PROJECT_ASSIGN_THRESHOLD
          ? " — note: would link but flag ambiguous for reconciler recheck"
          : ""
      }`,
    );
    chk(
      decUnrel.action === "create",
      `unrelated browser capture does NOT link — starts its own project (action=${decUnrel.action})`,
    );
    chk(
      simUnrel < PROJECT_CREATE_THRESHOLD,
      `unrelated similarity ${simUnrel.toFixed(4)} stays below CREATE threshold (< ${PROJECT_CREATE_THRESHOLD})`,
    );

    log(`\n  Total: ${pass + fail}  ·  PASS: ${pass}  ·  FAIL: ${fail}`);
    code = fail === 0 ? 0 : 1;
    log(code === 0 ? "\n✅ CROSS-SOURCE AUTO-LINK VALIDATED." : "\n❌ CROSS-SOURCE AUTO-LINK: FAILURES.");
  } catch (e) {
    log(`\n🚨 ${e.message}`);
    try {
      log("--- embedding service log (tail) ---");
      log(readFileSync("/tmp/xsrc-svc.log", "utf8").split("\n").slice(-25).join("\n"));
    } catch {}
    code = 2;
  } finally {
    svc.kill("SIGTERM");
  }
  process.exit(code);
}

main();
