---
phase: 02-real-user-identity
plan: 5
type: execute
wave: 4
depends_on: ["02-01", "02-04"]
files_modified:
  - supabase/migrations/018_projects_git_remote_url.sql
  - backend/src/api/projects.ts
  - frontend/src/lib/components/project-link/LinkPicker.svelte
  - frontend/src/routes/(app)/projects/[name]/settings/+page.svelte
  - frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts
  - frontend/src/lib/server/api.ts
autonomous: false
requirements: [IDENT-02]
threat_refs: [T-02-01, T-02-02]

must_haves:
  truths:
    - "Owner of two projects can navigate to source project Settings → Linked Projects → pick a target → type-to-confirm → atomic merge"
    - "Merge endpoint enforces owner role on BOTH source AND target (V4 access control)"
    - "merge_projects RPC reassigns handoff_events / conversations / entries / activity_log to target, deletes source row"
    - "Target project's ProjectStatus is recomputed after merge so its events list reflects the merged set"
    - "Inline-expand pattern mirrors DangerZone.svelte (NO floating modal — per UI-SPEC)"
    - "Two-step destructive gate: pick target → type source project name → click 'Link projects & delete source'"
    - "Error mapping covers 403 / 404 / 409 / 5xx / network — locked copy from UI-SPEC §State F"
  artifacts:
    - path: "supabase/migrations/018_projects_git_remote_url.sql"
      provides: "merge_projects SQL function appended (or new migration 019_merge_projects.sql — planner picks)"
      contains: "create or replace function merge_projects"
    - path: "backend/src/api/projects.ts"
      provides: "POST /:id/merge-into/:target_id endpoint with owner-check ×2 + RPC + activity log + recompute"
      contains: "merge-into"
    - path: "frontend/src/lib/components/project-link/LinkPicker.svelte"
      provides: "Inline-expand state-machine component (States A-F per UI-SPEC)"
      contains: "Linked Projects"
    - path: "frontend/src/routes/(app)/projects/[name]/settings/+page.svelte"
      provides: "Mounts LinkPicker as sibling section to Members"
      contains: "LinkPicker"
    - path: "frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts"
      provides: "linkProject form action with status-code-to-copy error mapping"
      contains: "linkProject"
  key_links:
    - from: "frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts:linkProject"
      to: "backend POST /api/projects/:id/merge-into/:target_id"
      via: "api.mergeProjects() in frontend/src/lib/server/api.ts"
      pattern: "mergeProjects"
    - from: "backend/src/api/projects.ts:merge-into route"
      to: "merge_projects RPC"
      via: "db.rpc('merge_projects', { p_source_id, p_target_id, p_user_id })"
      pattern: "merge_projects"
    - from: "backend/src/api/projects.ts:merge-into route"
      to: "recomputeProjectStatus"
      via: "imported from ../lib/handoff-reducer"
      pattern: "recomputeProjectStatus"
---

<objective>
Implement Slice C — Manual link UI per D-07 + UI-SPEC.md. When the auto-link via git_remote_url (Plan 04) gets the cross-device match wrong — or the user wants to unify two separately-auto-created projects — the user can navigate to a project's Settings page, click "Link to existing project," pick a target, type-to-confirm, and the source project's events are atomically reassigned to the target while the source row is deleted.

Backend: new `POST /api/projects/:id/merge-into/:target_id` endpoint + `merge_projects(p_source, p_target, p_user)` SQL RPC. Owner-check enforced on BOTH source AND target (V4 access control per RESEARCH security map).

Frontend: new `LinkPicker.svelte` component (~200 LOC) mounted on the existing project Settings page (sibling to Members). Inline-expand pattern mirroring `DangerZone.svelte` — NO floating modal (locked by UI-SPEC §Out of Scope).

Purpose: deliver D-07 — the manual override that makes IDENT-02 reliable when auto-link is wrong. Closes the IDENT-02 surface for Phase 2.

Output: 1 SQL function (appended to migration 018 OR new 019 — planner picks), 1 NEW backend route, 1 NEW Svelte component, 3 EXTENDED files (settings page + page server action + api client method).
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
@.planning/phases/02-real-user-identity/02-UI-SPEC.md
@.planning/phases/02-real-user-identity/02-VALIDATION.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/STRUCTURE.md
@backend/src/api/projects.ts
@backend/src/api/auth.ts
@backend/src/lib/handoff-reducer.ts
@backend/src/middleware/project-auth.ts
@backend/src/db/activity-logger.ts
@frontend/src/lib/components/account/DangerZone.svelte
@frontend/src/routes/(app)/projects/[name]/settings/+page.svelte
@frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts
@frontend/src/lib/server/api.ts
@supabase/migrations/010_reset_user_data.sql

<interfaces>
<!-- Backend patterns from Plan 02 + existing routes; frontend patterns from DangerZone analog + UI-SPEC. -->

From backend/src/api/auth.ts:519-536 (RPC-call pattern — the analog for the new merge route):
```typescript
account.post("/reset", async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  const { error: rpcErr } = await db.rpc("reset_user_data", { p_user_id: user.id });
  if (rpcErr) {
    console.error("[account/reset] rpc error:", JSON.stringify(rpcErr));
    return c.json({ error: `Reset failed: ${rpcErr.message}`, code: "RESET_ERROR" }, 500);
  }
  // ... post-RPC follow-up
  return c.json({ ok: true });
});
```

From backend/src/api/projects.ts:76-83 (owner-check pattern — must be called for BOTH source and target):
```typescript
const projectId = c.req.param("id");
const db = c.get("db");
await requireRole(db, projectId, user.id, "owner");
```

From backend/src/lib/handoff-reducer.ts:5-19 (recomputeProjectStatus — called after RPC to rebuild target's status from the merged event set; signature: recomputeProjectStatus(db, projectId))

From supabase/migrations/010_reset_user_data.sql (the SQL function analog — security definer, plpgsql, loops with select-from-membership):
```sql
create or replace function reset_user_data(p_user_id uuid)
returns void language plpgsql security definer as $$
declare pid uuid;
begin
  for pid in select project_id from project_members where user_id = p_user_id loop
    -- per-project cleanup
  end loop;
  delete from projects where owner_id = p_user_id;
end;
$$;
```

From frontend/src/lib/components/account/DangerZone.svelte (the inline-expand state-machine analog — see PATTERNS.md lines 1061-1142 for the spec; UI-SPEC.md §Surfaces 1 for the LinkPicker State A-F structure):
- State A (idle): trigger button only
- State B (picker open): inline-expanded card with candidates + Cancel/Continue
- State C (confirm gate): type-to-match input + Cancel/Link
- State D (loading): spinner inside the destructive button
- State E (success): inline green banner, then 1200ms goto target
- State F (error): inline alert with locked copy from UI-SPEC §State F

Form action pattern from frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts:11-26 (addMember analog — fail(status, {...Error: "..."})):
```typescript
linkProject: async ({ request, locals }) => {
  const data = await request.formData();
  // ... extract sourceProjectId, targetProjectId
  try { await api.mergeProjects(sourceProjectId, targetProjectId); }
  catch (err) { return fail(status, { linkError: "..." }); }
  throw redirect(303, `/projects/<target-name>/settings`);
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: SQL — append merge_projects function to migration 018 + push to Supabase</name>
  <files>supabase/migrations/018_projects_git_remote_url.sql</files>
  <read_first>
    - supabase/migrations/018_projects_git_remote_url.sql (written + applied in Plan 04 Task 1+2 — APPEND the function here so a single migration carries D-06 + D-07 SQL; alternative: create a new 019_merge_projects.sql file — Claude's discretion per PATTERNS.md line 800-801. Recommendation: append to 018 because 018 is already applied to dogfood and `create or replace function` is idempotent, so re-running the migration adds the function without touching the column. If 018 is too far gone for safe re-run, create 019.)
    - supabase/migrations/010_reset_user_data.sql (analog SQL function structure — security definer, plpgsql, owner-check + reassign-then-delete)
    - supabase/migrations/015_handoff_layer.sql (confirm handoff_events / handoff_project_status / conversations / entries FK shape — these are the tables that reference projects.id and need REASSIGNMENT not cascade-delete)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 800-832 — exact SQL function body)
    - .planning/phases/02-real-user-identity/02-RESEARCH.md (lines 678-704 — Common Operation 4 SQL function; Pitfall 7 lines 494-506 — reassign-FIRST-then-delete; line 832 in PATTERNS — handoff_project_status delete-source instead of update, because target may already have a status row)
  </read_first>
  <behavior>
    SQL function `merge_projects(p_source_id uuid, p_target_id uuid, p_user_id uuid) returns void`:
    - language plpgsql, security definer
    - Verifies p_user_id is owner of BOTH p_source_id and p_target_id; raises exception if not (defense-in-depth alongside API-tier check)
    - Reassigns FIRST, then deletes (per Pitfall 7):
      - UPDATE handoff_events SET project_id = p_target_id WHERE project_id = p_source_id
      - DELETE handoff_project_status WHERE project_id = p_source_id (do NOT update — target may already have a status row; backend will recompute after)
      - UPDATE conversations SET project_id = p_target_id WHERE project_id = p_source_id
      - UPDATE entries SET project_id = p_target_id WHERE project_id = p_source_id
      - UPDATE activity_log SET project_id = p_target_id WHERE project_id = p_source_id
    - Then: DELETE FROM projects WHERE id = p_source_id (cascades any remaining FKs like project_members, but those don't carry irreplaceable data)
    - Wrapped implicitly in a transaction (plpgsql function = atomic)
  </behavior>
  <action>
    1. APPEND the SQL function to `supabase/migrations/018_projects_git_remote_url.sql`. Use the exact body from PATTERNS.md lines 802-829. The `create or replace function` is idempotent — re-running the migration is safe. Note: PATTERNS.md line 695 already corrects the `handoff_project_status` handling (DELETE source rather than UPDATE — to avoid PK conflict if target has a status row).

    2. Apply the migration: run `supabase db push` from the project root. If the dry-run shows other pending migrations (it shouldn't — 018 was the most recent in Plan 04), abort and reconcile. Verify the function exists via the Supabase Dashboard SQL Editor:
       `select proname from pg_proc where proname = 'merge_projects';`

       Expected: one row.

    3. If pushing the same migration file fails because Supabase considers 018 already-applied and won't re-apply it: create a NEW file `supabase/migrations/019_merge_projects.sql` containing ONLY the `create or replace function merge_projects(...)` block, then `supabase db push` again.
  </action>
  <verify>
    <automated>grep -c "create or replace function merge_projects" supabase/migrations/018_projects_git_remote_url.sql supabase/migrations/019_merge_projects.sql 2>/dev/null | grep -v ":0"</automated>
  </verify>
  <acceptance_criteria>
    - Either `supabase/migrations/018_projects_git_remote_url.sql` OR `supabase/migrations/019_merge_projects.sql` contains `create or replace function merge_projects(`: `grep -lE "create or replace function merge_projects" supabase/migrations/01[89]*.sql | wc -l` ≥ 1
    - The SQL function does owner-check on both source and target: `grep -c "not owner" supabase/migrations/01[89]*.sql 2>/dev/null` ≥ 2 (one for source, one for target)
    - The SQL function reassigns (UPDATE) handoff_events, conversations, entries, activity_log to target — does NOT use DELETE-and-recreate: `grep -E "^[[:space:]]*update[[:space:]]+(handoff_events|conversations|entries|activity_log)" supabase/migrations/01[89]*.sql | wc -l` ≥ 4
    - The SQL function deletes (not updates) handoff_project_status for the source: `grep -E "^[[:space:]]*delete[[:space:]]+from[[:space:]]+handoff_project_status" supabase/migrations/01[89]*.sql | wc -l` ≥ 1
    - Function applied to Supabase: manual verification via dashboard SQL Editor `select proname from pg_proc where proname = 'merge_projects';` returns 1 row (operator confirms in checkpoint task or in the SUMMARY)
  </acceptance_criteria>
  <done>merge_projects function exists in the migrations directory and is applied to dogfood Supabase; owner-check + reassign-then-delete shape per PATTERNS.md.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Backend — add POST /api/projects/:id/merge-into/:target_id route</name>
  <files>backend/src/api/projects.ts</files>
  <read_first>
    - backend/src/api/projects.ts (full file — confirm Hono sub-app mount at lines 35-37 with authMiddleware + idempotency; confirm requireRole usage at lines 76-83 for the addMember route; confirm logActivity usage at lines 51-57 for createProject; the final `export { projects };` line is the end-of-file anchor where the new route inserts BEFORE)
    - backend/src/middleware/project-auth.ts (requireRole signature — confirm it throws ForbiddenError when the user doesn't have the requested role)
    - backend/src/db/activity-logger.ts (logActivity signature — confirm it takes db + { project_id, user_id, action, source, metadata })
    - backend/src/lib/handoff-reducer.ts (lines 5-19 — confirm recomputeProjectStatus signature `(db, projectId)` — already imported by events-batch.ts:4 as the canonical pattern)
    - backend/test/api/projects-merge.test.ts (Plan-01 RED cases — 401 unauth + route-registered structural + skip live-DB cases)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 725-767 — exact route shape; lines 681-723 — pattern source from existing reset + addMember + createProject routes)
    - .planning/phases/02-real-user-identity/02-RESEARCH.md (lines 642-673 — Common Operation 4 route; security V4 ASVS at line 935)
  </read_first>
  <behavior>
    POST /api/projects/:id/merge-into/:target_id:
    - Extract `sourceId` from `:id` param, `targetId` from `:target_id` param
    - Owner-check on sourceId via `requireRole(db, sourceId, user.id, "owner")` — throws ForbiddenError (403) if not
    - Owner-check on targetId via `requireRole(db, targetId, user.id, "owner")` — throws ForbiddenError (403) if not
    - If sourceId === targetId → return 409 with code SELF_LINK_ERROR (UI-SPEC §State F maps this to "You can't link a project to itself")
    - Call db.rpc("merge_projects", { p_source_id: sourceId, p_target_id: targetId, p_user_id: user.id })
    - On RPC error: console.error with `[projects/merge]` prefix; return c.json({ error, code: "MERGE_ERROR" }, 500)
    - On RPC success: await logActivity(db, { project_id: targetId, user_id: user.id, action: "project_merged", source: "human", metadata: { source_project_id: sourceId } })
    - Then await recomputeProjectStatus(db, targetId)
    - Return c.json({ ok: true, project_id: targetId })
    - All inputs (sourceId, targetId) are URL params — Hono's `c.req.param()` returns string; further UUID validation is NOT strictly required (the SQL RPC will fail with a clear error if either is malformed UUID); BUT add a zod parse via `safeParseUuid` or inline regex for early-fail 400 if convenient — Claude's discretion. Per UI-SPEC §State F, a 400 is not in the locked error-copy table (the UI is constructed to only submit valid UUIDs).
  </behavior>
  <action>
    EXTEND `backend/src/api/projects.ts`:
    1. Add `import { recomputeProjectStatus } from "../lib/handoff-reducer";` at the top (verify it's not already imported — events-batch.ts:4 imports it but projects.ts might not).
    2. Insert the new route BEFORE the final `export { projects };` line. Use the exact body from PATTERNS.md lines 727-762.
    3. Add a self-link guard BEFORE the owner-checks: if (sourceId === targetId) throw new ConflictError("Cannot link a project to itself"); — this maps to UI-SPEC §State F 409 copy.
    4. The route inherits authMiddleware + idempotency from the existing `projects.use("*", ...)` at lines 35-37 — no need to add.
    5. Log prefix: `[projects/merge]` (mirrors `[account/reset]` at auth.ts:526).
  </action>
  <verify>
    <automated>cd backend && npx vitest run test/api/projects-merge.test.ts 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "merge-into" backend/src/api/projects.ts` ≥ 1
    - The route invokes requireRole TWICE for source + target: `grep -A 6 "merge-into" backend/src/api/projects.ts | grep -c "requireRole" ` ≥ 2
    - The route calls db.rpc("merge_projects", ...): `grep -A 12 "merge-into" backend/src/api/projects.ts | grep -c "merge_projects"` ≥ 1
    - The route calls recomputeProjectStatus(db, ...): `grep -A 20 "merge-into" backend/src/api/projects.ts | grep -c "recomputeProjectStatus"` ≥ 1
    - The route calls logActivity with action: "project_merged": `grep -A 18 "merge-into" backend/src/api/projects.ts | grep -c "project_merged"` ≥ 1
    - Plan-01 RED cases in `backend/test/api/projects-merge.test.ts` flip GREEN (401 unauth PASSES, route-registered not-404 PASSES; skip cases stay skip)
    - `cd backend && npm run lint && npm run typecheck && npm test` — all pass
    - The route handles self-link guard (sourceId === targetId): manually verify by reading the new code — there's a 409/ConflictError raise before the owner-checks
  </acceptance_criteria>
  <done>projects.ts has the new merge-into route with owner-check ×2 + self-link guard + RPC call + logActivity + recomputeProjectStatus; Plan-01 projects-merge tests flip GREEN.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Frontend — create LinkPicker.svelte component (States A-F per UI-SPEC)</name>
  <files>frontend/src/lib/components/project-link/LinkPicker.svelte</files>
  <read_first>
    - frontend/src/lib/components/account/DangerZone.svelte (full file — confirm the inline-expand state-machine pattern, $state runes, use:enhance form-action pattern, disabled-on-loading button shape, type-to-confirm input)
    - frontend/src/app.css (confirm classes used: .btn-primary, .btn-danger, .btn-secondary, .glass, .spinner, .spinner-sm, .spinner-white — all already defined; CSS vars --color-bg, --color-border, --color-accent, --color-danger, --color-text-muted etc. — all already defined)
    - frontend/src/routes/(app)/home/+page.svelte (lines 87-89 for .error-msg + lines 88 role="alert"; lines 92 role="status"; lines 295-299 for hover:translate; lines 336-343 for badge shape — these are the cross-file analogs UI-SPEC.md references for the LinkPicker styles)
    - .planning/phases/02-real-user-identity/02-UI-SPEC.md (the entire file is the design contract — copywriting locked at §Copywriting Contract; state machine at §Interaction Contracts; accessibility at §Accessibility Contract; out-of-scope at §Out of Scope)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 1057-1248 — LinkPicker skeleton specification)
  </read_first>
  <behavior>
    Component file `frontend/src/lib/components/project-link/LinkPicker.svelte`:

    Props (Svelte 5 $props rune):
    - `sourceProjectId: string`
    - `sourceProjectName: string`
    - `candidates: Candidate[]` — auto-match top section (matched_by_remote === true)
    - `allOtherProjects: Candidate[]` — "Your other projects" section
    - `linkError?: string` — server-side error from the form action

    where Candidate = { id: string; name: string; conversation_count: number; last_activity?: string; matched_by_remote: boolean }

    Local state ($state runes):
    - `showPicker = false` (State A ↔ State B toggle)
    - `selectedTargetId = ""` (radio selection)
    - `showConfirm = false` (State B → State C)
    - `confirmInput = ""` (type-to-match value)
    - `linking = false` (State D loading)
    - `derived confirmed = $derived(confirmInput === sourceProjectName)`
    - `derived hasAnyTargets = $derived(allOtherProjects.length > 0 || candidates.length > 0)`

    States rendered (per UI-SPEC §Surfaces 1, States A-F):
    - State A (default): outer card with section heading "Linked Projects" + body copy + "+ Link to existing project" trigger button (disabled if !hasAnyTargets with helper "(You need at least 2 projects to link.)")
    - State B (showPicker && !showConfirm): card expanded with Suggested Matches section (if candidates.length > 0; renders the "Matched" badge per UI-SPEC §Surfaces 1) + "Your other projects" section + Cancel + Continue (disabled until selectedTargetId is non-empty); empty-state branch when !hasAnyTargets
    - State C (showConfirm): type-to-confirm input with placeholder `Type "<source-name>" to confirm` + Cancel + "Link projects & delete source" (disabled until confirmed === true)
    - State D (linking): spinner inside the destructive button, all controls disabled
    - State E (success): handled by SvelteKit redirect from the form action (NOT in this component — server-side redirect)
    - State F (error): inline alert with role="alert" rendering linkError prop above the picker controls; stays in current state (B or C) for retry

    Accessibility (per UI-SPEC §Accessibility Contract):
    - Wrap in `<section aria-labelledby="linked-projects-heading">` with `<h2 id="linked-projects-heading">Linked Projects</h2>`
    - Use `<fieldset>` + `<legend class="sr-only">Select target project</legend>` around radio inputs
    - "Matched" badge has `aria-label="Matched: same git remote URL"`
    - Error banner has `role="alert"`; success banner (rendered by parent) has `role="status"`
    - Escape key collapses to State A from any state (wire on keydown on the section container)
    - Focus management: on State A→B transition, focus first radio or Cancel; on B→C, focus the text input — use `tick()` + .focus()

    All visible copy is the verbatim locked strings from UI-SPEC §Copywriting Contract.

    Form submission:
    - Inside State C, the "Link projects & delete source" button is inside a `<form method="POST" action="?/linkProject" use:enhance={...}>`
    - Hidden inputs: `<input type="hidden" name="sourceProjectId" value={sourceProjectId} />` and `<input type="hidden" name="targetProjectId" value={selectedTargetId} />`
    - use:enhance callback toggles `linking` true → false after the response and lets SvelteKit handle redirect/error
  </behavior>
  <action>
    CREATE `frontend/src/lib/components/project-link/LinkPicker.svelte` per the skeleton in PATTERNS.md lines 1144-1244 and UI-SPEC.md §Surfaces 1. Use Svelte 5 runes (`$state`, `$props`, `$derived`). All visible copy is VERBATIM from UI-SPEC §Copywriting Contract — do NOT paraphrase. No new CSS classes; use existing `.btn-primary`, `.btn-danger`, `.btn-secondary`, `.glass`, `.spinner`, `.spinner-sm`, `.spinner-white` and CSS vars from app.css. The component is ~200 LOC.

    Per UI-SPEC §Out of Scope: NO floating modal, NO `<dialog>` primitive, NO icon library, NO toast component, NO loading skeleton — the inline-expand-on-confirm pattern is mandatory.

    Per UI-SPEC §Accessibility:
    - Section landmark with aria-labelledby
    - Native fieldset + legend.sr-only wrapping the radio group
    - "Matched" badge with aria-label
    - role="alert" on the error banner
    - Escape key handler on the section container that collapses to State A
    - Focus management via `tick()` from "svelte" + `.focus()` on state transitions

    The component does NOT make any fetch calls directly — all server communication happens via the SvelteKit form action `?/linkProject` defined in Task 4. The component just submits a form with the two hidden inputs.

    Per `feedback_no_lockfile.md`: no new npm packages.
  </action>
  <verify>
    <automated>cd frontend && npm run lint && cd frontend && npm run check 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/lib/components/project-link/LinkPicker.svelte` exists
    - Contains the locked section heading copy: `grep -c "Linked Projects" frontend/src/lib/components/project-link/LinkPicker.svelte` ≥ 1
    - Contains the locked trigger button copy: `grep -c "Link to existing project" frontend/src/lib/components/project-link/LinkPicker.svelte` ≥ 1
    - Contains the locked destructive button copy: `grep -c "Link projects & delete source" frontend/src/lib/components/project-link/LinkPicker.svelte` ≥ 1
    - Uses Svelte 5 runes: `grep -cE "\\\$state|\\\$props|\\\$derived" frontend/src/lib/components/project-link/LinkPicker.svelte` ≥ 4
    - Has section landmark with aria-labelledby: `grep -c "aria-labelledby" frontend/src/lib/components/project-link/LinkPicker.svelte` ≥ 1
    - Has fieldset + legend.sr-only: `grep -cE "fieldset|sr-only" frontend/src/lib/components/project-link/LinkPicker.svelte` ≥ 1
    - Uses use:enhance for the form submission: `grep -c "use:enhance" frontend/src/lib/components/project-link/LinkPicker.svelte` ≥ 1
    - Does NOT introduce a <dialog> element or floating modal: `grep -cE "<dialog\\b|portal\\b|teleport\\b" frontend/src/lib/components/project-link/LinkPicker.svelte` == 0
    - `cd frontend && npm run lint && cd frontend && npm run check` — passes (Svelte type-check + lint)
  </acceptance_criteria>
  <done>LinkPicker.svelte exists with States A-F per UI-SPEC; uses inline-expand (no floating modal); all locked copy verbatim; accessibility contract honored; frontend lint + check pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Frontend — add linkProject form action + load candidates + mount LinkPicker</name>
  <files>frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts, frontend/src/routes/(app)/projects/[name]/settings/+page.svelte, frontend/src/lib/server/api.ts</files>
  <read_first>
    - frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts (full file — confirm existing addMember action shape; confirm load function returns project data; confirm import { fail, redirect } from "@sveltejs/kit")
    - frontend/src/routes/(app)/projects/[name]/settings/+page.svelte (lines 1-18 — confirm script setup, the existing Members section)
    - frontend/src/lib/server/api.ts (the api client — confirm existing methods like addMember, getBillingStatus; identify the auth-token pattern used by other calls)
    - .planning/phases/02-real-user-identity/02-UI-SPEC.md §State F (locked error-copy table for 403/404/409/5xx/network — must be mapped verbatim in the linkProject action)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 1255-1383 — exact page.svelte mount + page.server.ts action; lines 1361-1382 — error mapping for 403/404/409/5xx)
  </read_first>
  <behavior>
    frontend/src/lib/server/api.ts (EXTEND — add new methods):
    - `async mergeProjects(sourceProjectId: string, targetProjectId: string): Promise<{ ok: true; project_id: string }>` — POSTs to backend `/api/projects/:sourceId/merge-into/:targetId` with the bearer token; throws an error with .status property on non-2xx for the SvelteKit action to map
    - `async listLinkCandidates(projectName: string): Promise<Candidate[]>` (or `listProjects` if it already exists — Claude's discretion) — returns the user's other projects with conversation_count + last_activity + matched_by_remote (the matched_by_remote flag is true when the candidate shares a git_remote_url with the source — backend computes this; if the backend doesn't expose it yet, return false for all candidates and the UI gracefully renders without the "Suggested matches" section — this is fine for Phase 2 MVP)

    frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts (EXTEND):
    - Load function: fetch the user's other projects + match candidates; pass `linkCandidates` and `otherProjects` to the page data
    - Actions: add `linkProject` action that:
      - Reads sourceProjectId, targetProjectId from request.formData()
      - Calls api.mergeProjects(sourceProjectId, targetProjectId)
      - On success: `throw redirect(303, /projects/<target-name>/settings)` (per UI-SPEC §State E)
      - On error: map err.status to one of the 5 locked error copies via fail(status, { linkError: "..." }) — copy table from UI-SPEC §State F is verbatim

    frontend/src/routes/(app)/projects/[name]/settings/+page.svelte (EXTEND):
    - Import LinkPicker from "$lib/components/project-link/LinkPicker.svelte"
    - Add a new <section> AFTER the existing Members section (per UI-SPEC §Surfaces 1 "Section ordering: existing Members → NEW Linked Projects")
    - Mount LinkPicker with props: sourceProjectId, sourceProjectName (from data.project), candidates (from data.linkCandidates), allOtherProjects (from data.otherProjects), linkError (from form?.linkError)
  </behavior>
  <action>
    Three files, coordinated:

    1. EXTEND `frontend/src/lib/server/api.ts`:
       - Add `mergeProjects(sourceId, targetId)` method per the existing fetch patterns in the file (whatever pattern exists for POST endpoints — match the existing addMember style for bearer auth + error throwing)
       - Add `listLinkCandidates(projectName)` (or extend an existing listProjects method) — if the backend doesn't yet expose `matched_by_remote` in the projects-list response, return false for all candidates and the UI will simply NOT render the "Suggested matches" section (the picker still works — just without the auto-match top section). Backend match-candidates surface CAN be added later as a separate task if dogfood demands; do NOT extend the backend here.

    2. EXTEND `frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts` per PATTERNS.md lines 1349-1382:
       - In the load function, fetch user's other projects + link candidates and return them in the page data
       - Add the linkProject action — error mapping by status code per UI-SPEC §State F. Use the exact locked copy strings from the UI-SPEC table.
       - Redirect to /projects/<target-name>/settings on success — the target's name comes from the response or from the existing project list.

    3. EXTEND `frontend/src/routes/(app)/projects/[name]/settings/+page.svelte` per PATTERNS.md lines 1283-1313:
       - Add import for LinkPicker
       - Add the new <section> below the existing Members section (do NOT change the Members section)
       - Pass through linkCandidates, otherProjects, linkError props

    Per UI-SPEC §Out of Scope: do NOT add an "Activity log" or "Merge history" section — that's a separate surface.
  </action>
  <verify>
    <automated>cd frontend && npm run lint && cd frontend && npm run check 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/lib/server/api.ts` contains `mergeProjects`: `grep -c "mergeProjects" frontend/src/lib/server/api.ts` ≥ 1
    - `frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts` contains the `linkProject` action: `grep -c "linkProject" frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts` ≥ 1
    - The linkProject action maps the 5 status codes per UI-SPEC §State F: `grep -cE "403|404|409|500|network" frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts` ≥ 4 (at minimum 403, 404, 409, 5xx)
    - The error copy strings match UI-SPEC §State F verbatim: at least the 403 copy "You're not the owner" appears: `grep -c "You're not the owner" frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts` ≥ 1
    - The settings/+page.svelte imports LinkPicker: `grep -c "LinkPicker" frontend/src/routes/(app)/projects/[name]/settings/+page.svelte` ≥ 2 (import + mount)
    - The existing Members section is UNCHANGED: `grep -c "Members" frontend/src/routes/(app)/projects/[name]/settings/+page.svelte` ≥ 1 (regression guard — the heading "Members" still exists)
    - `cd frontend && npm run lint && cd frontend && npm run check` — passes (Svelte type-check + lint)
  </acceptance_criteria>
  <done>api.ts has mergeProjects + listLinkCandidates; +page.server.ts has linkProject action with status-code → locked-copy mapping; +page.svelte mounts LinkPicker after Members; frontend lint + check pass.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Manual UI verification — link a real project end-to-end on dev or production</name>
  <files>frontend/src/lib/components/project-link/LinkPicker.svelte, frontend/src/routes/(app)/projects/[name]/settings/+page.svelte, backend/src/api/projects.ts</files>
  <read_first>
    - .planning/phases/02-real-user-identity/02-UI-SPEC.md (full file — the design contract this task verifies against)
    - .planning/phases/02-real-user-identity/02-VALIDATION.md (line 74 — multi-device smoke; this manual gate covers the UI half)
  </read_first>
  <what-built>
    - Backend route `POST /api/projects/:id/merge-into/:target_id` is live (deployed by operator on the CF-enabled machine via `wrangler deploy` after the SQL function + Plan 04 schema push)
    - Frontend LinkPicker component mounted on the project settings page at `/projects/<name>/settings`
    - SQL function `merge_projects` is applied (verified in Task 1)
    - 5 locked error copies map to the 5 status codes (403/404/409/5xx/network)
  </what-built>
  <how-to-verify>
    Prerequisite: ensure you have AT LEAST TWO projects in your dogfood Supabase that you OWN. If you only have one, run `synapse init` in a second directory (different git repo) so the backend auto-creates a second project for you.

    Smoke verification (on dev / preview deployment — choose whichever environment matches the latest deployed backend):

    1. Open `https://<frontend-url>/projects/<some-project-name>/settings`. Confirm the page renders with TWO sections: "Members" (existing) and "Linked Projects" (new). Section ordering matches UI-SPEC: Members on top, Linked Projects below.

    2. State A: confirm the trigger button "+ Link to existing project" appears with the locked body copy "Link this project to another one of your projects...". If you only have ONE project visible in the picker (the page you're on), confirm the button is DISABLED with the helper "(You need at least 2 projects to link.)".

    3. Click the trigger. State B: the card expands inline (NOT a floating modal — verify there's no scrim/overlay). Confirm:
       - If "Suggested matches" appears (depends on whether you have a project sharing a git_remote_url with this one), it's at the TOP with the maroon "Matched" badge.
       - "Your other projects" section lists at least one other project as a radio option.
       - Cancel + Continue buttons appear at the bottom; Continue is DISABLED until you pick a radio.

    4. Pick a target project radio. Confirm Continue becomes enabled.

    5. Click Continue. State C: the inner card transforms to the type-to-confirm view. Confirm:
       - The prompt reads "This is irreversible. Type the source project name to confirm." in danger color.
       - The subtext shows `This will move all events from "<source-name>" into "<target-name>" and permanently delete "<source-name>".` with BOTH project names interpolated correctly.
       - The text input placeholder reads `Type "<source-name>" to confirm`.
       - The "Link projects & delete source" button is DISABLED until you type the source project's name exactly.

    6. Type the source project name. Confirm the button enables. Click it. State D: the button shows the spinner + "Linking…".

    7. After 1-3 seconds, you should be redirected to `/projects/<target-name>/settings`. State E. The source project no longer exists in your project list.

    8. Verify in Supabase Dashboard:
       - SQL Editor: `SELECT count(*) FROM handoff_events WHERE project_id = '<source-uuid>';` returns 0
       - SQL Editor: `SELECT count(*) FROM projects WHERE id = '<source-uuid>';` returns 0 (source row deleted)
       - SQL Editor: `SELECT count(*) FROM handoff_events WHERE project_id = '<target-uuid>';` returns ≥ <pre-merge target count> + <pre-merge source count>
       - SQL Editor: `SELECT * FROM activity_log WHERE action = 'project_merged' ORDER BY created_at DESC LIMIT 1;` shows one entry with the source_project_id in metadata

    9. Error-state spot check: in a NEW source project that has a target you do NOT own (if possible to construct via a project_members row with role 'member' not 'owner'), attempt the link — expect the 403 error banner with the locked copy "You're not the owner of one of these projects. Only the owner can link projects."

    Report back: pass/fail per stage, plus any UI rendering issues (font, spacing, color) before the SUMMARY is written. If the design doesn't match UI-SPEC, file gaps but do NOT block on cosmetic polish — the contract is "matches the spec" not "is beautiful."
  </how-to-verify>
  <resume-signal>Type "approved" with confirmation that the smoke walkthrough passes (or "approved with N gaps" listing minor cosmetic issues to file as follow-ups), OR describe a functional failure that blocks the SUMMARY (e.g., "merge succeeded but redirect 404'd" — that's a real bug, not cosmetic).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → frontend SvelteKit form action | Session cookie + CSRF (SvelteKit's default form-action CSRF protection) |
| Frontend page server → backend /api/projects/:id/merge-into/:target_id | Bearer token from session, server-to-server call |
| Backend → merge_projects RPC | RPC enforces owner-check again (defense-in-depth) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01 | Elevation of Privilege | User merges a project they don't own into one they do (or vice versa) — could steal another user's events | mitigate | Owner-check enforced THREE times: (1) frontend page server only lists candidates from the user's own project membership; (2) backend POST endpoint calls requireRole(db, sourceId, user.id, "owner") AND requireRole(db, targetId, user.id, "owner") before the RPC; (3) merge_projects SQL function re-verifies via `perform 1 from project_members where role = 'owner'`. Triple layer per UI-SPEC §Surfaces 1 + security V4. |
| T-02-02 | Tampering | Malformed UUID in URL params causes SQL error / wrong project targeted | mitigate | The backend requireRole call performs a row lookup via project_id — if the param is not a valid UUID, the lookup returns no rows and requireRole throws ForbiddenError (403). The SQL RPC also fails fast on malformed UUIDs (PostgreSQL type-checks). Optional zod parse for early 400 — Claude's discretion. |
| T-02-RACE | Business Logic | User merges A→B then immediately B→A — corrupts state | mitigate | The SQL function is atomic (plpgsql transaction). Race window after A→B is: B contains A's events, A is deleted. A subsequent B→A attempt fails with "not owner of source project" because A no longer exists (the project_members row for A was cascade-deleted when projects A was deleted). Per RESEARCH security V11. |
| T-02-CSRF | Spoofing | Cross-site form submission steals merge action | mitigate | SvelteKit form actions have built-in CSRF protection (same-origin POST check + cookie semantics). No additional defense needed. |
</threat_model>

<verification>
- `cd backend && npx vitest run test/api/projects-merge.test.ts` — Plan-01 RED cases GREEN (401, route-registered, skip live-DB)
- `cd backend && npm run lint && npm run typecheck && npm test` — passes
- `cd frontend && npm run lint && npm run check` — passes (lint + Svelte type-check)
- `npm run test` from repo root — full suite green
- Manual gate (Task 5 above): real-user walkthrough on dev or prod confirms States A-F render correctly, locked copy is verbatim, owner-check 403 fires when the user attempts an unauthorized merge, source project is deleted + target's events count includes the merged set
</verification>

<success_criteria>
- D-07 satisfied: a user can manually link two of their projects via the dashboard
- IDENT-02 SC #2 made reliable: when auto-link gets it wrong, the user has an escape hatch
- merge_projects SQL function exists + is applied to dogfood Supabase
- POST /api/projects/:id/merge-into/:target_id enforces owner-check on BOTH sides + self-link guard
- LinkPicker.svelte implements States A-F per UI-SPEC verbatim
- linkProject form action maps the 5 status codes to the 5 locked error copies
- Members section on the settings page is unchanged (regression guard)
- All Plan-01 RED projects-merge tests flip GREEN
- Manual UI smoke walkthrough passes (Task 5)
</success_criteria>

<output>
Create `.planning/phases/02-real-user-identity/02-05-SUMMARY.md` when done. Summary must:
- Confirm merge_projects SQL function is applied (which file it landed in — 018 or 019)
- Confirm POST /api/projects/:id/merge-into/:target_id route exists with triple-layer owner-check (frontend candidate filter + backend requireRole ×2 + SQL function re-verify)
- Confirm LinkPicker.svelte implements States A-F with locked UI-SPEC copy
- Confirm settings page mounts LinkPicker as sibling section after Members (UI-SPEC §Surfaces 1 ordering)
- Confirm linkProject form action error mapping covers 403/404/409/5xx/network with verbatim UI-SPEC §State F copy
- List which Plan-01 RED cases flipped GREEN (projects-merge structural tests)
- Note Task 5 manual smoke verification result (passed / passed-with-N-gaps / blocked)
- Flag any UI gaps surfaced in manual verification as follow-ups (file to BUGS.md if functional; ignore if cosmetic-only and matches the spec)
- Close Phase 2 as ready for /gsd:verify-work
</output>
