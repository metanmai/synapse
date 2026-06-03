# Plan 01-01 — Wave 0 Scaffolding — SUMMARY

**Status:** ✅ Complete
**Slice:** 1a-prime
**Commits:** `19e3f8e` (Task 1) → `2576c45` (Task 2) → `c7988c3` (Task 3)
**Pushed:** origin/main as of 2026-05-19

## What landed

### Task 1 — 3 stub source files (commit `19e3f8e`)
- `mcp/src/cli/util/mcp-command.ts` — `McpCommand` interface + `resolveSynapseMcpCommand` (sync) + `probeNpmRegistry` (async); both throw "not implemented — Wave 2"
- `mcp/src/cli/util/daemon-supervisor.ts` — `Supervisor` type + `SupervisorStatus` interface + `checkSupervisor` (sync); throws "not implemented — Wave 2"
- `mcp/src/capture/daemon-backoff.ts` — `BASE_DELAY_MS = 10_000`, `MAX_DELAY_MS = 300_000` (real values); `computeNextDelay` (pure) throws "not implemented — Wave 2"

### Task 2 — 5 test files (commit `2576c45`)
- `mcp/test/cli/mcp-command.test.ts` (NEW): 4 RED tests — BUG-03 resolver branches + 2s proxy probe timeout
- `mcp/test/capture/daemon-backoff.test.ts` (NEW): 5 RED tests — BUGS.md #12 backoff schedule via pure `computeNextDelay` helper (no fake timers, no loop driving)
- `mcp/test/cli/init.test.ts` (EXTENDED): 4 RED tests — BUG-04 (`.mcp.json` write, merge-existing, corrupt-backup, ensureGitignore call)
- `mcp/test/cli/status.test.ts` (EXTENDED): 5 RED tests — BUG-02 (launchd / systemd / pid-file branches + supervisor-distinguishability behavioral test + LAUNCHD_LABEL-via-sentinel mock test)
- `mcp/test/capture/os-service.test.ts` (EXTENDED): 2 GREEN tests — LAUNCHD_LABEL invariant + render-equivalence

### Task 3 — LAUNCHD_LABEL extraction (commit `c7988c3`)
- `mcp/src/capture/os-service.ts` — added `export const LAUNCHD_LABEL = "app.synapsesync.daemon";` after imports; updated plist template line to use `${LAUNCHD_LABEL}` interpolation; rendered output byte-identical

## Test status

```
cd mcp && npx vitest run test/cli/mcp-command.test.ts test/capture/daemon-backoff.test.ts test/cli/init.test.ts test/cli/status.test.ts test/capture/os-service.test.ts
→ Tests: 17 failed | 14 passed (31 total)
→ Failures: all "not implemented — Wave 2" stub throws
→ os-service.test.ts ALL GREEN (4 pre-existing + 2 LAUNCHD invariants = 6/6)
```

The 17 failures are the queued RED tests for Wave 2/3 to satisfy. The 14 passes include the pre-existing test fixtures plus the 2 new LAUNCHD invariants that turn GREEN with Task 3's `os-service.ts` edit.

## VALIDATION.md rows queued RED for Wave 2/3

| Wave-2/3 Plan | REQ-ID | Rows |
|---------------|--------|------|
| 01-02 (daemon-supervisor + backoff) | BUG-02 | 4 rows |
| 01-02 (daemon-supervisor + backoff) | BUGS-MD-12 | 5 rows |
| 01-03 (mcp-command resolver) | BUG-03 | 4 rows |
| 01-04 (init writes .mcp.json) | BUG-04 | 4 rows |

## Slice 1b (deferred to CF-enabled machine)

OBS-01 scaffolding (observability.ts stub, observability.test.ts, observability-wiring.test.ts) was deliberately NOT created in this plan. Plan 05 owns the full OBS-01 pipeline on the CF machine because `npm install @sentry/cloudflare @sentry/hono` is Netskope-blocked here. When Plan 05 runs on the CF machine, it executes its own Wave 0 step (stub + RED tests) before continuing to install + wire + verify.

## Push strategy

Pushed `--no-verify` because the RED tests intentionally fail the pre-push hook's `test` step (per plan verification block). Lint + typecheck both pass.

## Next up

- **Wave 2** (parallel): Plan 01-02 (daemon-supervisor + backoff) + Plan 01-03 (mcp-command resolver)
- **Wave 3**: Plan 01-04 (init writes .mcp.json with merge + gitignore + warning)

Wave 2's two plans touch disjoint files (`mcp/src/capture/daemon.ts` + `daemon-backoff.ts` + `daemon-supervisor.ts` + `commands.ts` vs. `mcp/src/cli/util/mcp-command.ts` + `editors/io.ts`) so they can run in parallel without merge-conflict risk.
