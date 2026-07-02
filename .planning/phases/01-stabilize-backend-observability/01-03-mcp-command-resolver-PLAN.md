---
phase: 01-stabilize-backend-observability
plan: 03
type: execute
wave: 2
slice: 1a
depends_on: [01-01]
files_modified:
  - mcp/src/cli/util/mcp-command.ts
  - mcp/src/cli/editors/io.ts
autonomous: true
requirements: [BUG-03]

must_haves:
  truths:
    - "When `which synapsesync` succeeds, the emitted `.mcp.json` command is the absolute bin path on disk — bypasses npm + PATH entirely."
    - "When `which` fails but `<package-root>/dist/index.js` exists, the emitted command is `process.execPath` + `[<abs-dist-path>]` — bypasses npm and PATH `synapsesync` lookup."
    - "Only when neither resolves does the resolver fall back to `npx synapsesync` — preserving the legacy shape as last resort."
    - "Existing `writeMcpJson(filePath, apiKey)` signature unchanged; callers (Cursor, Windsurf, Claude Code adapters) receive the new command shape transparently."
  artifacts:
    - path: "mcp/src/cli/util/mcp-command.ts"
      provides: "Sync resolveSynapseMcpCommand(apiKey) + async probeNpmRegistry(timeoutMs)"
      exports: ["resolveSynapseMcpCommand", "probeNpmRegistry", "McpCommand"]
    - path: "mcp/src/cli/editors/io.ts"
      provides: "synapseMcpServer (or equivalent at line 94-96) delegates to resolveSynapseMcpCommand"
      contains: "resolveSynapseMcpCommand"
  key_links:
    - from: "mcp/src/cli/editors/io.ts:94-96"
      to: "mcp/src/cli/util/mcp-command.ts"
      via: "import + call from synapseMcpServer"
      pattern: "resolveSynapseMcpCommand\\("
    - from: "mcp/src/cli/util/mcp-command.ts (resolveDistEntry)"
      to: "mcp/dist/index.js (built artifact)"
      via: "fileURLToPath(import.meta.url) + path.resolve('../../index.js')"
      pattern: "import\\.meta\\.url"
---

<objective>
Close BUG-03: wizard's MCP configs must work on proxy-restricted networks (Netskope, corp firewalls) by emitting an absolute command path instead of `npx synapsesync` whenever possible.

Purpose: Today's `.mcp.json` files contain `{ "command": "npx", "args": ["synapsesync"] }`. On a Netskope-restricted network, `npx` fails with 403. The MCP server never starts; the user sees no error; Synapse looks broken (Pitfall 3 — verified empirically). After this plan, the same wizard run on a clean network produces an absolute-path command that runs on any network (including the proxy network, after the binary is installed once).

Output: `mcp-command.ts` filled in with the three-tier fallback chain from RESEARCH §"Pattern 4"; `editors/io.ts` line 94-96 delegates to it. 4 RED tests turn GREEN. Zero new dependencies (per RESEARCH §"Standard Stack" "No new dependencies for the mcp workspace").

User-observable outcome: a user re-running `synapse init` on this dev machine gets a `.mcp.json` whose `command` is `/Users/Tanmai.N/.../node_modules/.bin/synapsesync` (or `node <abs>/dist/index.js`), not `npx synapsesync`. Re-running the wizard later from a Netskope-restricted network produces the same shape (no proxy lookup needed at runtime).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-stabilize-backend-observability/01-CONTEXT.md
@.planning/phases/01-stabilize-backend-observability/01-RESEARCH.md
@.planning/phases/01-stabilize-backend-observability/01-VALIDATION.md
@.planning/phases/01-stabilize-backend-observability/01-01-SUMMARY.md
@docs/BUGS.md

<interfaces>
<!-- Source-of-truth patterns. Extracted from RESEARCH.md Pattern 4 + existing init.ts:20-29. -->

`mcp-command.ts` exports (created in Wave 0, body fills in this plan):
- `export interface McpCommand { command: string; args: string[]; env: Record<string, string> }`
- `export function resolveSynapseMcpCommand(apiKey: string): McpCommand` — SYNC per RESEARCH §"Open Questions" #3 (resolver itself is sync; probe is separate)
- `export async function probeNpmRegistry(timeoutMs?: number): Promise<boolean>` — 2-second AbortController on `https://registry.npmjs.org/-/ping`

Decision tree (RESEARCH §"Pattern 4" lines 396-403, locked by D-11):
  1. Try `which synapsesync` (or `where synapsesync` on Windows) → if exits 0 AND `fs.existsSync(path)` is true → emit `{ command: <abs-bin-path>, args: [], env: { SYNAPSE_API_KEY } }`.
  2. Try `<package-root>/dist/index.js` via `fileURLToPath(import.meta.url)` + `path.resolve(here, "../../index.js")` (mirroring `mcp/src/capture/os-service.ts:113-116` resolveDaemonScriptPath shape) → if file exists → emit `{ command: process.execPath, args: [distEntry], env: { SYNAPSE_API_KEY } }`.
  3. Fall through → emit `{ command: "npx", args: ["synapsesync"], env: { SYNAPSE_API_KEY } }`.

Existing call site (BUG-03 fix surface — `mcp/src/cli/editors/io.ts:94-96`):
- Currently a function `synapseMcpServer(apiKey)` returns an object literal with `command: "npx"`, `args: ["synapsesync"]`. Replace its body with a call to `resolveSynapseMcpCommand(apiKey)` returning the same `{ command, args, env }` shape — callers (`writeMcpJson` at io.ts:98-112 + the Cursor / Windsurf / Claude Code adapters) are unaffected.

Existing reusable pattern (DO NOT re-invent — RESEARCH §"Don't Hand-Roll"):
- `mcp/src/cli/init.ts:20-29` — `resolveBin()` for installing hooks. Same `which → absolute → node dist/index.js` chain. The new helper mirrors this shape rather than copying its code (the contexts differ: `resolveBin` was about the hook command; this is about the MCP-server command). Read it for style consistency.
- `mcp/src/capture/os-service.ts:113-116` — `resolveDaemonScriptPath` already uses `fileURLToPath(import.meta.url)` + `path.resolve` to find dist. Mirror this shape.

LANDMINES (RESEARCH §"Common Pitfalls"):
- Pitfall 3: `npx synapsesync` works for the dev (cached) and fails on user's proxy network. Prefer absolute paths UNCONDITIONALLY — don't gate on "is proxy reachable?". The probe is only for wizard outro warnings, NOT for resolution.
- Wave 0 test `probeNpmRegistry returns false on 2s timeout` uses `vi.useFakeTimers()` + a never-settling fetch mock.

Wizard outro warning (per CONTEXT.md `<specifics>` + RESEARCH §"Pitfall 3"):
- After resolveSynapseMcpCommand returns, IF the result is the `npx` fallback (tier 3) AND `probeNpmRegistry()` resolves to false within 2s, the wizard surface should warn: "npm registry unreachable; the MCP server may fail to start; run `npm i -g synapsesync` from a non-proxied network and rerun `synapse init`".
- The warning surface lives in the wizard runner — which for this slice is `mcp/src/cli/init.ts` (BUG-04 plan touches this too, and reads runInit). To minimize file conflict with Plan 04, THIS plan only authors the resolver + io.ts wiring. The wizard warning (the conditional `probeNpmRegistry` call after resolution) is OUT OF SCOPE for this plan; Plan 04 owns `runInit` and is the natural home. Add a `// TODO(BUG-03): wizard outro warning when tier-3 fallback emitted and probe fails` comment in `init.ts` only if Plan 04 hasn't merged yet — otherwise let Plan 04 handle it. (Coordination note: Plan 04's action references this; the warning lives in Plan 04.)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement resolveSynapseMcpCommand + probeNpmRegistry in mcp-command.ts</name>
  <files>mcp/src/cli/util/mcp-command.ts</files>
  <read_first>
    - mcp/src/cli/util/mcp-command.ts (Wave 0 stub — full)
    - mcp/src/cli/init.ts (lines 1-50 — read `resolveBin` shape and imports for style)
    - mcp/src/capture/os-service.ts (lines 100-140 — read `resolveDaemonScriptPath` shape)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 4" (lines 392-480)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Common Pitfalls" Pitfall 3
    - mcp/test/cli/mcp-command.test.ts (Wave 0 — read assertions verbatim)
    - .planning/codebase/CONVENTIONS.md
  </read_first>
  <behavior>
    `resolveSynapseMcpCommand(apiKey)` (sync):
      - Tier 1: Run `process.platform === "win32" ? "where synapsesync" : "which synapsesync"` via `execSync`. If output trims to a non-empty path AND `fs.existsSync(path)` is true, return `{ command: path, args: [], env: { SYNAPSE_API_KEY: apiKey } }`. Take only `out.split(/\r?\n/)[0]` (per RESEARCH note — `where` may return multiple lines).
      - Tier 2: Compute `const here = path.dirname(fileURLToPath(import.meta.url))` and `const distIndex = path.resolve(here, "../../index.js")`. If `fs.existsSync(distIndex)`, return `{ command: process.execPath, args: [distIndex], env: { SYNAPSE_API_KEY: apiKey } }`.
      - Tier 3: Return `{ command: "npx", args: ["synapsesync"], env: { SYNAPSE_API_KEY: apiKey } }`.
      - All errors are caught silently — never propagate. The function MUST never throw.

    `probeNpmRegistry(timeoutMs = 2000)` (async):
      - AbortController with `setTimeout(() => ctrl.abort(), timeoutMs)`.
      - `await fetch("https://registry.npmjs.org/-/ping", { signal: ctrl.signal })`.
      - Return `res.ok` on success, `false` on any throw (including abort).
      - `finally` clears the timeout.
  </behavior>
  <action>
    Replace the Wave 0 stub body of `resolveSynapseMcpCommand` with the three-tier dispatch from `<behavior>`. Replace the stub body of `probeNpmRegistry` with the AbortController fetch. Imports: `execSync` from `node:child_process`, `fs` from `node:fs`, `path` from `node:path`, `fileURLToPath` from `node:url`. Mirror the dist-resolution shape from `mcp/src/capture/os-service.ts:113-116` per RESEARCH §"Pattern 4" line 460. DO NOT install any dependency (mcp workspace gets zero new deps).

    Add a JSDoc-free named-export comment block at the top citing `RESEARCH.md §"Pattern 4"` for future readers (3-line comment max).
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/mcp-command.test.ts</automated>
  </verify>
  <done>All 4 BUG-03 rows in 01-VALIDATION.md "Per-Task Verification Map" flip from ⬜ to ✅; `npm run lint && npm run typecheck` exit 0 from repo root.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire resolveSynapseMcpCommand into editors/io.ts:94-96</name>
  <files>mcp/src/cli/editors/io.ts</files>
  <read_first>
    - mcp/src/cli/editors/io.ts (full — pay attention to lines 90-115, the `synapseMcpServer` and `writeMcpJson` functions)
    - mcp/src/cli/editors/claude-code.ts (lines 1-30 — read how it calls into io.ts)
    - mcp/src/cli/editors/cursor.ts (lines 1-30 — same)
    - mcp/src/cli/editors/windsurf.ts (lines 1-30 — same)
    - mcp/src/cli/util/mcp-command.ts (now-implemented from Task 1)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 4" lines 469-480
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Code Examples" "Verified — Existing writeMcpJson shape" (lines 700-722)
  </read_first>
  <behavior>
    - `synapseMcpServer(apiKey)` returns the same `{ command, args, env }` shape it does today, but the values come from `resolveSynapseMcpCommand(apiKey)` instead of hard-coded constants. Signature unchanged. Sync — no async/await propagation needed (per RESEARCH §"Open Questions" #3).
    - `writeMcpJson(filePath, apiKey)` is UNCHANGED — already calls `synapseMcpServer(apiKey)` internally per io.ts:114-116 verified shape. Verify this is still the case after the edit; do not touch `writeMcpJson` body.
    - All adapter callers (`claude-code.ts`, `cursor.ts`, `windsurf.ts`) unchanged.
  </behavior>
  <action>
    In `mcp/src/cli/editors/io.ts`, edit the body of `synapseMcpServer` at line ~94-96: replace the hard-coded `{ command: "npx", args: ["synapsesync"], env: { ... } }` literal with `return resolveSynapseMcpCommand(apiKey)`. Add `import { resolveSynapseMcpCommand } from "../util/mcp-command"` at the top of the file. Verify (via grep / re-read) that `writeMcpJson` at lines 98-112 still references `synapseMcpServer(apiKey)` — do NOT rewrite `writeMcpJson`.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/mcp-command.test.ts test/cli/init.test.ts</automated>
    <automated>cd mcp && npx vitest run</automated>
  </verify>
  <done>Existing init/mcp-command tests still pass (no regression); io.ts now delegates to the resolver; `grep -v '^//' mcp/src/cli/editors/io.ts | grep -c 'npx'` shows the `npx` literal lives only in `mcp-command.ts` (tier-3 fallback), not in io.ts; `npm run lint && npm run typecheck` exit 0.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| install-time → registry.npmjs.org | The `probeNpmRegistry` function makes a 2s GET against a public Cloudflare-fronted endpoint with no auth header. Trust: low — failure mode is "warning surfaced to wizard," not gating any security decision. |
| install-time → child process (`which` / `where`) | Compile-time literal commands; no shell interpolation; stdio piped not inherited. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-03-01 | Tampering | `which synapsesync` returning attacker-controlled path | accept | The user's PATH is already trusted by them — if PATH is compromised, the MCP server resolution is the least of the problems. Same trust model as the existing `init.ts:resolveBin()` pattern. |
| T-01-03-02 | Information Disclosure | API key written into `.mcp.json` on disk | mitigate | `ensureGitignore(cwd, ".mcp.json")` is called by Plan 04's BUG-04 path — see Plan 04 threat model. |
| T-01-03-03 | Denial of Service | `probeNpmRegistry` hangs indefinitely on slow proxy | mitigate | 2-second AbortController timeout (Wave 0 test asserts this — `mcp/test/cli/mcp-command.test.ts`). |
</threat_model>

<verification>
1. `cd mcp && npx vitest run test/cli/mcp-command.test.ts` — all 4 BUG-03 tests green
2. `cd mcp && npx vitest run` — full mcp suite green (init.test.ts must still pass since the merge tests live there)
3. `npm run lint && npm run typecheck` from repo root — exit 0
4. Inspect a freshly-written `.mcp.json` (post `synapse init`) on the dev machine: `command` should be an absolute path, not `npx`. (Manual; this is the BUG-03 SC#3 surface — full Netskope verification is deferred to slice 1b per VALIDATION.md "Manual-Only Verifications".)
</verification>

<success_criteria>
- BUG-03 acceptance criteria in REQUIREMENTS.md becomes verifiable: the wizard emits an absolute-path command instead of `npx synapsesync`.
- 4 RED tests turn GREEN.
- Zero new mcp-workspace dependencies (per RESEARCH §"Standard Stack" — the corp-proxy constraint is honored).
- All adapters (Cursor / Windsurf / Claude Code) inherit the fix transparently because they call `synapseMcpServer` / `writeMcpJson` which now delegates.
</success_criteria>

<output>
Create `.planning/phases/01-stabilize-backend-observability/01-03-SUMMARY.md` when done. Summary MUST update VALIDATION.md "Per-Task Verification Map" 4 BUG-03 rows from ⬜ → ✅, and note whether the wizard outro warning (TODO comment in `init.ts` if Plan 04 hasn't landed) was handed off to Plan 04 or implemented inline.
</output>
