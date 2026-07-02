---
phase: 02-real-user-identity
plan: 4
type: execute
wave: 3
depends_on: ["02-01", "02-02"]
files_modified:
  - supabase/migrations/018_projects_git_remote_url.sql
  - backend/src/api/events-batch.ts
  - mcp/src/cli/hook-dispatch.ts
  - mcp/src/hooks/session-start.ts
  - mcp/src/capture/handoff-sync.ts
  - mcp/src/capture/daemon.ts
autonomous: false
requirements: [IDENT-02]
threat_refs: [T-02-02, T-02-03]
user_setup:
  - service: supabase
    why: "Migration 018 adds projects.git_remote_url column + index; must be applied to dogfood Supabase before any test or event flow exercises the new column"
    env_vars:
      - name: SUPABASE_ACCESS_TOKEN
        source: "Supabase Dashboard → Account → Access Tokens (only needed for non-TTY automation; interactive `supabase login` covers TTY runs)"
    dashboard_config:
      - task: "Verify migration applied via Table Editor → projects table shows git_remote_url column + index"
        location: "Supabase Dashboard → Database → Tables → projects"

must_haves:
  truths:
    - "projects table has a nullable git_remote_url text column with a (owner_id, git_remote_url) partial index"
    - "Daemon hook captures git_remote_url at hook-write time and embeds it in event payload"
    - "Backend events-batch matcher tries git_remote_url BEFORE name; opportunistically backfills git_remote_url on name-match"
    - "When a cwd_<hash> first flushes from a fresh machine, backend returns canonical_project_id mapping; daemon eager-pulls events on this remap"
    - "Eager-pulled events get _pulled: true marker AND advance .watermark"
    - "Subsequent runFlushCycle filters _pulled events out of POST body"
    - "actor_user_id override at backend/src/api/events-batch.ts:60 is UNCHANGED (regression guard for IDENT-01)"
  artifacts:
    - path: "supabase/migrations/018_projects_git_remote_url.sql"
      provides: "projects.git_remote_url column + partial index"
      contains: "git_remote_url"
    - path: "backend/src/api/events-batch.ts"
      provides: "git_remote_url-first matcher with name fallback + opportunistic backfill"
      contains: "git_remote_url"
    - path: "mcp/src/cli/hook-dispatch.ts"
      provides: "getGitRemoteUrl helper + payload now includes git_remote_url"
      contains: "getGitRemoteUrl"
    - path: "mcp/src/hooks/session-start.ts"
      provides: "session-start event payload now carries git_remote_url"
      contains: "git_remote_url"
    - path: "mcp/src/capture/handoff-sync.ts"
      provides: "runEagerPullCycle exported + runFlushCycle filters _pulled events"
      contains: "runEagerPullCycle"
    - path: "mcp/src/capture/daemon.ts"
      provides: "Cycle loop calls runEagerPullCycle on canonical_project_id remap"
      contains: "runEagerPullCycle"
  key_links:
    - from: "mcp/src/cli/hook-dispatch.ts"
      to: "event payload's git_remote_url"
      via: "execSync git config --get remote.origin.url"
      pattern: "git_remote_url"
    - from: "backend/src/api/events-batch.ts:matcher"
      to: "projects.git_remote_url column"
      via: "db.from('projects').select.eq('git_remote_url', ...)"
      pattern: "git_remote_url"
    - from: "mcp/src/capture/daemon.ts:cycle"
      to: "mcp/src/capture/handoff-sync.ts:runEagerPullCycle"
      via: "called only when flush.canonical_project_id is set (first-time link)"
      pattern: "runEagerPullCycle"
---

<objective>
Implement Slice B — Cross-device project linking via git remote URL + eager pull of existing events on first-time link. Locked decisions: D-06 (linking signal is git remote URL with basename fallback; new column on projects), D-08 (eager full sync on link — ProjectStatus + last N=500 events). Also includes the `[BLOCKING]` Supabase schema push for migration 018.

After this plan ships, two machines of the same user that work in the same git repo (with same `remote.origin.url`) auto-link into one canonical project, and a brief on machine B includes machine A's recent activity within one daemon cycle.

Purpose: complete IDENT-02 SC #2 — "on machine B (fresh install, same authenticated user), `synapse init` + a Claude Code SessionStart for a project that already has events from machine A produces a brief that includes machine-A activity within one pull cycle."

Output: 1 NEW migration file + 5 EXTENDED files. The migration is applied to dogfood Supabase via `[BLOCKING]` schema push task BEFORE any tests exercise the new column.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-real-user-identity/02-CONTEXT.md
@.planning/phases/02-real-user-identity/02-RESEARCH.md
@.planning/phases/02-real-user-identity/02-PATTERNS.md
@.planning/phases/02-real-user-identity/02-VALIDATION.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/INTEGRATIONS.md
@.planning/codebase/ARCHITECTURE.md
@backend/src/api/events-batch.ts
@backend/src/api/project-events.ts
@mcp/src/cli/hook-dispatch.ts
@mcp/src/cli/resolve-project.ts
@mcp/src/hooks/session-start.ts
@mcp/src/capture/handoff-sync.ts
@mcp/src/capture/daemon.ts
@mcp/src/capture/events-log.ts
@packages/shared/src/handoff/types.ts
@supabase/migrations/017_project_invites.sql

<interfaces>
<!-- Key contracts: existing matcher, existing pull cycle, existing project-events endpoint. -->

From backend/src/api/events-batch.ts:82-115 (current matcher):
```typescript
for (const cwdHash of cwdHashIds) {
  const sample = body.events.find((e) => String(e.project_id) === cwdHash);
  const payload = (sample?.payload ?? {}) as { git_basename?: string };
  const gitBasename = payload.git_basename ?? "untitled";

  let existingId: string | null = null;
  if (memberProjectIds.length > 0) {
    const { data: existing } = await db
      .from("projects").select("id").eq("name", gitBasename)
      .in("id", memberProjectIds).maybeSingle();
    existingId = (existing as { id: string } | null)?.id ?? null;
  }
  if (existingId) { idMapping.set(cwdHash, existingId); continue; }
  // Create new project (name + owner_id only — git_remote_url NOT populated yet)
}
```

The line `actor_user_id: user.id` at backend/src/api/events-batch.ts:60 is the IDENT-01 server-side guard — MUST stay untouched.

From backend/src/api/project-events.ts (the eager-pull endpoint already exists):
- Route: GET /api/projects/:id/events?limit=NNN
- Returns: { events: Row[], next_since: string | null }
- Already authMiddleware-gated; already membership-checked

From mcp/src/cli/resolve-project.ts:23-39 (readGitSignals — the existing pattern to copy):
```typescript
function readGitSignals(cwd: string): { git_origin_url?: string; git_basename?: string } {
  try {
    const url = execSync("git config --get remote.origin.url", {
      cwd, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return { git_origin_url: url || undefined, ... };
  } catch { return {}; }
}
```

From mcp/src/capture/handoff-sync.ts:72-84 (runPullCycle — the template for runEagerPullCycle):
```typescript
export async function runPullCycle(a: FlushArgs): Promise<{ pulled: number }> {
  const dir = projectDir(a.project_id);
  const statusPath = path.join(dir, "cache/project_status.json");
  const res = await fetch(`${a.api_url}/api/projects/${a.project_id}/status`, ...);
  if (res.status === 404) return { pulled: 0 };
  if (!res.ok) throw new Error(...);
  // writes statusPath
}
```

From mcp/src/capture/daemon.ts:144-158 (cycle loop — the hook point):
```typescript
for (let i = 0; i < a.projects.length; i++) {
  const project_id = a.projects[i];
  try {
    const flush = await runFlushCycle({ project_id, api_key, api_url });
    const effectiveId = flush.canonical_project_id ?? project_id;
    if (flush.canonical_project_id) a.projects[i] = flush.canonical_project_id;
    await runPullCycle({ project_id: effectiveId, api_key, api_url });
    if (a.user_id) writeBrief(effectiveId, a.user_id);
  } catch (err) { ... }
}
```

From mcp/src/capture/handoff-sync.ts:33-34 (the watermark filter that must learn about _pulled):
```typescript
const all = readEvents(dir);
const pending = wm ? all.filter((e) => e.event_id > wm) : all;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write migration 018 + add git_remote_url-first matcher + opportunistic backfill</name>
  <files>supabase/migrations/018_projects_git_remote_url.sql, backend/src/api/events-batch.ts</files>
  <read_first>
    - supabase/migrations/017_project_invites.sql (analog migration naming + structure; confirm idempotent `create index if not exists` pattern)
    - supabase/migrations/015_handoff_layer.sql (confirm handoff_events FK to users; verify ON DELETE CASCADE shape that the merge_projects function in Plan 05 will reckon with)
    - backend/src/api/events-batch.ts (full file 168 LOC — confirm matcher at lines 71-121, the `actor_user_id: user.id` line at :60 that MUST NOT be touched, the project_members insert that follows the project create)
    - backend/test/api/events-batch-auto-create.test.ts (Plan-01 RED cases about git_remote_url schema acceptance + matcher resolution)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 549-607 — exact extended matcher; lines 614-668 — exact migration SQL)
    - .planning/phases/02-real-user-identity/02-RESEARCH.md (lines 252-317 — Pattern 4 + precedence rationale; lines 608-633 — migration sketch; line 1051 — RLS notes)
  </read_first>
  <behavior>
    Migration 018 (NEW):
    - Adds `git_remote_url text` (nullable) column to projects table — uses `add column if not exists` for idempotence
    - Adds partial index `projects_user_remote_url_idx on projects(owner_id, git_remote_url) where git_remote_url is not null` — speeds the matcher hot path
    - No RLS policy changes (Worker uses service-role; existing 001_initial_schema.sql:79-86 policies still cover)

    events-batch.ts matcher extension (EXTEND):
    - Read `payload.git_remote_url` (optional) alongside `payload.git_basename`
    - If git_remote_url present AND memberProjectIds non-empty: SELECT id FROM projects WHERE git_remote_url = $1 AND id IN (memberProjectIds) — try this FIRST
    - If no URL match: fall back to existing name-match (status quo)
    - On name-match success WITH git_remote_url available AND existing row has NULL git_remote_url: opportunistic backfill via UPDATE projects SET git_remote_url = $1 WHERE id = $existing AND git_remote_url IS NULL
    - On create: insert with BOTH name AND git_remote_url populated
    - The actor_user_id override at line 60 (currently `actor_user_id: user.id` in the rowsToInsert .map) is PRESERVED VERBATIM
  </behavior>
  <action>
    Two files, coordinated:

    1. CREATE `supabase/migrations/018_projects_git_remote_url.sql` per PATTERNS.md lines 645-668. Use the exact SQL from RESEARCH.md lines 624-632. Header comment explains D-06 rationale (per PATTERNS.md line 647-657). Migration is purely additive — existing rows get NULL until their first post-Phase-2 event triggers the opportunistic backfill via the matcher.

    2. EXTEND `backend/src/api/events-batch.ts` matcher at lines 71-121 per PATTERNS.md lines 549-607. Three new pieces:
       - Read `payload.git_remote_url` alongside `payload.git_basename` (line ~83-84 of the new code)
       - URL-first match (lines ~88-95 of the new code) — only fires when `gitRemoteUrl` is non-null
       - Opportunistic backfill on name-match (lines ~108-114 of the new code) — only fires when name matched AND existing row's git_remote_url IS NULL AND we have a non-null gitRemoteUrl
       - Update the `projects.insert(...)` call to include `git_remote_url: gitRemoteUrl` (lines ~119-124 of the new code)
    Do NOT touch line 60 (`actor_user_id: user.id`) — per RESEARCH.md Pitfall 9. Do NOT remove or modify the existing project_members insert that follows the project create.
  </action>
  <verify>
    <automated>cd backend && npx vitest run test/api/events-batch-auto-create.test.ts 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - File `supabase/migrations/018_projects_git_remote_url.sql` exists
    - File contains `alter table projects` AND `add column if not exists git_remote_url`: `grep -c "add column if not exists git_remote_url" supabase/migrations/018_projects_git_remote_url.sql` ≥ 1
    - File contains `create index if not exists projects_user_remote_url_idx`: `grep -c "projects_user_remote_url_idx" supabase/migrations/018_projects_git_remote_url.sql` ≥ 1
    - `backend/src/api/events-batch.ts` contains `git_remote_url` references in the matcher: `grep -v '^//\|^[[:space:]]*\*\|^[[:space:]]*//' backend/src/api/events-batch.ts | grep -c "git_remote_url"` ≥ 3 (at least: payload read, URL-match select, backfill update OR insert column)
    - `backend/src/api/events-batch.ts:60` STILL contains `actor_user_id: user.id` (or equivalent — line number may shift, but the override must remain): `grep -c "actor_user_id: user.id\|actor_user_id: c.var.user.id" backend/src/api/events-batch.ts` ≥ 1
    - Plan-01 RED cases in `backend/test/api/events-batch-auto-create.test.ts` flip GREEN (3 cases: schema accepts git_remote_url, URL-populated cwd_<hash> resolves, name-only path still works)
    - `cd backend && npm run lint && npm run typecheck && npm test` — all pass
  </acceptance_criteria>
  <done>Migration file written; events-batch matcher extended; actor_user_id override regression-guard intact; Plan-01 events-batch tests flip GREEN.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: [BLOCKING] Apply migration 018 to Supabase via `supabase db push`</name>
  <files>supabase/migrations/018_projects_git_remote_url.sql</files>
  <read_first>
    - supabase/migrations/018_projects_git_remote_url.sql (written in Task 1)
    - .planning/STATE.md (line 17 — STATE notes Supabase CLI works on the primary machine; migrations 015/016/017 were re-applied here on 2026-05-20)
    - .planning/phases/02-real-user-identity/02-VALIDATION.md (line 72 — Manual gate for migration push)
  </read_first>
  <what-built>
    - Migration file `supabase/migrations/018_projects_git_remote_url.sql` has been written in Task 1.
    - Adds a nullable `git_remote_url text` column to the projects table.
    - Adds a partial index `projects_user_remote_url_idx` on `(owner_id, git_remote_url) where git_remote_url is not null`.
    - Migration is additive and idempotent (uses `if not exists` guards).
  </what-built>
  <how-to-verify>
    1. From the project root, ensure Supabase CLI is logged in:
       `supabase status` — should show the linked dogfood project URL; if not, `supabase login` (interactive) OR set `SUPABASE_ACCESS_TOKEN` env var for non-TTY automation.

    2. Run the push (DRY RUN first to confirm only 018 will be applied):
       `supabase db push --dry-run`
       Expected: output lists `018_projects_git_remote_url.sql` as the only pending migration (or no other pending ones if state is clean).

    3. Apply the migration:
       `supabase db push`
       Expected output: `Applying migration 018_projects_git_remote_url.sql...` then `Finished supabase db push.`

    4. Verify the column exists via the Supabase Dashboard:
       - Open https://supabase.com/dashboard → Project → Database → Tables → projects
       - Confirm the table has a new column `git_remote_url` of type `text`, nullable
       - Confirm a new index `projects_user_remote_url_idx` is present on the projects table

    5. Existing rows verification:
       - Run a query in SQL Editor: `SELECT count(*) FROM projects WHERE git_remote_url IS NULL;`
       - Expected: every pre-existing project row has NULL — the matcher in events-batch.ts will backfill opportunistically on subsequent events.

    6. If the push FAILS or interactive prompts cannot be suppressed:
       - Halt this plan; report the error.
       - Wrangler/CF deploy is on a separate machine per STATE.md, but Supabase CLI is confirmed working on the primary machine per the 2026-05-20 migration re-application history.
       - If a non-TTY workaround is needed: `SUPABASE_ACCESS_TOKEN=<token> supabase db push --debug`.

    Report back the dashboard verification screenshot or output of step 4-5 before proceeding to Task 3.
  </how-to-verify>
  <resume-signal>Type "approved" with confirmation that migration is applied and column visible in dashboard, OR describe the failure mode (e.g., "supabase CLI returned error X — need workaround").</resume-signal>
</task>

<task type="auto" tdd="true">
  <name>Task 3: MCP daemon-side — capture git_remote_url in hook + session-start payload</name>
  <files>mcp/src/cli/hook-dispatch.ts, mcp/src/hooks/session-start.ts</files>
  <read_first>
    - mcp/src/cli/hook-dispatch.ts (after Plan 02 Task 3 — confirm readUserIdFromConfig is in place; current readHookPayloadFromStdin shape at lines 48-69; existing execSync usage at top of file)
    - mcp/src/cli/resolve-project.ts (lines 23-39 — readGitSignals pattern that's the analog for the new getGitRemoteUrl helper)
    - mcp/src/hooks/session-start.ts (lines 10-17 — SessionStartArgs interface; lines 39-47 — current payload assembly with conditional git_basename spread)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 357-456 for hook-dispatch extension; lines 463-509 for session-start.ts extension)
    - .planning/phases/02-real-user-identity/02-RESEARCH.md (lines 562-605 — Common Operation 2; lines 597-604 — session-start payload extension shape)
  </read_first>
  <behavior>
    mcp/src/cli/hook-dispatch.ts (EXTEND):
    - Add a module-level `gitRemoteCache: Map<string, string | undefined>` (per-process, in-memory, NOT persisted)
    - Add `function getGitRemoteUrl(cwd: string): string | undefined` that:
      - Returns cached value if present (cwd is the key)
      - Otherwise runs `execSync("git config --get remote.origin.url", { cwd, stdio: ["ignore", "pipe", "ignore"] })` wrapped in try/catch
      - Caches the result (including undefined for non-git or no-remote cases)
    - Extend `readHookPayloadFromStdin` to include `git_remote_url: getGitRemoteUrl(cwd)` in the returned payload (alongside the existing git_basename field)

    mcp/src/hooks/session-start.ts (EXTEND):
    - Extend SessionStartArgs interface to accept `git_remote_url?: string`
    - In the appendEvent payload object, add conditional spread `...(args.git_remote_url ? { git_remote_url: args.git_remote_url } : {})` — mirrors the existing git_basename pattern
  </behavior>
  <action>
    Two files, coordinated:

    1. EXTEND `mcp/src/cli/hook-dispatch.ts` per PATTERNS.md lines 418-456. Add the gitRemoteCache Map and the getGitRemoteUrl helper at module level (NOT inside readHookPayloadFromStdin — it must persist across invocations within the same process). Extend the returned payload object inside readHookPayloadFromStdin with `git_remote_url: getGitRemoteUrl(cwd)`. The cache is per-process in-memory; do NOT persist it to disk (per RESEARCH.md anti-pattern line 459).

    2. EXTEND `mcp/src/hooks/session-start.ts` per PATTERNS.md lines 481-507. Update the SessionStartArgs interface at lines 10-17 to add `git_remote_url?: string`. Update the appendEvent payload object at lines 39-47 to spread `git_remote_url` conditionally (mirrors the git_basename conditional). Do NOT modify any other handler (the other hook handlers — post-tool-use, etc. — emit events without git_remote_url; that's fine because the matcher only consults the FIRST event per cwd_<hash>, and the SessionStart event is the natural carrier).

    Per `feedback_no_lockfile.md`: no new npm packages, no lockfile changes.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/hook-dispatch.test.ts test/hooks/session-start.test.ts 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "getGitRemoteUrl" mcp/src/cli/hook-dispatch.ts` ≥ 2 (definition + call site in readHookPayloadFromStdin)
    - `grep -c "gitRemoteCache" mcp/src/cli/hook-dispatch.ts` ≥ 1 (module-level Map exists)
    - `grep -c "git_remote_url" mcp/src/cli/hook-dispatch.ts` ≥ 1 (payload field)
    - `grep -c "git_remote_url" mcp/src/hooks/session-start.ts` ≥ 2 (interface field + payload spread)
    - Existing hashCwd / git_basename regression tests still pass: `cd mcp && npx vitest run test/cli/hook-dispatch.test.ts test/hooks/session-start.test.ts 2>&1 | tail -5` shows PASS
    - `cd mcp && npm run lint && npm run typecheck && npm test` — all pass
  </acceptance_criteria>
  <done>hook-dispatch.ts captures git_remote_url at hook-write time via execSync; session-start.ts payload includes git_remote_url conditionally; module-level cache avoids per-event shell-out; mcp suite green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: MCP daemon — add runEagerPullCycle + extend runFlushCycle filter + wire into cycle loop</name>
  <files>mcp/src/capture/handoff-sync.ts, mcp/src/capture/daemon.ts</files>
  <read_first>
    - mcp/src/capture/handoff-sync.ts (full file — confirm runFlushCycle structure, runPullCycle template at lines 72-84, the watermark filter at lines 33-34, FlushArgs type)
    - mcp/src/capture/daemon.ts (lines 135-188 — cycle loop with per-project flush/pull and the canonical_project_id remap branch)
    - mcp/src/capture/events-log.ts (lines 1-53 — ULID generation, appendEvent, readEvents — confirm event_id is the ULID source-of-truth and order)
    - backend/src/api/project-events.ts (entire file — confirm the GET /api/projects/:id/events endpoint shape: `{ events: Row[], next_since: string | null }` with limit param; confirm events are returned in ascending event_id order per line 18 mentioned in RESEARCH.md)
    - packages/shared/src/handoff/types.ts (Event type — confirm event_id field exists and is the ULID string)
    - mcp/test/capture/handoff-sync.test.ts (Plan-01 RED cases for runEagerPullCycle — 5 cases listed in 02-VALIDATION.md line 58)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 836-907 — runEagerPullCycle spec + filter extension; lines 911-963 — daemon cycle integration)
    - .planning/phases/02-real-user-identity/02-RESEARCH.md (lines 322-371 — Pattern 5; lines 470-481 — Pitfalls 3 + 4 around dedupe and watermark race)
  </read_first>
  <behavior>
    mcp/src/capture/handoff-sync.ts (EXTEND):
    - Export `async function runEagerPullCycle(a: FlushArgs & { limit?: number }): Promise<{ pulled: number }>`:
      - Default limit = 500
      - Fetches GET /api/projects/:id/events?limit=N with Bearer auth
      - On non-OK: throws "eager pull failed: <status>"
      - On empty events: returns { pulled: 0 } (no file mutation)
      - Otherwise: appends each event to events.jsonl with an added `_pulled: true` field (JSON stringify per line, newline-terminated)
      - Writes `.watermark` to the highest pulled event_id (events are returned ascending so events[length-1] is the highest)
    - Update runFlushCycle's watermark filter (lines 33-34) to ALSO filter out events with `_pulled: true`:
      `const pending = (wm ? all.filter((e) => e.event_id > wm) : all).filter((e) => !(e as { _pulled?: boolean })._pulled);`

    mcp/src/capture/daemon.ts (EXTEND):
    - Add `import { runEagerPullCycle } from "./handoff-sync.js";` alongside the existing runFlushCycle / runPullCycle imports
    - Inside the per-project loop at lines 144-158, when `flush.canonical_project_id` is set (first-time link), call `await runEagerPullCycle({ project_id: effectiveId, api_key, api_url })` BEFORE the existing runPullCycle call
    - Eager-pull failures are caught by the surrounding try/catch (per PATTERNS.md line 950)
    - Subsequent flushes already have the canonical UUID; canonical_project_id will NOT be set again, so eager-pull does NOT re-fire on every cycle (per RESEARCH.md Pattern 5 idempotence, lines 367-371)
  </behavior>
  <action>
    Two files, coordinated:

    1. EXTEND `mcp/src/capture/handoff-sync.ts`:
       - Add the Event type import if not present: `import type { Event } from "@synapse/shared/handoff/types.js";` (or local equivalent — check existing import style)
       - Append `export async function runEagerPullCycle(...)` per PATTERNS.md lines 865-889. Use `fs.appendFileSync` to write all pulled events at once (one JSON per line, joined with newlines, terminating newline). Bump `.watermark` to the highest event_id AFTER appending — order matters so a crash between append and watermark write leaves the system in a recoverable state (the next cycle would re-eager-pull, then idempotently dedupe via the _pulled marker on the existing appended lines — though we don't add explicit dedupe in Phase 2; the marker prevents flush-side double-post, which is the primary safety).
       - Update the watermark filter at lines 33-34 per PATTERNS.md lines 900-905. Belt-and-suspenders: the `_pulled` filter runs AFTER the watermark filter so even if watermark is out of sync, _pulled events never reach the POST body (per RESEARCH.md Pitfall 4, lines 476-481).

    2. EXTEND `mcp/src/capture/daemon.ts`:
       - Add the import line per PATTERNS.md line 938
       - Inside the existing per-project for-loop at lines 144-158, after the `a.projects[i] = flush.canonical_project_id;` line and BEFORE the existing `await runPullCycle(...)`, call `await runEagerPullCycle({ project_id: effectiveId, api_key: a.api_key, api_url: a.api_url });` ONLY inside the `if (flush.canonical_project_id) { ... }` branch (per PATTERNS.md lines 945-954).
       - The surrounding try/catch already handles errors (per the existing line 154-157 catch block) — no new error handling needed.

    Per RESEARCH.md Pitfall 3 (line 470-475): if dedupe-by-event_id becomes a real concern in dogfood, file a follow-up. For Phase 2, the _pulled marker is sufficient — the same event_id appearing twice in events.jsonl is local-disk bloat, not a correctness bug, because (a) the reducer is idempotent and (b) the flush filter excludes _pulled rows from the POST body.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/capture/handoff-sync.test.ts 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export async function runEagerPullCycle" mcp/src/capture/handoff-sync.ts` ≥ 1
    - `grep -c "_pulled" mcp/src/capture/handoff-sync.ts` ≥ 2 (marker write + filter check)
    - `grep -c "runEagerPullCycle" mcp/src/capture/daemon.ts` ≥ 2 (import + call)
    - The runEagerPullCycle call in daemon.ts is INSIDE the `if (flush.canonical_project_id)` block: `grep -B 3 "runEagerPullCycle" mcp/src/capture/daemon.ts | grep -c "canonical_project_id"` ≥ 1
    - The watermark filter is updated to chain the _pulled filter: `grep -A 1 "wm ? all.filter" mcp/src/capture/handoff-sync.ts | grep -c "_pulled" `≥ 1
    - Plan-01 RED cases in `mcp/test/capture/handoff-sync.test.ts` flip GREEN:
      - runEagerPullCycle writes _pulled markers + advances watermark
      - Empty pull is a no-op
      - 401/5xx throws cleanly
      - Subsequent runFlushCycle filters _pulled out of POST body
      - Locally-captured (non-_pulled) events still in POST body
    - `cd mcp && npm run lint && npm run typecheck && npm test` — all pass
  </acceptance_criteria>
  <done>runEagerPullCycle exported + tested; flush filter excludes _pulled; daemon cycle calls eager-pull only on first-time link; Plan-01 handoff-sync tests flip GREEN.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Verify E2E multi-device test (handoff.e2e.test.ts) passes end-to-end</name>
  <files>mcp/test/e2e/handoff.e2e.test.ts</files>
  <read_first>
    - mcp/test/e2e/handoff.e2e.test.ts (after Plan-01 Task 3 extended it with the multi-device describe block; verify the test asserts machine-A focus + hostname appear in machine-B's brief after eager-pull)
    - mcp/test/e2e/stub-backend.ts (in-process stub — confirm it serves GET /api/projects/:id/events for the eager-pull arm; if not, extend it locally now)
    - .planning/phases/02-real-user-identity/02-VALIDATION.md (line 61 — multi-device scenario contract)
  </read_first>
  <behavior>
    - The Plan-01 RED describe block "machine A → machine B cross-device sync" (or equivalent name) now PASSES
    - The test exercises the end-to-end path: machine A captures + flushes via stub → canonical_project_id remap → machine B with same user_id different device_id → eager-pull → brief renders with machine A's hostname + focus
    - No new test code is added in this task — the test was scaffolded in Plan 01; this task just verifies the chain works end-to-end
  </behavior>
  <action>
    Run the e2e test and confirm GREEN. If the test was scaffolded in Plan 01 but the stub-backend.ts doesn't yet serve GET /api/projects/:id/events, extend the stub here (minimal additions): add a route handler that returns `{ events: Event[], next_since: null }` for the canonical project_id seeded by the test setup. The stub is in-process and local to test/e2e/; the extension is small.

    If the test fails for a reason OTHER than the eager-pull chain not working — e.g., flush still emits the placeholder user_id because the test forgot to write config.json before invoking the hook — debug at that level and fix; do NOT mask with `it.skip`.
  </action>
  <verify>
    <automated>cd mcp && TEST_E2E=1 npx vitest run test/e2e/handoff.e2e.test.ts 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - Running `cd mcp && TEST_E2E=1 npx vitest run test/e2e/handoff.e2e.test.ts` shows ALL describe blocks PASS (no FAIL lines in the output; "Tests" summary shows 0 failed)
    - The new "machine A → machine B" describe block reports PASS (existing machine-A-only describe also PASSes — regression guard)
    - `cd mcp && npm run lint && npm run typecheck` — both pass
  </acceptance_criteria>
  <done>handoff.e2e.test.ts is fully green; the multi-device scenario validates the end-to-end chain from Plans 02 (identity) + 03 (brief device-origin) + 04 (this plan, eager-pull + matcher); no `.skip` was added.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Daemon hook → git CLI | execSync runs in the user's shell against their cwd; the cwd is trusted (it's the user's own project) |
| Daemon → backend /api/events/batch | Backend matcher reads payload.git_remote_url but ALWAYS filters by membership (events-batch.ts lines 79-80) — URL alone cannot bridge users |
| Daemon → backend GET /api/projects/:id/events | Already authMiddleware + membership-checked at backend/src/api/project-events.ts |
| Migration → prod Supabase | Service-role push from local CLI; column is additive (no data loss possible) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-02 | Tampering | Daemon claims a git_remote_url it doesn't actually have, attempting to match into another user's project | mitigate | The events-batch matcher filters by `memberProjectIds` BEFORE consulting git_remote_url (PATTERNS.md line 569-572 + RESEARCH.md line 952). A user can't match into a project they don't already own. URL is only used to select among the user's OWN projects. |
| T-02-03 | Information Disclosure | Eager-pulled events from one user leak across users | mitigate | The eager-pull endpoint (GET /api/projects/:id/events at backend/src/api/project-events.ts) is authMiddleware-gated AND membership-checked; the api_key used by the daemon belongs to the user; the canonical_project_id was just minted for THIS user via the events-batch match flow. Cross-user leak is impossible because the user is established as a member at the moment the canonical_project_id is returned. |
| T-02-SHELL | Injection | execSync with cwd from event hook | accept | `git config --get remote.origin.url` is a static command; cwd is the user's own directory (not from any network input). stdio is bounded (["ignore", "pipe", "ignore"]). The execSync invocation cannot be steered by an attacker. |
</threat_model>

<verification>
- `cd backend && npx vitest run test/api/events-batch-auto-create.test.ts` — Plan-01 RED cases GREEN
- `cd mcp && npx vitest run test/cli/hook-dispatch.test.ts test/hooks/session-start.test.ts test/capture/handoff-sync.test.ts` — Plan-01 RED cases GREEN
- `cd mcp && TEST_E2E=1 npx vitest run test/e2e/handoff.e2e.test.ts` — all describes PASS including new multi-device scenario
- Full pre-push gate: `npm run lint && npm run typecheck && npm run test` from repo root passes
- Manual gate (verify-work): on a CF-enabled machine, deploy backend via `wrangler deploy` after the migration is applied; then run `node mcp/scripts/test-cli-flow.mjs` against production — expect 0 errors and the flushed events appear in `handoff_events` with `actor_user_id = <real-uuid>` AND projects table row has `git_remote_url` populated
- Manual gate (verify-work): physically test on two machines — Machine A captures, Machine B fresh install with same user_id → brief on B contains A's hostname + focus
</verification>

<success_criteria>
- IDENT-02 SC #2 satisfied: machine B's brief includes machine A's activity within one daemon cycle
- Migration 018 is applied to dogfood Supabase (verified via dashboard column inspection)
- All Plan-01 RED test cases for Slice B flip GREEN (events-batch-auto-create, hook-dispatch git_remote_url additions, session-start payload, handoff-sync eager-pull + filter, e2e multi-device)
- actor_user_id override at events-batch.ts:60 is UNCHANGED (regression-protected)
- No new npm dependencies added (no lockfile churn)
- Eager-pull runs ONLY on first-time canonical_project_id remap (not on every cycle) — verified by handoff-sync test assertions
</success_criteria>

<output>
Create `.planning/phases/02-real-user-identity/02-04-SUMMARY.md` when done. Summary must:
- Confirm migration 018 applied to dogfood Supabase (dashboard verification done)
- Confirm events-batch matcher tries git_remote_url first + opportunistic backfill on name-match + creates with both fields
- Confirm hook-dispatch captures git_remote_url with per-process cache (no disk persistence)
- Confirm session-start payload includes git_remote_url conditionally
- Confirm runEagerPullCycle exported and called only inside the canonical_project_id branch of the daemon cycle
- Confirm runFlushCycle filters _pulled events out of POST body (belt-and-suspenders with watermark)
- List which Plan-01 RED cases flipped GREEN (events-batch-auto-create, hook-dispatch git_remote_url additions, session-start payload, handoff-sync eager-pull, e2e multi-device)
- Note manual gate: after merge to main + backend deploy on CF machine, run `node mcp/scripts/test-cli-flow.mjs` against prod for end-to-end smoke
- Note that Plan 05 (manual link UI) is the natural follow-on for D-07
</output>
