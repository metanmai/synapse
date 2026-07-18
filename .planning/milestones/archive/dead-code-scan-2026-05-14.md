# Dead-Code Scan — handoff-layer-v1

Date: 2026-05-14
Scope: `mcp/`, `backend/`, `packages/shared/`, `supabase/migrations/`

## 1. Summary

- **Definitely dead:** 14 items (mostly unwired CLI handlers, unused query/storage helpers, one orphan SessionStart hook installer).
- **Probably dead:** 11 items (test-only exports, unused types, two unused DB tables, daemon plumbing that may not be reachable yet).
- **v1.1 deletion targets confirmed clean:** all 6 — no external callers outside `daemon-cc.ts`, `init.ts`, `status.ts`, `daemon.ts`, and their tests.
- **Hot spots:**
  1. `mcp/src/cli/handoff-commands.ts` — 6 exported CLI handlers, zero non-test callers. The `synapse handoff/set-focus/note/issue *` commands described in commits aren't wired into the dispatcher.
  2. `mcp/src/cli/status.ts` — exports `runStatus`/`runDoctor` that collide with `cli/commands.ts:runStatus`. The new ones from commit `26d29ba` aren't wired.
  3. Two old/new parallel paths around `SessionStart` hook install (`capture/hooks.ts` vs `cli/init.ts`) — both still ship.
  4. `supabase/migrations/015_handoff_layer.sql` creates `handoff_sessions` and `handoff_issues` tables that no code reads or writes.
  5. OS service unit launches `synapse daemon` — no such subcommand exists in the CLI HANDLERS map.

`tsc --noUnusedLocals --noUnusedParameters` returns clean for both `mcp/` and `backend/` — no unused locals/params remain. All findings below come from cross-file reachability tracing + `ts-unused-exports`.

## 2. Definitely dead (auto-remove safe)

### mcp/

| File:line | What | Why dead | Lines |
|---|---|---|---|
| `mcp/src/cli/api.ts:20-31` | `cliAuthSignup()` | Only imported by `test/unit/api.test.ts`. Real auth uses `browserAuth`. | ~12 |
| `mcp/src/cli/api.ts:33-44` | `cliAuthLogin()` | Same — test-only consumer. | ~12 |
| `mcp/src/cli/api.ts:3-12` | `LoginResponse`, `SignupResponse` interfaces | Returned only by the two dead functions above. | ~10 |
| `mcp/src/cli/welcome.ts` (entire file would shrink, see Probably-dead) | n/a | Single caller `runWizard`; if wizard kept, file stays. Not dead per se. | — |
| `mcp/src/cli/editors/index.ts:15` | re-export `writeAllDetected` | Only test reaches it; src callers use `writeEditorConfigs` directly. The underlying `writeAllDetected` in `orchestrate.ts:23` has zero src callers. | ~15 (with the impl) |
| `mcp/src/cli/editors/index.ts:1-5` | barrel re-exports of `ensureGitignore`, `writeJsonSafe`, `writeMcpJson`, `writeClaudeCodeLocal/Global`, `writeCursorLocal/Global`, `writeWindsurfLocal/Global`, `writeVSCodeLocal/Global` | Every src caller imports the symbols from their leaf modules directly. The barrel is only consumed for `detectEditors`/`detectExistingSetup`/`writeEditorConfigs` and types. Re-exports can be trimmed. | ~10 |
| `mcp/src/cli/hook-dispatch.ts:65-67` | `hashCwd` (exported) | Used inside the same file. The `export` keyword has no consumers. Drop the `export`. | 1 (keyword) |
| `mcp/src/capture/types.ts:43-65` | `validateMessage`, `validateSession` | Only imported by `test/unit/capture/types.test.ts`. Nothing in src calls them; the capture-worker uses adapters' own parsers. | ~23 |
| `mcp/src/cli/hook-dispatch.ts:50` | TODO comment: "integrate with project-map.ts when resolveProjectIdFromCwd lands" | `resolveProjectIdFromCwd` doesn't exist; the `hashCwd` path already does the job. TODO references work that's been superseded. | 1 |
| `mcp/src/cli/status.ts:6-16` (full file) | `runStatus`, `runDoctor` from cli/status.ts | Name-shadowed by `cli/commands.ts:runStatus` (which is the one wired in). Not in `HANDLERS` map, never imported outside `test/cli/status.test.ts`. Commit `26d29ba` "synapse status and synapse doctor commands" appears to have landed the impl+tests but never wired them. | 49 (full file) + test |

### backend/

| File:line | What | Why dead | Lines |
|---|---|---|---|
| `backend/src/db/queries/entries.ts:187` | `countUniqueConnections()` | No callers anywhere (src or test). | ~10 |
| `backend/src/db/queries/entries.ts:214` | `updateEmbedding()` | No callers. Embeddings are written by a different path (`embeddings.ts`). | ~10 |
| `backend/src/lib/storage.ts:27` | `deleteMedia()` | No callers. Media is deleted via direct query elsewhere or not at all. | ~12 |

## 3. Probably dead (needs judgment)

| File:line | What | Context | Risk if removed |
|---|---|---|---|
| `mcp/src/cli/handoff-commands.ts` (entire file, 6 exports) | `runHandoffCmd`, `runSetFocusCmd`, `runNoteCmd`, `runIssueCreate`, `runIssueResolve`, `runIssueSupersede` | All six are exported and tested (`test/cli/handoff-commands.test.ts`, `test/cli/issue-commands.test.ts`, `test/e2e/handoff.e2e.test.ts`) but **never imported by `mcp/src/index.ts` HANDLERS**. Commits `14d2c72` + `2cb9205` ship them as "synapse handoff / set-focus / note / issue create/resolve/supersede CLI subcommands" yet the dispatcher is missing the entries. | If the v1 acceptance criterion expects these commands to be invocable from the CLI, removing them is wrong — wiring them is. Otherwise, dead. **Likely the actual gap is missing wiring, not dead code.** |
| `mcp/src/capture/cli.ts:14-28` | `capture hook-install` / `hook-uninstall` subcommands | Uses old `installHooks` from `capture/hooks.ts` that writes a single `SessionStart` entry chaining `${buildStartCommand()} ; synapsesync-mcp brief`. This pre-dates the v1 `synapse init` flow (`cli/init.ts`) which installs the full 6-event hook set with `synapse hook <kind>` dispatch. | Both paths ship; running both produces overlapping SessionStart entries. Either deprecate `capture hook-install` or have `synapse init` replace it. Removing this needs a product decision. |
| `mcp/src/capture/hooks.ts` (whole file) | `buildStartCommand`, old `installHooks`/`uninstallHooks`/`isInstalled` | Only callers are `capture/cli.ts` (the old hook-install subcommand) and `cli/commands.ts:runUninstall` (dynamic import to clean up). If `capture hook-install` goes, this file goes too — uninstall path needs migration to remove the new init hooks instead. | Removing breaks uninstall for users who installed via the old flow. Tests in `test/unit/capture/hooks.test.ts` would also go. |
| `mcp/src/capture/capture-worker.ts` + `cloud-sync.ts` + `store.ts` + `watcher.ts` + `adapters/*.ts` | Old conversation-capture daemon (file-watching editor sessions, POSTing to `/api/conversations`) | Still launched by `synapse capture start` and by the SessionStart bash one-liner from old `capture/hooks.ts`. Independent of the new handoff `events.jsonl` flow in `capture/daemon.ts`. README still describes capture (`synapsesync-mcp capture start`) in the help menu. | This is the v1 "captured-conversations are superseded by handoff events" question. Removing kills capture-pipeline e2e and the multi-editor adapter surface. Likely keep for now, but flag that `capture-worker.ts` and `daemon.ts` are unrelated — the launchd unit launches `synapse daemon` (which doesn't exist), not `capture start`. |
| `mcp/src/capture/daemon.ts:121` | `startHandoffLoop` | Exported, only consumed by `test/capture/daemon.test.ts`. There is no src code path that calls it — the OS service unit invokes `synapse daemon`, which is missing from HANDLERS. | If the launchd/systemd unit is supposed to call this, we have a bug, not dead code. **Open question for the user.** |
| `mcp/src/capture/daemon.ts:83` | `maybeFireInferNextStep` | Same as above: only test calls it. `startHandoffLoop` doesn't invoke it either. | Possibly intended to fire from a cycle — if so, missing wire-up. |
| `mcp/src/capture/daemon-cc.ts:7` | `writeDaemonCcProfile` | Only called inside `spawnInferNextStep` (also in the same file) — `export` keyword is unnecessary. ts-unused-exports flags it. | Cosmetic — drop `export`. |
| `mcp/src/cli/spinner.ts:4` (`GlyphSpinner` interface), `mcp/src/cli/resolve-project.ts:4,10` (`ResolvedProject`, `BackendResolveResponse`), `mcp/src/cli/project-map.ts:5,11,13` (`ProjectMapping`, `ProjectMap`, `getProjectMapPath`), `mcp/src/cli/browser-auth.ts:56,61` (`BrowserAuthResult`, `BrowserAuthCallbacks`), `mcp/src/hooks/session-start.ts:7` (`SessionStartArgs`), `backend/src/db/search-helpers.ts` (`ScoredItem`), `backend/src/middleware/project-auth.ts` (`ResolvedProject`, `resolveProjectEditor`, `resolveProjectOwner`) | Type/interface and helper exports never imported across module boundaries | Public-ish API surfaces. Most can be made local. | Low — narrowing visibility is free, just touches a lot of files. |
| `supabase/migrations/015_handoff_layer.sql:3-18` | `handoff_sessions` table | Schema declared, RLS configured, but `grep handoff_sessions` returns zero TS hits. Events are written with `session_id` (a ULID string) but no row in `handoff_sessions` corresponds to it — the FK on `handoff_events.session_id → handoff_sessions(id)` will fail on first insert in production. | **Likely a real bug, not dead code.** Either the table is intended for v1.1 (and the FK is premature) or there's missing INSERT logic. Don't drop without checking. |
| `supabase/migrations/015_handoff_layer.sql:39-58` | `handoff_issues` table | Same story — schema + RLS, no code path SELECTs/INSERTs. CLI handoff-commands write `IssueCreated` *events* via `appendEvent`, not rows in `handoff_issues`. | Same — feature incomplete or table premature. |
| `backend/test/api/events-batch.test.ts:44-56`, `project-events.test.ts:35-46`, `project-status.test.ts:35` | 8 `.skip` tests | Rationale is "no SUPABASE_URL in test env, no handoff_events table available." These aren't stale, they're placeholders for integration tests. | If integration env never materializes, they're noise. Otherwise keep. |

## 4. v1.1 deletion targets — confirmed safe

| File:line | What | Outside callers? |
|---|---|---|
| `mcp/src/capture/daemon-cc.ts:56-59` | `HAIKU_INPUT_PER_MTOK`, `HAIKU_OUTPUT_PER_MTOK`, `SONNET_INPUT_PER_MTOK`, `SONNET_OUTPUT_PER_MTOK` constants | None — only `recordRunComplete` in the same file. |
| `mcp/src/capture/daemon-cc.ts:62-64` | `estimateTokens` | None outside this file (no src or test references). |
| `mcp/src/capture/daemon-cc.ts:117-132` | `getMonthlyCostUsd` | Imported by `mcp/src/cli/status.ts:3` (the unwired one) and `test/capture/cost.test.ts`. When that file/test goes, this is unused. |
| `mcp/src/capture/daemon-cc.ts:74-114` | `recordRunStart`, `recordRunComplete` | Only `test/capture/cost.test.ts`. No src caller. |
| `mcp/src/cli/init.ts:63` (`SynapseConfig.daemon.monthly_budget_usd`) + `init.ts:72` default | `daemon.monthly_budget_usd` config field | Only written here; **never read anywhere** (`grep monthly_budget_usd` returns only these two lines). |
| `mcp/src/cli/init.ts:63,72`, `mcp/src/capture/daemon.ts:78`, `daemon.ts:84`, `test/capture/idle-trigger.test.ts` | `ai_enabled` flag | Read in `maybeFireInferNextStep`, which is itself unreached from src (see §3). Once that goes, `ai_enabled` is removable. |

Conclusion: all six targets have no external (non-test, non-self) dependencies and can be deleted together in v1.1. Coordinated removal of `daemon-cc.ts`, `mcp/src/cli/status.ts`, the `daemon.*` block in `cli/init.ts:62-74`, `EventKind.DaemonRunStarted`/`DaemonRunCompleted` in `packages/shared/src/handoff/events.ts`, and `test/capture/cost.test.ts` + `test/capture/idle-trigger.test.ts` will clear ~250 lines.

## 5. Architectural cruft

### 5.1 Redundant logic: two `<synapse-brief>` renderers

- `mcp/src/cli/brief-format.ts` + `mcp/src/cli/brief.ts` — runs the legacy `synapse brief` CLI; fetches from `/api/projects/:id/session-context`, renders via `formatBrief`/`formatWorkspaceBrief`, wraps in `<synapse-brief>...</synapse-brief>`.
- `mcp/src/capture/handoff-brief.ts` (`renderBriefFromCache`/`writeBrief`) — pulled by `hooks/session-start.ts`, reads `~/.synapse/projects/<id>/cache/project_status.json` (written by the daemon's pull cycle), and emits the same wrapper.

Both emit the same `<synapse-brief>` tag. Per commit `bf6a0c3` ("hook chain survives daemon-already-running"), the SessionStart command chains both: `${buildStartCommand()} ; synapsesync-mcp brief` from the old `capture/hooks.ts`, then `init.ts` writes a separate `synapse hook session-start` entry that itself renders from the daemon cache. Net result: SessionStart can produce **two** `<synapse-brief>` blocks for users with both installers run. Worth deciding which is canonical.

### 5.2 Two `installHooks` functions in different files

- `mcp/src/capture/hooks.ts:70` — public `installHooks(settingsPath?)`, writes one SessionStart entry chaining the bash daemon-start and `synapsesync-mcp brief`. Exposed via `synapse capture hook-install`.
- `mcp/src/cli/init.ts:43` — private `installHooks()` inside `runInit`, writes six hook entries (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, SessionEnd, SubagentStop) each calling `synapse hook <kind>`.

The new one has no idempotency check against the old SessionStart entry. They coexist quietly until both are run; the resulting `~/.claude/settings.json` will have a SessionStart array with both blocks. Pick one, deprecate the other.

### 5.3 OS service launches a non-existent subcommand

`mcp/src/capture/os-service.ts:47-50` builds:
```
const synapseBin = `node ${path.resolve(here, "../cli/commands.js")}`;
```
…then writes a launchd plist with `ExecStart=<bin> daemon` (or systemd with the same). But:
- `mcp/src/cli/commands.ts` is a module, not a CLI entry; running it directly does nothing useful.
- `mcp/src/index.ts`'s `HANDLERS` map has no `daemon` key — `synapsesync-mcp daemon` would print "Unknown command" and exit 1.
- `startHandoffLoop` and `maybeFireInferNextStep` are exported but never called from production code.

This is the "missing wiring" smell — a needed entry point. Either add a `daemon: () => runDaemonLoop()` to HANDLERS in `mcp/src/index.ts` and have `runDaemonLoop` call `startHandoffLoop`, or remove `os-service.ts`+`writeServiceFile` and the `--skip-service` plumbing in `init.ts`.

### 5.4 Legacy MCP server code (`mcp/src/index.ts` lines 322-958)

Per the brief's "MCP de-scoped from the critical path" framing: the bottom 640 lines of `mcp/src/index.ts` define the full MCP server (ls/read/search/history/tree/list_conversations/load_conversation/save_insight/list_insights). It's still reachable for non-Claude-Code MCP hosts (Cursor, Windsurf, VS Code) per the README, so not dead. But:
- The `decryptContent`/`getEncKey`/`deriveKeyNode` block (lines 374-411) sits inside this entry and is unreachable unless `SYNAPSE_PASSPHRASE` is set. No documentation mentions setting that env var; it's an undocumented escape hatch.
- The `resolvePath` fuzzy matcher (lines 425-476) is 50 lines for a feature only invoked by `read`/`history`. No callers elsewhere. If we narrow MCP scope further it can go too.
- `ConversationMessage`/`ConversationDetail`/`ConversationSummary`/`ListConversationsResponse` interfaces (lines 67-100) are local copies of types that exist in `packages/shared/src/conversations.ts`. Duplication.

### 5.5 Capture-daemon old paths

`mcp/src/capture/` contains both the old conversation-capture worker (`capture-worker.ts`, `cloud-sync.ts`, `store.ts`, `watcher.ts`, all 7 `adapters/*.ts`) and the new handoff-events daemon (`daemon.ts`, `daemon-cc.ts`, `handoff-sync.ts`, `events-log.ts`, `handoff-paths.ts`, `handoff-brief.ts`, `actor.ts`). They don't share state and don't compose. The old daemon POSTs to `/api/conversations`; the new one POSTs to `/api/events/batch`. Both are launched by different entrypoints (`synapse capture start` vs the broken `synapse daemon` OS service).

If conversations-via-capture is going away in v1.x, that's ~1500 lines (`capture-worker.ts`, `cloud-sync.ts`, `store.ts`, `watcher.ts`, `adapters/*`, `safe-read.ts`, the matching `test/unit/capture/*` and `test/e2e/capture-pipeline.test.ts`) — by far the biggest dead-code surface in the repo.

### 5.6 Unused tables `handoff_sessions` and `handoff_issues`

Already covered in §3. Either:
- The reducer is supposed to write a `handoff_sessions` row when it sees `SessionOpened`, but doesn't.
- The CLI `runIssueCreate` is supposed to insert into `handoff_issues` and emit an event, but only emits the event.
Real bugs worth filing as issues before deleting anything.

### 5.7 Stale config knobs

In `~/.synapse/config.json` (written by `init.ts:62-74`):
- `daemon.monthly_budget_usd` — never read anywhere. Pure cruft. Delete with v1.1.
- `daemon.ai_enabled` — only read by `maybeFireInferNextStep`, which has no production caller. Delete with v1.1.
- `daemon.model` — only read by `recordRunComplete`, which has no production caller. Delete with v1.1.

After v1.1 cleanup, the only field left in `~/.synapse/config.json` would be `api_key`. Consider whether the whole config file still pays its weight.

## 6. Quick wins (top 10, ordered by impact)

1. **Wire or delete `mcp/src/cli/handoff-commands.ts`** — 110 lines + tests. If commands aren't shipped in v1, delete the file; if they are, add 6 lines to `HANDLERS` in `mcp/src/index.ts`. Either way, fix the gap.
2. **Wire or delete `mcp/src/cli/status.ts`** — 49 lines. Same gap: shipped + tested + not wired.
3. **Resolve the `synapse daemon` entry point** — pick: add `daemon` to HANDLERS (calling `startHandoffLoop`) or remove `os-service.ts`, the `writeServiceFile` call in `init.ts:35`, and `--skip-service`. Currently the launchd/systemd unit installed by `synapse init` won't actually run anything.
4. **Delete `cliAuthSignup`, `cliAuthLogin`, `LoginResponse`, `SignupResponse`** in `mcp/src/cli/api.ts` and the matching test file — ~50 lines.
5. **Delete `validateMessage`/`validateSession` + their test** — `mcp/src/capture/types.ts:43-65`, `test/unit/capture/types.test.ts`. ~50 lines.
6. **Delete `countUniqueConnections`, `updateEmbedding`, `deleteMedia`** — 3 unused backend helpers, ~30 lines total.
7. **Drop the unused barrel re-exports in `mcp/src/cli/editors/index.ts`** — keep only what src actually imports. Tests can import from leaf modules.
8. **Remove the stale TODO in `mcp/src/cli/hook-dispatch.ts:50`** — `resolveProjectIdFromCwd` is never going to land; `hashCwd` is the answer.
9. **De-duplicate the SessionStart hook install paths** (`capture/hooks.ts` vs `cli/init.ts`) — pick one. Likely retire `capture/hooks.ts:installHooks` and the `capture hook-install` subcommand in favour of `synapse init`.
10. **Decide on `handoff_sessions` + `handoff_issues` tables** — either drop them from `015_handoff_layer.sql` (and remove the FK on `handoff_events.session_id`), or land the missing insert paths. Currently they're a footgun on first prod insert because of the FK.

## 7. Open questions for the user

1. **Are the unwired CLI subcommands a v1 acceptance miss or were they de-scoped?** `synapse handoff`, `synapse set-focus`, `synapse note`, `synapse issue create/resolve/supersede`, `synapse status`, `synapse doctor` — all implemented + tested + not in `mcp/src/index.ts:HANDLERS`. The plan-of-record (32 tasks, commits `14d2c72`, `2cb9205`, `26d29ba`) reads like they were supposed to ship. Wiring is a 12-line patch; deletion is ~160 lines.
2. **Is the OS service supposed to call `startHandoffLoop`?** `synapse daemon` doesn't exist; the launchd plist and systemd unit will both fail silently. If yes, this is a missing `daemon: () => startHandoffLoop(...)` handler. If no, drop `os-service.ts` and the `writeServiceFile()` call.
3. **Are `handoff_sessions` + `handoff_issues` schema-only on purpose for v1.1?** The FK from `handoff_events.session_id → handoff_sessions.id` will fail on the first event POST in production unless either (a) we insert into `handoff_sessions` first or (b) we drop the FK. Worth confirming.
4. **Is the old capture daemon (`capture-worker.ts`, `cloud-sync.ts`, `store.ts`, `watcher.ts`, all 7 adapters) supposed to coexist with the new handoff daemon long-term?** It's the largest cleanup opportunity (~1500 lines), but only if the answer is "no — v1 handoff supersedes captured conversations." If the answer is "yes, both ship," the file is fine.
5. **Should the `synapse capture hook-install` subcommand and `capture/hooks.ts` be retired** in favour of `synapse init` exclusively? Both install `SessionStart` entries; nothing stops a user from running both and getting double-fired hooks.
6. **`SYNAPSE_PASSPHRASE` / `decryptContent` in `mcp/src/index.ts:374-411`** — is e2e encryption still a planned feature, or is it dead code from a previous iteration? README doesn't mention it.
