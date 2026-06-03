---
phase: 02-real-user-identity
plan: 5
status: complete
wave: 4
completed: 2026-05-20
deferred_operator_action: "supabase db push for migration 018 (now extended with merge_projects function) to dogfood Supabase + frontend redeploy"
deferred_human_verify: "Task 5 manual UI smoke — execute on dev/preview deployment after operator action lands"
---

# Plan 02-05 — Manual Link UI (Slice C) — SUMMARY

> Closes IDENT-02 by giving users a manual override when auto-link gets cross-device discovery wrong. New `merge_projects` SQL RPC + `POST /api/projects/:id/merge-into/:target_id` route + `LinkPicker.svelte` mounted as a sibling section on the project Settings page, mirroring `DangerZone.svelte`'s inline-expand pattern.

## What shipped

### DB schema (Task 1)

- **EXTENDED** `supabase/migrations/018_projects_git_remote_url.sql` — appended `create or replace function merge_projects(p_source_id, p_target_id, p_user_id)`. `security definer`, plpgsql, idempotent (re-running 018 is safe; `create or replace function` re-creates without column conflict because the column add is `if not exists`).
  - Owner-check on BOTH source and target via `perform 1 from project_members where role = 'owner'` (defense-in-depth alongside the API-tier `requireRole` check)
  - Reassign FIRST then delete (per RESEARCH §Pitfall 7) — `handoff_events`, `conversations`, `entries`, `activity_log` get `UPDATE project_id = p_target_id`
  - `handoff_project_status` for source is `DELETE`d (not UPDATEd) — target may already have a status row; PK collision would fail the UPDATE. Backend's `recomputeProjectStatus(target)` rebuilds the target's status after the RPC returns.
  - `DELETE FROM projects WHERE id = p_source_id` removes the source row; cascade clears its `project_members`.

> **OPERATOR ACTION DEFERRED.** Like Plan 02-04's migration 018 column add, the new function lands here as a file commit; activation requires `supabase db push` against dogfood Supabase from a CF-enabled machine (per memory `project_split_machine_wrangler.md`, wrangler/`supabase db push` is unusable on this terminal). Tests don't require the push — all live-DB cases stay `.skip`'d per existing convention; structural auth-rejection tests pass without the function existing.

### Backend route (Task 2)

- **EXTENDED** `backend/src/api/projects.ts` — new `POST /:id/merge-into/:target_id` route inserted before `export { projects };`. Mounted under the existing `projects` Hono sub-app, so it inherits `authMiddleware` + `idempotency` automatically.
  - Self-link guard: `sourceId === targetId` → `c.json({ error, code: "SELF_LINK_ERROR" }, 409)` before the owner-checks.
  - Owner-check ×2: `requireRole(db, sourceId, user.id, "owner")` then `requireRole(db, targetId, user.id, "owner")` — both throw `ForbiddenError` (403) when role mismatches.
  - RPC call: `db.rpc("merge_projects", { p_source_id, p_target_id, p_user_id })`. RPC error → log + `c.json({ error, code: "MERGE_ERROR" }, 500)` (matches the `[account/reset]` precedent at `auth.ts:526`).
  - Activity log: `logActivity(db, { project_id: targetId, action: "project_merged", metadata: { source_project_id: sourceId } })` — every destructive action leaves a forensic trail.
  - Recompute: `recomputeProjectStatus(db, targetId)` — added `import { recomputeProjectStatus } from "../lib/handoff-reducer";` (was only imported by `events-batch.ts`).
  - Response: `c.json({ ok: true, project_id: targetId })`.

### Frontend component (Task 3)

- **NEW** `frontend/src/lib/components/project-link/LinkPicker.svelte` (~270 LOC). Svelte 5 runes (`$state`, `$props`, `$derived`). Inline-expand state machine — NO floating modal, NO `<dialog>` primitive (locked by UI-SPEC §Out of Scope).
  - **State A (idle):** outer `.glass` card with section heading "Linked Projects" + body copy + `+ Link to existing project` `.btn-primary` trigger. Disabled with helper `(You need at least 2 projects to link.)` when `hasAnyTargets === false`.
  - **State B (picker open):** expanded card with optional "Suggested matches" section (only when `candidates.length > 0`; uses subtle accent surface with maroon "Matched" badge + `aria-label="Matched: same git remote URL"`) above "Your other projects" radio list. `<fieldset>` + `<legend class="sr-only">Select target project</legend>` wraps the radios. Cancel + Continue buttons (Continue disabled until `selectedTargetId !== ""`).
  - **State C (type-to-confirm):** inner card transforms (same surface) to a `DangerZone.svelte`-style confirm gate. Confirmation prompt + subtext interpolating both project names + text input with placeholder `Type "<source-name>" to confirm` + `aria-describedby` pointing to the subtext. Confirm button `.btn-danger` disabled until `confirmInput === sourceProjectName`.
  - **State D (loading):** confirm button replaces label with `<span class="spinner spinner-sm spinner-white"></span> Linking…`. Both buttons disabled; text input becomes readonly.
  - **State E (success):** server-side `throw redirect(303, /projects/<target>/settings)` — no in-component banner.
  - **State F (error):** `<div role="alert">` renders `linkError` prop above the picker controls. Stays in current state (B or C) for retry.
  - **Accessibility:** section landmark (`<section aria-labelledby="linked-projects-heading">`), `<fieldset>` + `<legend class="sr-only">`, "Matched" `aria-label`, `role="alert"` on error banner, Escape-to-collapse via `<svelte:window onkeydown>` guarded by `showPicker` (avoids non-interactive-section-listener lint warning), focus management via `tick()` + `.focus()` on State A→B (first radio) and B→C (text input).
  - All visible copy is **verbatim from UI-SPEC §Copywriting Contract**. No CSS classes introduced — reuses existing `.btn-primary`, `.btn-danger`, `.btn-secondary`, `.glass`, `.spinner`, `.spinner-sm`, `.spinner-white` and CSS vars from `app.css`.

### Frontend wiring (Task 4)

- **EXTENDED** `frontend/src/lib/server/api.ts` — new `mergeProjects(sourceId, targetId)` posts to `/api/projects/${sourceId}/merge-into/${targetId}` and returns `{ ok: true, project_id }`. New `listLinkCandidates(_name)` returns `[]` until the backend match-candidates surface lands (UI gracefully omits "Suggested matches" when empty — picker still works fully). Reuses the existing `request<T>` helper, so timeout (10s) + auth-header + `ApiError` shape are uniform with every other API client method.
- **EXTENDED** `frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts`:
  - `load`: now uses `await parent()` to read the layout's `project`, calls `api.listProjects()` to derive `otherProjects`, calls `api.listLinkCandidates(params.name)` for candidates, returns `{ tier, linkCandidates, otherProjects }`.
  - `actions.linkProject`: validates both IDs are present, calls `api.mergeProjects`, looks up target's name from the projects list for the redirect URL, then `throw redirect(303, /projects/<target-name>/settings)` on success. Error mapping covers the 5 UI-SPEC §State F status codes (403 / 404 / 409 / 5xx / network), each with verbatim locked copy from the spec.
- **EXTENDED** `frontend/src/routes/(app)/projects/[name]/settings/+page.svelte`: imports `LinkPicker` (alphabetical via biome organize-imports — landed at line 2), adds a new `<section>` below the existing Members section. Mounts LinkPicker with `sourceProjectId`, `sourceProjectName`, `candidates`, `allOtherProjects`, `linkError` props.

## Triple-layer owner-check (T-02-01 mitigation)

| Layer | Where | Enforced by |
|------|-------|-------------|
| 1. Candidate-list filter | `+page.server.ts` `load` | `api.listProjects()` only returns projects the user is a member of (existing query is `user_id` scoped) — picker can only show selectable targets the user has membership in |
| 2. API requireRole ×2 | `backend/src/api/projects.ts:merge-into` | `requireRole(db, sourceId, user.id, "owner")` AND `requireRole(db, targetId, user.id, "owner")` — both throw ForbiddenError (403) on role mismatch |
| 3. SQL function re-verify | `supabase/migrations/018:merge_projects` | `perform 1 from project_members where role = 'owner'` for both sides; `raise exception 'not owner of <side>'` on mismatch |

A future API bug that accidentally bypassed layer 2 would still be rejected by layer 3 inside the atomic transaction.

## RED → GREEN flips

Plan-01 RED tests for `backend/test/api/projects-merge.test.ts`:

- ✅ `POST without auth returns 401` (was passing as Plan-01 structural guard; remains green — route is registered, auth middleware fires)
- ✅ `POST without auth returns 401 even with a JSON body` (was passing; remains green)
- ✅ `POST without auth returns 401 even with UUID-shaped path params` (was passing; remains green)

5 `.skip`'d live-DB cases (`returns 200 + project_id`, `403 not owner of source`, `403 not owner of target`, `409 self-merge`, `writes activity_log`) stay skipped until live-DB CI gating lands — manual smoke walkthrough (Task 5 below) covers them.

> **Note:** The 3 structural tests passed pre-Plan 02-05 because the auth middleware fires before route resolution. Plan 02-05's contract is "route exists + auth gate fires + skip cases stay skip" — all green.

## Quality gates

- **TypeScript:**
  - `cd backend && npm run typecheck` → clean
  - `cd frontend && npm run check` → 0 errors (12 pre-existing warnings; LinkPicker.svelte contributes 0)
- **Biome:** `npm run lint` → 0 errors, 1 pre-existing warning (the `any` in `backend/test/db/queries.test.ts:76` carried from Phase 1).
- **Vitest (4 workspaces):**
  - backend: **380 passed | 20 skipped**
  - packages/shared: 72 passed
  - mcp: 372 passed | 164 skipped
  - frontend: 72 passed
  - **Total: 896 passing, 184 skipped, 0 failing** (mcp + backend unchanged; frontend unchanged — LinkPicker has no unit tests yet, that's Plan 02-06's Playwright coverage).

## Deviations from plan

**Task 5 manual UI smoke walkthrough — deferred.** Plan called for a manual UI smoke against dev/preview deployment to verify States A-F render with locked copy. This requires the operator to (a) apply migration 018 (now with `merge_projects`) to dogfood Supabase via `supabase db push`, and (b) deploy the frontend bundle. Both happen on a CF-enabled machine; deferred to the same window as the migration apply. The unit + structural test layer in this terminal can't cover keyboard navigation, focus management, or visual rendering — those land in Plan 02-06 (Playwright) plus the operator smoke.

**`listLinkCandidates` returns `[]` for now.** Plan permitted this when the backend doesn't yet expose `matched_by_remote`. The UI gracefully omits the "Suggested matches" section in that case; the picker still works fully via the "Your other projects" radio list. If dogfood reveals frequent need for the auto-suggested match badge, wire up the candidates endpoint as a separate follow-up — it's additive and doesn't change the LinkPicker contract.

**Biome auto-fix reordered imports in `+page.svelte`** (LinkPicker now first because the `project-link` path sorts before `sharing`). Cosmetic; doesn't affect behavior.

**`<svelte:window>` for Escape instead of `<section onkeydown>`.** UI-SPEC §Keyboard Contract calls for Escape on the picker container; svelte-check's `a11y_no_noninteractive_element_interactions` rule flags handlers on a `<section>`. Moved to `<svelte:window onkeydown>` with `showPicker` guard — same UX, lint-clean.

## Open follow-ups (do not block phase)

- **Backend match-candidates endpoint.** When `listLinkCandidates` needs to return real matches by shared `git_remote_url`, add a `GET /api/projects/match-candidates?for=<source-id>` route that joins `projects` on shared `git_remote_url` within the user's membership. Until then, `[]` is correct behavior, not a bug.
- **Plan 02-06 — Playwright e2e for LinkPicker** is the regression net for States A-F. The manual smoke is the first-pass; Playwright is the 100th-run guarantee.
- **Deferred operator action:** `supabase db push` to apply the extended migration 018 to dogfood Supabase + `wrangler deploy` for the backend route + frontend redeploy. The function is `create or replace`, so re-applying migration 018 is safe even though the column add was already applied.

## Next steps

- Plan 02-06 (Wave 5) — Playwright browser-driven e2e for LinkPicker (6 states, Chromium-only, mocked backend, CI-gated).
- After both plans ship: `/gsd:verify-work 2` for phase-level verification (real-user UAT against IDENT-01 + IDENT-02 success criteria).
