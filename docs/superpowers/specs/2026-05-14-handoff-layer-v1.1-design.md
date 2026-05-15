# Synapse Handoff Layer v1.1 — Design

**Date:** 2026-05-14
**Author:** Tanmai (with Claude)
**Status:** Implemented (v1.1.0)
**Prior spec:** [2026-05-11 v1 design](./2026-05-11-claude-code-handoff-layer-design.md). v1.1 is incremental.

---

## 1. Goal

v1.1 closes the integration gaps that the v1 test suite missed, removes friction from the "just works" user story, and aggressively trims dead code so the repo stays clean and readable.

### 1.1 What v1.1 changes

Four categories of work:

- **A. Wire-up fixes** — v1 shipped non-functional CLI/daemon entry points (tests passed at unit level, integration was broken). v1.1 makes them actually invocable.
- **B. Friction fixes** — drop the AI cost-cap config knob, default-on inference, free heuristic fallback for when LLM isn't available, auto-create project on first event, invite flow, slash command files installed by `synapse init`.
- **C. Dead-code removal** — ~140 lines of unused exports, helpers, and stale TODOs (per dead-code scan `.planning/dead-code-scan-2026-05-14.md`).
- **D. Architectural cleanup** — retire duplicated/legacy paths (`capture hook-install`, `cli/brief.ts`, `SYNAPSE_PASSPHRASE` encryption, most legacy MCP server handlers).

Net repo size change: approximately **-1100 lines deleted, ~500 added** for new features = **net ~-600 lines smaller**.

### 1.2 What v1.1 does NOT change

- The architectural model from v1 (local-first event log, daemon sync, GitHub-shaped schema, LWW conflict resolution) — unchanged.
- The acceptance scenario (B2 handoff between session 1 and session 2, same user or teammate) — unchanged.
- The capture daemon and its non-CC editor adapters (Cursor, Windsurf, Claude.ai, VS Code) — **kept**. They support tools that don't have Claude Code-style hooks; the architecture has independent value.

---

## 2. Phase A — Critical wire-up fixes

The v1 test suite missed these because unit tests stub the surrounding layers. Each is a real bug that prevents v1 from functioning end-to-end.

### 2.1 Wire authored-CLI commands into `HANDLERS`

`mcp/src/cli/handoff-commands.ts` exports `runHandoffCmd`, `runSetFocusCmd`, `runNoteCmd`, `runIssueCreate`, `runIssueResolve`, `runIssueSupersede`. `mcp/src/cli/status.ts` exports `runStatus`, `runDoctor`. None are reachable from `synapse <command>` invocations because they aren't in `mcp/src/index.ts:HANDLERS`.

**Fix:** Add typed argument-parsing wrappers that convert `process.argv` into the function's args, and register each in HANDLERS. New entries:

```
handoff      → parse "<text>" → runHandoffCmd
set-focus    → parse "<text>" → runSetFocusCmd
note         → parse "--target <ref> <text>" → runNoteCmd
issue create → parse "--kind <k> --title <t> [--body <b>]" → runIssueCreate
issue resolve <id> "<resolution>" → runIssueResolve
issue supersede <id> --by <new_id> → runIssueSupersede
status       → runStatus (no args)
doctor       → runDoctor (no args)
```

Argument parsing should be minimal — the surface is small enough that a hand-written parser per command is fine. No need for an args framework.

Tests must cover: dispatcher routing (a `synapse handoff "x"` invocation reaches `runHandoffCmd` with `{ text: "x" }`), argument validation, error messages on missing required args.

### 2.2 Add `daemon` subcommand to `HANDLERS`

The OS service installed by `synapse init` runs `synapse daemon`. That subcommand doesn't exist; the daemon was never actually starting on user login.

**Fix:** Add `daemon` to `HANDLERS` invoking a new `runDaemon` function that:
1. Loads `~/.synapse/config.json` for `api_key` and `api_url`
2. Discovers tracked projects by listing `~/.synapse/projects/*/`
3. Calls `startHandoffLoop({ projects, api_key, api_url, user_id })` and waits indefinitely
4. Handles SIGTERM gracefully

The function blocks forever; the OS service supervises (restart on crash). Tests verify that `startHandoffLoop` is called with the right projects, that SIGTERM exits cleanly, and that an empty `~/.synapse/projects/` directory produces a sensible "no projects tracked, waiting..." log line rather than crashing.

### 2.3 Drop FKs on `handoff_sessions`/`handoff_issues`

The migration creates these tables with FK constraints (`handoff_events.session_id → handoff_sessions(id)`) but nothing inserts session rows. First production `POST /api/events/batch` will fail at the FK check.

**Fix (option (i) from the dead-code scan — recommended):** Drop the FK constraint. The reducer already produces `active_actors` and per-session attribution from events alone; we don't need a separate table. Tables can remain in the schema (no data, no FK pressure) or be removed.

**Recommended scope:** new migration `016_drop_handoff_session_fks.sql` that:
- `ALTER TABLE handoff_events DROP CONSTRAINT handoff_events_session_id_fkey;`
- `ALTER TABLE handoff_events DROP CONSTRAINT handoff_issues_originated_in_session_id_fkey;`
- Either keeps the tables (as caches for future use) or drops them — we'll keep them to avoid risk of accidentally needing them and to preserve RLS policies.

`session_id` on `handoff_events` becomes a loose `text` field — events still group by session via this column, but no DB-level enforcement that a corresponding `handoff_sessions` row exists.

---

## 3. Phase B — Friction fixes ("it should just work")

### 3.1 Delete cost-tracking infrastructure

Per the conversation that drove v1.1: Synapse doesn't pay for AI inference — the user's Claude Code subscription does. Therefore there's no reason for Synapse to track or cap cost.

**Delete entirely:**
- `HAIKU_INPUT_PER_MTOK`, `HAIKU_OUTPUT_PER_MTOK`, `SONNET_INPUT_PER_MTOK`, `SONNET_OUTPUT_PER_MTOK` constants
- `estimateTokens()` helper
- `getMonthlyCostUsd()` function
- `recordRunStart()` and `recordRunComplete()` (currently called by no production code anyway)
- `EventKind.DaemonRunStarted` and `EventKind.DaemonRunCompleted` enum values
- `daemon.monthly_budget_usd` and `daemon.ai_enabled` and `daemon.model` config fields
- The cost line in `synapse doctor` output
- `test/capture/cost.test.ts` (entire file)

`maybeFireInferNextStep` simplifies — no `ai_enabled` check, no budget pre-flight call, no cost recording. Just: idle threshold exceeded + no explicit handoff → fire CC.

After cleanup, `~/.synapse/config.json` contains only `{ api_key }`. The `daemon` config sub-object goes away.

### 3.2 Heuristic fallback for next-step synthesis

The daemon's `maybeFireInferNextStep` currently fires `claude -p` for LLM-based inference. If CC isn't installed, auth fails, or the spawn errors for any reason, the user gets nothing.

**Add:** `synthesizeHeuristicNextStep(events: Event[]): string` — a pure function in `mcp/src/capture/daemon-cc.ts` (or a new `heuristic-synth.ts`) that takes recent events and produces a single-sentence "what to do next" without any LLM call.

Heuristic logic:
- Most recent `FocusSet` or `UserPrompted` event → "Continue working on `<focus>`."
- Most recent `FileTouched` events grouped by directory → "Last touched `<path1>`, `<path2>` in `<dir>`."
- Most recent unresolved subtasks → "Open subtasks: `<list>`."
- Most recent `CommitMade` → "Last commit was `<sha>: <msg>`."
- If subtasks are open: "Pick up `<first open subtask>`."

Composite output is one to two sentences. Never empty (if events exist, something can always be synthesized).

`maybeFireInferNextStep` wraps the `claude -p` call in try/catch:
- Success → use LLM output, `payload.inferred_method = "llm"`
- Failure → fall back to heuristic, `payload.inferred_method = "heuristic"`

Brief renderer (`handoff-brief.ts`) shows provenance:
- `"Next step (inferred from activity by Claude Code): ..."` for LLM
- `"Next step (inferred from recent activity): ..."` for heuristic

User sees a handoff every time, even with no AI available.

### 3.3 Auto-create project on first event from unknown cwd

Today: `mcp/src/cli/hook-dispatch.ts:readHookPayloadFromStdin` uses `hashCwd(cwd)` as a fallback project ID when the cwd isn't in the local project-map and the backend resolver can't match. Events flow with `project_id: "cwd_<hash>"`. The backend currently has no path to upgrade this to a real project.

**Add:** Backend logic in `POST /api/events/batch` that detects incoming events with a `project_id` matching `/^cwd_[a-f0-9]{12}$/`:
1. Check if a project already exists for this user with matching `name` (from a new `git_basename` field in event payload) — if yes, redirect to that.
2. Otherwise, create a new `projects` row, add the user as owner in `project_members`, return the canonical UUID in the response: `{ ..., canonical_project_id: "<uuid>" }`.
3. The daemon receives the canonical ID, updates `mcp/src/cli/project-map.ts` to remap the cwd, and rewrites the project directory under `~/.synapse/projects/<new_uuid>/` on its next cycle.

Events with `cwd_<hash>` project IDs get inserted with the canonical UUID (the backend rewrites on the fly). No data loss, no manual project creation required.

Hooks need to include `git_basename` in payloads — `mcp/src/cli/hook-dispatch.ts` reads it from `git rev-parse --show-toplevel` then `basename`. Falls back to the directory name if no git repo.

### 3.4 Invite flow

Today: no way to add a teammate to a project except via the web dashboard. v1.1 adds:

**Backend endpoint:** `POST /api/projects/:id/invites { email }`:
- Verifies caller is a member of the project
- Generates a one-time invite token, stores in a new `project_invites` table (schema below)
- Sends email with a join link `https://synapsesync.app/invite/<token>`
- Token expires after 7 days

**Accept-side endpoint:** `POST /api/invites/:token/accept { user_id }` (called from the web dashboard after the invitee authenticates):
- Validates token, not expired
- Inserts row in `project_members`
- Marks invite as accepted

**Migration `017_project_invites.sql`:**

```sql
create table if not exists project_invites (
  token text primary key,
  project_id uuid not null references projects(id) on delete cascade,
  invited_by_user_id uuid not null references users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references users(id) on delete set null
);

create index project_invites_email_idx on project_invites(email);
```

**CLI:** `synapse invite alex@team.com` (and `synapse invite alex@team.com --project <id>` to specify which project; defaults to the current cwd's project).

**Slash command:** `~/.claude/commands/synapse-invite.md` (see §3.5).

### 3.5 Slash command files installed by `synapse init`

Today: users invoke Synapse commands via bash. v1.1 ships native Claude Code slash commands.

`synapse init` writes six markdown files to `~/.claude/commands/synapse/`:

| File | Slash command | What it does |
|---|---|---|
| `handoff.md` | `/synapse-handoff` | Wraps `synapse handoff "$ARGUMENTS"` |
| `focus.md` | `/synapse-focus` | Wraps `synapse set-focus "$ARGUMENTS"` |
| `issue.md` | `/synapse-issue` | Parses `$ARGUMENTS` into create/resolve/supersede + args; wraps the right CLI |
| `status.md` | `/synapse-status` | Wraps `synapse status` |
| `doctor.md` | `/synapse-doctor` | Wraps `synapse doctor` |
| `invite.md` | `/synapse-invite` | Wraps `synapse invite "$ARGUMENTS"` |

Each is a thin markdown wrapper using the documented Claude Code command format. The agent reads `$ARGUMENTS`, runs `synapse <subcmd>` via Bash, and reports the result.

Installation is idempotent — `synapse init` re-running doesn't duplicate or overwrite if the files already exist.

---

## 4. Phase C — Dead code removal

Per the dead-code scan, these are confirmed unused with no callers anywhere. ~140 lines.

| Item | File | Lines |
|---|---|---|
| `cliAuthSignup`, `cliAuthLogin` | `mcp/src/cli/api.ts:20-44` | ~24 |
| `LoginResponse`, `SignupResponse` interfaces | `mcp/src/cli/api.ts:3-12` | ~10 |
| `validateMessage`, `validateSession` | `mcp/src/capture/types.ts:43-65` | ~23 |
| `test/unit/api.test.ts` (matching tests) | `mcp/test/unit/api.test.ts` | ~30 |
| `test/unit/capture/types.test.ts` (validate test cases) | partial | ~15 |
| `countUniqueConnections` | `backend/src/db/queries/entries.ts:187` | ~10 |
| `updateEmbedding` | `backend/src/db/queries/entries.ts:214` | ~10 |
| `deleteMedia` | `backend/src/lib/storage.ts:27` | ~12 |
| Barrel re-exports in `cli/editors/index.ts:1-5` | `mcp/src/cli/editors/index.ts` | ~10 |
| `writeAllDetected` (orchestrate.ts + barrel) | `mcp/src/cli/editors/orchestrate.ts:23` | ~15 |
| Stale TODO in `hook-dispatch.ts:50` | `mcp/src/cli/hook-dispatch.ts` | 1 |
| Unnecessary `export` on `hashCwd` | `mcp/src/cli/hook-dispatch.ts:65` | 1 (keyword) |
| Type-only exports never used cross-module | various | ~30 (visibility narrowing) |

Each removal is independently safe — no logic changes needed.

---

## 5. Phase D — Architectural cleanup

Bigger structural decisions, per Q&A.

### 5.1 Retire `synapse capture hook-install` and `capture/hooks.ts` (Q2)

Today: `mcp/src/capture/hooks.ts` exports an older `installHooks` that writes a single SessionStart entry chaining a bash daemon-start with `synapsesync-mcp brief`. `mcp/src/cli/init.ts` writes six discrete hook entries. Both can coexist; running both produces duplicate SessionStart hooks.

**Action:**
- Delete `mcp/src/capture/hooks.ts` entirely
- Delete `mcp/src/capture/cli.ts` `hook-install` / `hook-uninstall` subcommands
- Delete `test/unit/capture/hooks.test.ts`
- Update `mcp/src/cli/commands.ts:runUninstall` (which currently uses the old `uninstallHooks` via dynamic import) to instead remove the entries written by `init.ts`. Migration logic: if any `~/.claude/settings.json` entries match the new-format hook commands, remove them.
- README mentions of `capture hook-install` are removed.

Net: ~120 lines.

### 5.2 Retire `cli/brief.ts` and `cli/brief-format.ts` (Q3)

Today: two `<synapse-brief>` renderers. The legacy one (`cli/brief.ts`) fetches from `/api/projects/:id/session-context` and formats. The new one (`capture/handoff-brief.ts`) reads daemon cache and formats. Both wrap the output in `<synapse-brief>...</synapse-brief>`.

**Action:**
- Delete `mcp/src/cli/brief.ts`
- Delete `mcp/src/cli/brief-format.ts`
- Delete their tests
- Update `mcp/src/index.ts` HANDLERS — if `brief` is a registered subcommand pointing at the old one, redirect to a new wrapper that calls `renderBriefFromCache` (used as the inline fallback when the daemon cache is missing on first session).
- Backend's `/api/projects/:id/session-context` endpoint is unused after this — remove (or mark deprecated).

Net: ~200 lines.

### 5.3 Drop `SYNAPSE_PASSPHRASE` encryption (Q4)

`mcp/src/index.ts:374-411` has `decryptContent`, `getEncKey`, `deriveKeyNode` — an undocumented client-side encryption escape hatch triggered by setting `SYNAPSE_PASSPHRASE` and `SYNAPSE_USER_EMAIL` env vars.

**Action:** Delete the three functions and any code that branches on them. Remove the env var references in README's "Optional environment variables" table.

Net: ~40 lines + docs.

### 5.4 Trim legacy MCP server (Q5)

`mcp/src/index.ts:322-958` defines the full MCP server. Per Q5 ("deprecate"), v1.1 trims aggressively:

**Keep:**
- `save_insight` MCP tool (project CLAUDE.md still recommends this as the documented write path; can't remove without user migration)
- `list_insights` MCP tool (same)

**Remove:**
- `ls`, `read`, `search`, `history`, `tree` filesystem-style handlers
- `list_conversations`, `load_conversation` conversation readers
- `resolvePath` fuzzy matcher (only used by removed handlers)
- Local duplicate `ConversationMessage`/`ConversationDetail`/`ConversationSummary`/`ListConversationsResponse` interfaces (already exist in `packages/shared/src/conversations.ts`)

**Mark deprecated in code + README:**
- Add `// DEPRECATED: legacy MCP surface, prefer REST API or handoff CLI. Removal target: v2.0` comment above the remaining `save_insight`/`list_insights` registration
- README's MCP setup section gets a "Legacy" header and a "for new integrations, use ..." pointer

Net: ~500 lines.

### 5.5 Capture daemon — surgical cleanup only (Q1)

Per Q1: the conversation-capture daemon and its non-CC editor adapters have independent value (capturing Cursor, Windsurf, Claude.ai, etc. sessions). They stay.

But surgical cleanup within `mcp/src/capture/`:
- `validateMessage`/`validateSession` (already in Phase C)
- Any dead barrel re-exports
- Stale TODO comments
- Type exports that should be local

Net: ~50 lines.

---

## 6. Updated event model

After Phase B.1 deletion, `EventKind` shrinks:

**Removed:**
- `DaemonRunStarted`
- `DaemonRunCompleted`

**No new event kinds in v1.1.**

After Phase B.2, `next_step_inferred` payload gains an optional `inferred_method: "llm" | "heuristic"` field. The brief formatter reads it to choose phrasing.

---

## 7. Updated config model

After v1.1, `~/.synapse/config.json` is just:

```json
{
  "api_key": "..."
}
```

No `daemon` sub-object. No `ai_enabled`, no `monthly_budget_usd`, no `daemon.model`. Inference always runs; sandbox model is hardcoded to Haiku in `writeDaemonCcProfile` (Task 22 from v1, unchanged).

The init wizard no longer prompts about AI — it's always on. The only init question is "API key?" (already the case).

---

## 8. Acceptance criteria

v1.1 ships when all of these are true:

1. `synapse handoff "x"` from a shell results in a `next_step_set` event in `events.jsonl`.
2. `synapse issue create --kind decision --title "x"` results in an `issue_created` event.
3. `synapse status` and `synapse doctor` produce the expected output.
4. After `synapse init`, the OS service starts the daemon at next login (verified via launchd / systemd status).
5. A `POST /api/events/batch` with all valid events succeeds against the live schema (no FK errors).
6. `~/.synapse/config.json` after `init` contains only `{ api_key }`.
7. If `claude -p` is not on PATH or fails, the daemon still writes a `next_step_inferred` event using heuristic synthesis. Provenance label distinguishes.
8. A user with no project in their account who opens Claude Code in a new repo gets an auto-created project after the daemon's first flush. The project shows in the dashboard.
9. `synapse invite alex@team.com` sends an email; the invitee accepting the link results in a `project_members` row.
10. `synapse init` creates `~/.claude/commands/synapse/*.md` slash command files; `/synapse-handoff` from Claude Code chat triggers the handoff CLI.
11. `npm run typecheck` and `npm run lint` are clean across mcp, backend, packages/shared.
12. The lines-of-code count in `mcp/src/` and `backend/src/` is ~600 lower than v1.

---

## 9. Out of scope (deferred)

- **Sub-second presence (B3 from v1 spec).** Still deferred. v1.1 doesn't change the 15s poll cadence.
- **Decision extraction from raw events (use case #2 from v1 daemon-fired CC scope).** Still deferred.
- **Windows OS service install.** Still launchd + systemd only.
- **Manual issue merge (dedup).** Still deferred.
- **Frontend dashboard changes.** Out of scope.
- **Per-host adapter parity beyond Claude Code.** Still Claude Code-first; capture adapters for other hosts unchanged.
- **Migration of existing `save_insight` writes into `Issue` records.** Still deferred — `save_insight` legacy path remains.

---

## 10. Risks

- **Removing the legacy MCP handlers breaks anyone running the published `synapsesync-mcp` npm package against a non-CC MCP host.** Per the project memory ("no external users yet"), this is acceptable. If new external users land before v1.1 ships, revisit.
- **Auto-create project on first event may produce duplicates** if the user works in multiple cwds for the "same" project (e.g., `~/work/project` and `~/work/project-fork`). Mitigation: backend matches by `git_basename` first; only creates new if no name match exists. Edge cases get visibility in `synapse doctor`.
- **Heuristic synthesizer output quality is lower than LLM output.** Acceptable: it's a fallback, not the default. Users with working CC auth always get the LLM version.
- **Dropping FK constraints loosens DB-level invariants.** Acceptable: the reducer is the source of truth for session/issue state. FK constraints were never enforcing real semantics anyway.

---

## End of design.
