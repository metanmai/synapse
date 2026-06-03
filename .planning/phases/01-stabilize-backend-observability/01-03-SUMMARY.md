# Plan 01-03 — MCP Command Resolver — SUMMARY

**Status:** ✅ Complete
**Slice:** 1a-prime
**Commit:** `1f11b55` — pushed to origin/main
**Closes:** BUG-03 (full)

## What landed

### Task 1 — `mcp/src/cli/util/mcp-command.ts` implementation
- `resolveSynapseMcpCommand(apiKey)` sync three-tier dispatch:
  - Tier 1 (`which synapsesync` / `where synapsesync` on Windows): if exit 0 + file exists → absolute bin path.
  - Tier 2 (`<package-root>/dist/index.js` via `fileURLToPath` walk): if exists → `process.execPath` + dist entry.
  - Tier 3 (fallback): `npx synapsesync`.
  - Never throws. Uses `child_process.execSync` namespace import for spy compatibility.
- `probeNpmRegistry(timeoutMs = 2000)` async with AbortController. Returns false on any failure.
- `PROXY_FALLBACK_WARNING` exported string constant — single source of truth for the wizard outro warning that Plan 04 imports.

### Task 2 — `mcp/src/cli/editors/io.ts:synapseMcpServer`
- Delegates to `resolveSynapseMcpCommand(apiKey)`.
- `writeMcpJson` unchanged.
- Cursor / Windsurf / Claude Code adapters inherit fix transparently.

### Pre-existing test relaxation — `mcp/test/unit/editors.test.ts`
- Two assertions that hard-coded `command: "npx"` updated to structural invariants:
  - `command` is non-empty string
  - `args` is array
  - `env.SYNAPSE_API_KEY` matches expected
- Class-correct (per `feedback_test_generality.md`): catches "JSON shape broken" without pinning to one resolver tier.

## Test results

```
cd mcp && npx vitest run → 348 passed, 4 failed, 164 skipped (521 total)
4 failures = expected Plan 01-04 RED tests
0 unexpected regressions
```

4 RED tests turn GREEN with this commit:
- BUG-03 / "resolves to absolute bin path when `which synapsesync` succeeds"
- BUG-03 / "resolves to `node <abs>/dist/index.js` when which fails but dist exists"
- BUG-03 / "returns `npx synapsesync` last-resort when neither resolves"
- BUG-03 / "probeNpmRegistry returns false on 2s timeout"

## Cross-plan handoff

`PROXY_FALLBACK_WARNING` is now importable from `./util/mcp-command.js`. Plan 04's wizard outro warning surface MUST import this constant — no string duplication. The warning surface (the `probeNpmRegistry` call + clack print at end of `runInit`) is exclusively owned by Plan 04 per BLOCKER #3 enforcement.

## Manual verification (BUG-03 SC#3)

The plan's verification step 5 calls for inspecting a freshly-written `.mcp.json` and confirming the `command` is an absolute path, not `npx`. **Not yet performed by orchestrator** — user may run `synapse init` and inspect `.mcp.json` manually after Plan 04 lands. Full Netskope-network verification deferred to slice 1b.

## Next up

**Plan 01-04 (Wave 3 — last plan in slice 1a-prime):** `synapse init` writes `.mcp.json` to cwd with merge-if-exists, ensureGitignore, and the proxy-fallback wizard outro. Depends on Plans 01-01 (stubs) + 01-03 (this — for `resolveSynapseMcpCommand` + `PROXY_FALLBACK_WARNING`). Turns the 4 remaining RED tests GREEN; closes slice 1a-prime entirely.
