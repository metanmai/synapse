# Plan 01-04 — Init Writes cwd `.mcp.json` — SUMMARY

**Status:** ✅ Complete (Wave 3 — final plan in slice 1a-prime)
**Slice:** 1a-prime
**Commit:** `768b139` — pushed to origin/main (pre-push hook ran CLEAN: lint + typecheck + 352 tests passing)
**Closes:** BUG-04 (full)

## What landed

### Task 1 — `runInit` extended in `mcp/src/cli/init.ts`
Three additions placed AFTER `writeConfig` and BEFORE the optional `writeServiceFile`:

1. `editorIo.writeMcpJson(path.join(cwd, ".mcp.json"), api_key)` — reuses existing merge-aware helper (`io.ts:98-112`). Preserves any other server entries (Cursor, Windsurf, user-added) verbatim. Backs up unparseable JSON to `.mcp.json.bak`.

2. `editorIo.ensureGitignore(cwd, ".mcp.json")` — mandatory because `.mcp.json` carries `env.SYNAPSE_API_KEY`. Mirrors the existing pattern at `mcp/src/cli/editors/claude-code.ts:9`.

3. Wizard outro warning (BUG-03 surface): if `resolveSynapseMcpCommand` returned tier-3 (`npx synapsesync`) AND `probeNpmRegistry()` returns false, prints `PROXY_FALLBACK_WARNING` from `./util/mcp-command` via `console.warn`. Quiet no-op on a clean network.

Imports use namespace pattern (`import * as editorIo from "./editors/io.js"`) so `vi.spyOn(editorIo, "ensureGitignore")` in `init.test.ts` intercepts at call site. No `--scope` flag (per CONTEXT.md D-02).

### Test isolation fixes (cross-cutting)

Three test files updated to chdir into their tmpdir at beforeEach because `runInit` now writes to `process.cwd()`:

- `mcp/test/cli/init.test.ts`
- `mcp/test/perf/init-time.bench.test.ts`
- `mcp/test/cli/cli-dispatcher.test.ts` (this one runs `runInit` via CLI dispatcher; was leaking `mcp/.mcp.json` and `mcp/.gitignore` into the workspace)

The macOS-resilient `realpathSync` normalization was also applied to the "ensureGitignore" spy assertion since `/tmp` is symlinked to `/private/tmp` and `process.cwd()` returns the resolved path.

### Lint fix

`mcp/src/cli/util/daemon-supervisor.ts` reformatted by biome (multi-line `child_process.execSync(...)` calls split per biome's max-line preference).

## Test results

```
cd mcp && npx vitest run → 352 PASSED, 0 failed, 164 skipped (521 total)
Pre-push hook (npm run verify = lint && typecheck && test) → all GREEN
```

4 RED tests flipped to GREEN by this commit:
- BUG-04 / "writes a new .mcp.json in cwd with the synapse server entry"
- BUG-04 / "merges into an existing .mcp.json preserving other server entries"
- BUG-04 / "backs up and rewrites an invalid existing .mcp.json"
- BUG-04 / "calls ensureGitignore(cwd, '.mcp.json') whenever cwd .mcp.json is written"

## Slice 1a-prime fully GREEN

All 17 RED tests from Wave 0 are now GREEN:
- 5 BUG-02 (status.test.ts) ✅
- 4 BUG-03 (mcp-command.test.ts) ✅
- 4 BUG-04 (init.test.ts) ✅
- 5 BUGS-MD-12 (daemon-backoff.test.ts) ✅

Plus 2 LAUNCHD_LABEL invariant tests (os-service.test.ts) that turned GREEN immediately when Task 3 of Plan 01-01 landed.

## What's deferred to slice 1b

Plan 05 (Sentry observability — full pipeline: code + deploy + verify) remains queued for the CF-enabled machine. The carve was decided in the pre-execution risk audit when `npm install @sentry/cloudflare @sentry/hono` was confirmed Netskope-blocked here.

Also deferred to slice 1b:
- BUG-01 (1101 root-cause via `wrangler tail`, then likely `Promise.allSettled` swap)
- OBS-01 SC#4 verification (deliberate-throw → Sentry within 1 min)
- OPS-01 (Workers Paid tier via `wrangler whoami`)

## Manual verification (BUG-04 SC#3 — slice 1a-prime portion)

The plan's verification step 6 calls for running `synapse init --api-key TESTKEY` in a fresh tmpdir and inspecting `.mcp.json` + `.gitignore`. **Not yet performed by orchestrator** — user may run this manually. The automated behavioral test already proves the file-write paths.

## Phase 1 status

| Slice | Plans | Status |
|-------|-------|--------|
| 1a-prime (this device) | 01-01, 01-02, 01-03, 01-04 | ✅ Complete |
| 1b (CF-enabled machine) | 01-05 + BUG-01 + OPS-01 | ⏳ Queued |

Phase 1 is half-complete. The remaining slice 1b work requires a different machine.
