---
phase: 01-stabilize-backend-observability
plan: 04
type: execute
wave: 2
slice: 1a
depends_on: [01-01, 01-03]
files_modified:
  - mcp/src/cli/init.ts
autonomous: true
requirements: [BUG-04]

must_haves:
  truths:
    - "After `synapse init --api-key X` runs in a fresh project, `<cwd>/.mcp.json` exists and contains `mcpServers.synapse` with the resolver-emitted command (absolute path, not `npx`)."
    - "If `<cwd>/.mcp.json` already exists with other server entries (Cursor, Windsurf, user-added), they are preserved verbatim and only the `synapse` entry is added/updated (per D-01)."
    - "If `<cwd>/.mcp.json` is unparseable JSON, it is backed up to `.mcp.json.bak` and rewritten (per existing `writeMcpJson` corrupt path)."
    - "`<cwd>/.gitignore` is updated to ignore `.mcp.json` (it contains the user's API key in `env.SYNAPSE_API_KEY`)."
  artifacts:
    - path: "mcp/src/cli/init.ts"
      provides: "runInit additionally writes <cwd>/.mcp.json and ensures gitignore — closing BUG-04"
      contains: "writeMcpJson"
  key_links:
    - from: "mcp/src/cli/init.ts (runInit)"
      to: "mcp/src/cli/editors/io.ts (writeMcpJson + ensureGitignore)"
      via: "import + call after writeConfig, before writeServiceFile"
      pattern: "writeMcpJson\\(path\\.join\\(process\\.cwd\\(\\)"
    - from: "mcp/src/cli/init.ts (runInit)"
      to: "mcp/src/cli/editors/io.ts (ensureGitignore)"
      via: "import + call with cwd + '.mcp.json'"
      pattern: "ensureGitignore\\([^,]+,\\s*['\"]\\.mcp\\.json"
---

<objective>
Close BUG-04: `synapse init` must write the project-local `.mcp.json` (in addition to hooks + service + config) so the MCP server is reachable from Claude Code in the project the user just ran `init` in.

Purpose: Today `synapse init` installs hooks, slash commands, the config file, and the launchd plist — but does NOT write `.mcp.json` to the cwd. Users who run `synapse init` outside the wizard (direct CLI invocation) end up with a working daemon but no MCP integration. BUG-04 makes `init` a complete one-shot wizard replacement (per CONTEXT.md D-02 "No `--scope` flag — keep the CLI surface minimal").

Output: `runInit` gains 2 calls — `writeMcpJson(path.join(process.cwd(), ".mcp.json"), a.api_key)` and `ensureGitignore(process.cwd(), ".mcp.json")` — placed between `writeConfig` and `writeServiceFile` (per RESEARCH §"Code Examples" line 721 hint). 4 RED tests in `init.test.ts` turn GREEN.

User-observable outcome: after `synapse init --api-key X` in a fresh project + Claude Code restart, `mcp__synapse__tree()` returns successfully (the BUG-04 acceptance criterion from REQUIREMENTS.md).
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
@.planning/phases/01-stabilize-backend-observability/01-03-SUMMARY.md
@docs/BUGS.md

<interfaces>
<!-- Source-of-truth patterns. Extracted from RESEARCH.md + existing code. -->

Existing `writeMcpJson(filePath, apiKey)` (`mcp/src/cli/editors/io.ts:98-112`, VERIFIED shape):
- Already implements merge-if-exists: spreads existing `mcpServers` and adds/updates only the `synapse` key.
- Already handles unparseable JSON by copying to `<filePath>.bak` (line 108) before rewrite.
- Signature unchanged after Plan 03 — internally now uses `resolveSynapseMcpCommand` for the command shape.

Existing `ensureGitignore(cwd, entry)` (`mcp/src/cli/editors/io.ts:124-133`, VERIFIED shape per CONTEXT.md `<additional_specifics>`):
- Idempotent: only appends entry if not already present.
- Already used by `mcp/src/cli/editors/claude-code.ts:9` for `.mcp.json` (mirror this call pattern).

`runInit` current ordering (`mcp/src/cli/init.ts:54-63`, per RESEARCH §"Component Responsibilities"):
- `installHooks(...)`
- `installSlashCommands(...)`
- `writeConfig(~/.synapse/config.json, ...)`
- `writeServiceFile()` (launchd/systemd)

INSERTION POINT (per RESEARCH §"Code Examples" line 721 "between `writeConfig` and `writeServiceFile`"):
  - Add `writeMcpJson(path.join(process.cwd(), ".mcp.json"), a.api_key)` after `writeConfig` returns.
  - Immediately follow with `ensureGitignore(process.cwd(), ".mcp.json")`.

Wizard outro warning (handed off from Plan 03 per its `<interfaces>` coordination note):
- IF `resolveSynapseMcpCommand(apiKey).command === "npx"` (tier-3 fallback was emitted) AND `await probeNpmRegistry()` resolves to false → print a clack-styled warning at end of `runInit`: "npm registry unreachable; the MCP server may fail to start; run `npm i -g synapsesync` from a non-proxied network and rerun `synapse init`".
- Use existing `@clack/prompts` import already present in `runInit`.
- This is the ONLY async work in the new `runInit` additions — and `runInit` is already async, so no signature change. Place the warning AT THE END of `runInit`, after `writeServiceFile`, so the wizard's success messaging still fires for the happy path.

LANDMINES:
- Pitfall 3 (RESEARCH): `.mcp.json` contains `env.SYNAPSE_API_KEY` — MUST be gitignored. `ensureGitignore` call is mandatory; the test asserts it.
- Don't introduce a new `deepMerge` helper (RESEARCH §"Don't Hand-Roll") — `writeMcpJson` already merges via spread.
- Wave 0 test "backs up and rewrites an invalid existing .mcp.json" relies on the EXISTING `writeMcpJson` corrupt-path code (line 108 `fs.copyFileSync(filePath, ${filePath}.bak)`) — no new code needed for that branch; the test just exercises it through runInit.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Insert writeMcpJson + ensureGitignore calls into runInit</name>
  <files>mcp/src/cli/init.ts</files>
  <read_first>
    - mcp/src/cli/init.ts (full — pay attention to runInit body lines 54-63 area)
    - mcp/src/cli/editors/io.ts (lines 90-140 — read writeMcpJson AND ensureGitignore)
    - mcp/src/cli/editors/claude-code.ts (lines 1-30 — read its ensureGitignore call pattern)
    - mcp/src/cli/util/mcp-command.ts (now-implemented from Plan 03)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Code Examples" lines 700-722
    - .planning/phases/01-stabilize-backend-observability/01-CONTEXT.md §"decisions" D-01, D-02
    - mcp/test/cli/init.test.ts (Wave 0 + extensions — assertions verbatim)
    - .planning/codebase/CONVENTIONS.md
  </read_first>
  <behavior>
    - After `writeConfig(...)` returns and before `writeServiceFile()` is called, call `writeMcpJson(path.join(process.cwd(), ".mcp.json"), a.api_key)`. This writes (or merges into) the project-local `.mcp.json`. Per D-01, merge preserves other server entries verbatim and only updates the `synapse` key — `writeMcpJson` already does this; no new logic.
    - Immediately call `ensureGitignore(process.cwd(), ".mcp.json")` (mirroring `mcp/src/cli/editors/claude-code.ts:9` per RESEARCH §"Component Responsibilities").
    - At the end of `runInit` (after `writeServiceFile`), check if tier-3 fallback was emitted: re-call `resolveSynapseMcpCommand(a.api_key).command === "npx"` and `await probeNpmRegistry()`. If both true, print a `clack` warning surface. If the user is on a clean network, this is a no-op. (Reuses the resolver — the cost is 2 fs.existsSync + 1 execSync attempt; trivial.)
    - The `runInit` happy-path output remains: `installHooks → installSlashCommands → writeConfig → writeMcpJson (NEW) → ensureGitignore (NEW) → writeServiceFile → [optional npx warning]`.
    - DO NOT introduce a `--scope` flag (per D-02 — minimal CLI surface).
    - Both new calls work for the direct-CLI and wizard call sites (per CONTEXT.md `<code_context>` "Integration Points: runInit is called from both the wizard and direct CLI invocation").
  </behavior>
  <action>
    Edit `mcp/src/cli/init.ts`: add imports `writeMcpJson` and `ensureGitignore` from `./editors/io` (path may be `./editors/io.js` depending on existing import conventions — match what the file already does). Add `resolveSynapseMcpCommand` and `probeNpmRegistry` imports from `./util/mcp-command`. Add `path` import if not already present.

    In `runInit` body, between `writeConfig(...)` and `writeServiceFile()`, insert:
      1. `writeMcpJson(path.join(process.cwd(), ".mcp.json"), a.api_key)`
      2. `ensureGitignore(process.cwd(), ".mcp.json")`

    After `writeServiceFile()`, add a conditional block that re-calls `resolveSynapseMcpCommand(a.api_key)`; if `.command === "npx"`, await `probeNpmRegistry()`; if false, print a `@clack/prompts` warning with the message from `<interfaces>`. Use the same clack styling already used elsewhere in `runInit`.

    Verify (re-read after edit) that no other call site of `writeMcpJson` was affected — this plan only adds a new call, does not modify the helper.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/init.test.ts</automated>
    <automated>cd mcp && npx vitest run</automated>
  </verify>
  <done>All 4 BUG-04 rows in 01-VALIDATION.md "Per-Task Verification Map" flip from ⬜ to ✅; existing mcp tests still pass; `npm run lint && npm run typecheck` exit 0 from repo root; `grep -n 'writeMcpJson\\|ensureGitignore' mcp/src/cli/init.ts` shows the two new calls in `runInit`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| install-time → filesystem `<cwd>` | `writeMcpJson` writes a file containing `env.SYNAPSE_API_KEY`. cwd is user-controlled (any directory the user runs `init` in). Trust: the user owns the directory and chose to run init there. |
| install-time → user's git history | If the user commits `.mcp.json` despite gitignore (e.g., `git add -f .mcp.json`), the API key leaks to whatever remote the repo pushes to. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-04-01 | Information Disclosure | `.mcp.json` (contains SYNAPSE_API_KEY) committed to git | mitigate | `ensureGitignore(process.cwd(), ".mcp.json")` is a mandatory call after `writeMcpJson` — Wave 0 test asserts the call happens. ASVS V7 (Error Handling & Logging) family. |
| T-01-04-02 | Tampering | Existing `.mcp.json` with unparseable JSON | mitigate | Existing `writeMcpJson` backs up to `.mcp.json.bak` (io.ts:108) before rewriting; Wave 0 test exercises this branch. |
| T-01-04-03 | Information Disclosure | Backup file `.mcp.json.bak` could contain prior server's secrets | accept | The backup preserves what was already on disk; if the prior `.mcp.json` had secrets, they were already there. Not a NEW disclosure introduced by this plan. |
</threat_model>

<verification>
1. `cd mcp && npx vitest run test/cli/init.test.ts` — all 4 BUG-04 tests green
2. `cd mcp && npx vitest run` — full mcp suite green
3. `npm run lint && npm run typecheck` from repo root — exit 0
4. Manual: run `synapse init --api-key TESTKEY` in a fresh tmpdir; verify `.mcp.json` exists, contains `mcpServers.synapse.env.SYNAPSE_API_KEY === "TESTKEY"`, and `<tmpdir>/.gitignore` contains a line `.mcp.json`. Re-run `synapse init` in the same dir — verify `.mcp.json` is not duplicated and `.gitignore` is not double-entried.
</verification>

<success_criteria>
- BUG-04 acceptance row in REQUIREMENTS.md verifiable: `synapse init --api-key X` followed by a Claude Code restart makes `mcp__synapse__tree()` return successfully (manual; the automated tests verify the file-write paths).
- 4 RED tests turn GREEN.
- No new dependency added; no `--scope` flag added (D-02 honored).
- `runInit` is now a complete one-shot wizard replacement (CONTEXT.md framing).
</success_criteria>

<output>
Create `.planning/phases/01-stabilize-backend-observability/01-04-SUMMARY.md` when done. Summary MUST update VALIDATION.md "Per-Task Verification Map" 4 BUG-04 rows from ⬜ → ✅ and confirm the optional `npx` warning was implemented (or, if Plan 03 already merged its TODO comment, that the TODO is now resolved).
</output>
