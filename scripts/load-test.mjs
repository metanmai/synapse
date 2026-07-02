#!/usr/bin/env node
/**
 * scripts/load-test.mjs — manual pre-launch load probe.
 *
 * Why this exists: docs/LAUNCH-READINESS.md item #9 — "zero evidence
 * the backend tolerates even modest concurrent load. Today's CI
 * account-quota accident is the closest thing to a load test, and it
 * was accidental." Before the public reveal, we want at minimum a
 * sanity check that the Worker + Supabase combo doesn't fall over
 * under modest concurrency, and that p95 / p99 latency on the cheap
 * read endpoints sits where we expect (sub-second).
 *
 * What it does: fixed-concurrency worker-pool against the live API.
 * C workers drain a queue of N requests cycling through one or more
 * configured endpoints. Reports per-endpoint and aggregate latency
 * percentiles (p50/p95/p99), error rate, status-code histogram,
 * effective RPS, and wall time.
 *
 * Why worker-pool, not `Promise.all` of N: a single Promise.all is a
 * thundering herd — N requests all start in the same micro-tick, the
 * network coalesces them, and you measure burst-tolerance rather than
 * sustained concurrency. A worker-pool keeps exactly C in-flight at
 * any moment by having each worker start its next request only when
 * its previous one completes. That's what "concurrency = C" should
 * actually mean for a real load shape.
 *
 * ⚠ WARNING — generates REAL load against production. Default base
 * URL is https://api.synapsesync.app (the prod Worker, served by the
 * shared Supabase Postgres). Run this MANUALLY before public reveal.
 * NEVER wire into CI — a flaky run would burn the test account's
 * quota and would page the owner for nothing. Use a dev API key if
 * you have one; the production key is rate-limited.
 *
 * Usage:
 *   node scripts/load-test.mjs                              # 100 req, 10 conc, GET /api/projects
 *   node scripts/load-test.mjs --requests 500 --concurrency 25
 *   node scripts/load-test.mjs --endpoint GET:/api/projects --endpoint GET:/api/projects/:id/conversations
 *   SYNAPSE_API_KEY=sk_... node scripts/load-test.mjs
 *
 * Auth: SYNAPSE_API_KEY or SYNAPSE_E2E_API_KEY env var. NO config.json
 * fallback — load-testing requires deliberate intent; if you don't
 * have the env var set, the assumption is you're running this by
 * mistake.
 *
 * Exit codes:
 *   0 — completed, error rate <= 5%
 *   1 — completed, error rate > 5% (treat as failure signal)
 *   2 — preflight error (missing API key, malformed args)
 */

const DEFAULTS = {
  requests: 100,
  concurrency: 10,
  base: "https://api.synapsesync.app",
  endpoints: ["GET:/api/projects"],
};

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function header(s) {
  log("\n════════════════════════════════════════════════════════════════════");
  log(s);
  log("════════════════════════════════════════════════════════════════════");
}

function parseArgs(argv) {
  const out = { ...DEFAULTS, endpoints: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--requests") {
      out.requests = Number.parseInt(argv[++i], 10);
    } else if (a === "--concurrency") {
      out.concurrency = Number.parseInt(argv[++i], 10);
    } else if (a === "--base") {
      out.base = argv[++i];
    } else if (a === "--endpoint") {
      out.endpoints.push(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      log(
        "Usage: node scripts/load-test.mjs [--requests N] [--concurrency C] [--base URL] [--endpoint METHOD:/path]...",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  if (out.endpoints.length === 0) out.endpoints = DEFAULTS.endpoints;
  if (!Number.isFinite(out.requests) || out.requests <= 0) {
    throw new Error(`--requests must be a positive integer (got ${out.requests})`);
  }
  if (!Number.isFinite(out.concurrency) || out.concurrency <= 0) {
    throw new Error(`--concurrency must be a positive integer (got ${out.concurrency})`);
  }
  return out;
}

function loadApiKey() {
  const key = process.env.SYNAPSE_API_KEY ?? process.env.SYNAPSE_E2E_API_KEY;
  if (!key) {
    log("error: no API key found in env (SYNAPSE_API_KEY or SYNAPSE_E2E_API_KEY)");
    log("       this script does not fall back to ~/.synapse/config.json — load-testing");
    log("       requires deliberate intent. Export the env var and re-run.");
    process.exit(2);
  }
  return key;
}

function parseEndpoint(spec) {
  // Accept "GET:/api/projects" or bare "/api/projects" (defaults to GET).
  const idx = spec.indexOf(":");
  if (idx === -1 || spec.startsWith("/")) {
    return { method: "GET", path: spec.startsWith("/") ? spec : `/${spec}` };
  }
  const method = spec.slice(0, idx).toUpperCase();
  const path = spec.slice(idx + 1);
  if (!/^[A-Z]+$/.test(method)) {
    throw new Error(`malformed --endpoint: ${spec} (expected METHOD:/path)`);
  }
  if (!path.startsWith("/")) {
    throw new Error(`malformed --endpoint: ${spec} (path must start with /)`);
  }
  return { method, path };
}

function percentile(sorted, p) {
  // Nearest-rank percentile on a pre-sorted ascending array. Standard
  // for latency reporting (matches what wrk / hey / k6 print). For
  // small N (we accept N=1 as a valid load probe shape) the floor
  // function returns index 0 which is fine.
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

async function singleRequest(base, endpoint, headers) {
  const url = `${base}${endpoint.path}`;
  const t0 = performance.now();
  let status = 0;
  let ok = false;
  let errorKind = null;
  try {
    const res = await fetch(url, { method: endpoint.method, headers });
    status = res.status;
    ok = res.ok;
    // Drain the body so the socket can be reused and we measure end-to-end
    // (TTFB + body) consistently. Worker JSON responses are small so this is cheap.
    await res.arrayBuffer();
  } catch (err) {
    errorKind = err?.name ?? "FetchError";
  }
  return { latencyMs: performance.now() - t0, status, ok, errorKind, path: endpoint.path };
}

async function workerLoop(workerId, queue, base, headers, results) {
  // Each worker pulls the next index off the shared queue (a single
  // counter wrapped in an object so all workers see the same value)
  // and runs requests sequentially. When the queue is drained, the
  // worker exits — concurrency is bounded by the number of workers
  // started, not by anything Promise.all does.
  while (queue.next < queue.total) {
    const idx = queue.next++;
    if (idx >= queue.total) break;
    const endpoint = queue.endpoints[idx % queue.endpoints.length];
    const r = await singleRequest(base, endpoint, headers);
    results.push(r);
  }
  return workerId;
}

function reportAggregate(results, walltimeMs, requests, concurrency) {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const okCount = results.filter((r) => r.ok).length;
  const errCount = results.length - okCount;
  const errRate = (errCount / results.length) * 100;
  const rps = (results.length / walltimeMs) * 1000;

  const statusHist = new Map();
  for (const r of results) {
    const key = r.errorKind ? `ERR:${r.errorKind}` : String(r.status);
    statusHist.set(key, (statusHist.get(key) ?? 0) + 1);
  }

  header("AGGREGATE");
  log(`  Requests:           ${results.length} of ${requests} planned`);
  log(`  Concurrency:        ${concurrency}`);
  log(`  Wall time:          ${(walltimeMs / 1000).toFixed(2)}s`);
  log(`  Effective RPS:      ${rps.toFixed(2)}`);
  log(`  Successful (2xx):   ${okCount}  (${((okCount / results.length) * 100).toFixed(1)}%)`);
  log(`  Errors:             ${errCount}  (${errRate.toFixed(1)}%)`);
  log("");
  log("  Latency (ms):");
  log(`    min:   ${latencies[0].toFixed(1)}`);
  log(`    p50:   ${percentile(latencies, 50).toFixed(1)}`);
  log(`    p95:   ${percentile(latencies, 95).toFixed(1)}`);
  log(`    p99:   ${percentile(latencies, 99).toFixed(1)}`);
  log(`    max:   ${latencies[latencies.length - 1].toFixed(1)}`);
  log("");
  log("  Status histogram:");
  const sorted = Array.from(statusHist.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sorted) {
    log(`    ${code.padEnd(20)} ${count}`);
  }

  return { errRate };
}

function reportPerEndpoint(results) {
  // Group by endpoint path so a mixed run (two --endpoint flags) is
  // legible. Skip when only one endpoint is in play — the aggregate
  // block already covers it.
  const byPath = new Map();
  for (const r of results) {
    if (!byPath.has(r.path)) byPath.set(r.path, []);
    byPath.get(r.path).push(r);
  }
  if (byPath.size < 2) return;

  header("PER-ENDPOINT");
  for (const [path, arr] of byPath) {
    const lats = arr.map((r) => r.latencyMs).sort((a, b) => a - b);
    const ok = arr.filter((r) => r.ok).length;
    log(`  ${path}`);
    log(
      `    n=${arr.length}  ok=${ok}  p50=${percentile(lats, 50).toFixed(1)}ms  p95=${percentile(lats, 95).toFixed(1)}ms  p99=${percentile(lats, 99).toFixed(1)}ms`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = loadApiKey();

  const endpoints = args.endpoints.map(parseEndpoint);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "synapse-load-test/1.0",
  };

  header("CONFIG");
  log(`  Base:           ${args.base}`);
  log(`  Requests:       ${args.requests}`);
  log(`  Concurrency:    ${args.concurrency}`);
  log(`  Endpoints:      ${endpoints.map((e) => `${e.method} ${e.path}`).join(", ")}`);
  log("");
  log("  ⚠ generating real load against the configured base. Ctrl-C to abort.");

  const queue = { next: 0, total: args.requests, endpoints };
  const results = [];
  const workerCount = Math.min(args.concurrency, args.requests);

  const t0 = performance.now();
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(workerLoop(i, queue, args.base, headers, results));
  }
  await Promise.all(workers);
  const walltimeMs = performance.now() - t0;

  const { errRate } = reportAggregate(results, walltimeMs, args.requests, args.concurrency);
  reportPerEndpoint(results);

  // Exit 1 when error rate is non-trivial — caller can grep $? for a
  // pass/fail signal in a shell pipeline. 5% threshold mirrors what's
  // commonly considered "load test failed" in similar tools.
  if (errRate > 5) {
    log(`\n❌ error rate ${errRate.toFixed(1)}% > 5% — treating as failure`);
    process.exit(1);
  }
  log(`\n✅ error rate ${errRate.toFixed(1)}% within tolerance`);
  process.exit(0);
}

main().catch((err) => {
  console.error("fatal:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(2);
});
