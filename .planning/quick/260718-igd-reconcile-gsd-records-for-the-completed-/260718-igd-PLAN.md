---
quick_id: 260718-igd
slug: reconcile-gsd-records-for-completed-supabase-hardening
phase: quick
plan: 260718-igd
status: planned
date: 2026-07-18
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/STATE.md
  - .planning/ROADMAP.md
  - docs/BUGS.md
  - .planning/quick/260610-rls-enable-on-remaining-tables/SUMMARY.md
autonomous: true
must_haves:
  truths:
    - "GSD no longer says the Supabase CI secrets or production RLS apply are pending."
    - "The production security close-out records distinguish verified production facts from repository artifacts: RLS and grants hardened, six analytics views made security-invoker, seven privileged functions restricted, migration 031 applied, and the Supabase advisor returned zero errors."
    - "The records state that GitHub prod has SUPABASE_DB_PASSWORD configured and CI run 29599228105 attempt 2 passed, without exposing any secret value or claiming that this pre-secret run proved the new password was consumed."
    - "The original 260610 RLS task retains its historical scope while its production-apply and post-apply verification follow-ups are explicitly closed by the broader 2026-07-17 hardening migration."
    - "Only planning and documentation files change; application code, migrations, and runtime configuration remain untouched."
  artifacts:
    - path: ".planning/STATE.md"
      provides: "Current operational status, completed hardening activity, and corrected next actions/risks"
    - path: ".planning/ROADMAP.md"
      provides: "Post-launch follow-up list with the obsolete Supabase-secret item marked complete"
    - path: "docs/BUGS.md"
      provides: "Closed P1 auto-migrate setup record with preserved near-miss context and evidence"
    - path: ".planning/quick/260610-rls-enable-on-remaining-tables/SUMMARY.md"
      provides: "Historical RLS task amended with production close-out and remaining recurrence guard"
  key_links:
    - from: "supabase/migrations/20260717170215_harden_public_schema_rls.sql"
      to: ".planning/STATE.md and docs/BUGS.md"
      via: "commit 454af70e and the recorded production advisor verification"
      pattern: "454af70e|20260717170215_harden_public_schema_rls"
    - from: "supabase/migrations/031_api_key_scope.sql"
      to: ".planning/STATE.md"
      via: "production-apply status already established by the completed extension rollout"
      pattern: "031_api_key_scope|migration 031"
    - from: ".planning/quick/260610-rls-enable-on-remaining-tables/SUMMARY.md"
      to: "supabase/migrations/20260717170215_harden_public_schema_rls.sql"
      via: "a dated close-out note that supersedes the open production-apply follow-ups"
      pattern: "027_rls_remaining_tables|2026-07-17"
    - from: "GitHub Actions run 29599228105 attempt 2"
      to: ".planning/STATE.md and docs/BUGS.md"
      via: "conclusion=success evidence, kept separate from the later secret-presence confirmation"
      pattern: "29599228105|SUPABASE_DB_PASSWORD"
---

# Quick Task 260718-igd: Reconcile GSD records for completed Supabase hardening

<objective>
Bring the GSD planning records into agreement with the already-completed production Supabase security work, CI result, and GitHub secret setup.

Purpose: Remove stale operational guidance that still tells future sessions to apply production RLS or configure the database-password secret, while preserving the history and remaining non-blocking follow-ups accurately.

Output: Updated STATE, ROADMAP, BUGS, and the original 260610 RLS SUMMARY; no application or database changes.
</objective>

<execution_context>
@/home/metanmai/.codex/gsd-core/workflows/execute-plan.md
@/home/metanmai/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@docs/BUGS.md
@.planning/quick/260610-rls-enable-on-remaining-tables/PLAN.md
@.planning/quick/260610-rls-enable-on-remaining-tables/SUMMARY.md
@supabase/migrations/031_api_key_scope.sql
@supabase/migrations/20260717170215_harden_public_schema_rls.sql

Historical evidence to preserve precisely:
- Production project `uciwmtnoobivszfyojys` was audited before the fix: `project_context` and `deleted_accounts` had RLS disabled despite migration 027 being recorded remotely, and six analytics views were security-definer/exposed to browser roles.
- The 2026-07-17 migration was applied directly to production and commit `454af70e` records the reproducible SQL. Post-apply checks showed RLS enabled, anon/authenticated access revoked, Metabase read-only access preserved, service-role access preserved, privileged functions hardened, and zero Supabase advisor errors.
- Migration 031 was applied directly and its `api_keys.scope` column/default/check constraint were verified in production.
- GitHub Actions run `29599228105`, attempt 2, concluded successfully. `SUPABASE_DB_PASSWORD` was configured in the GitHub `prod` environment afterward; record these as separate facts and do not imply the earlier run consumed the newly added secret.
- Remaining non-critical Supabase warnings are leaked-password protection (dashboard setting) and `pgvector` in `public` (requires a coordinated migration). The recurrence-level CI lint proposed by the 260610 task also remains deferred.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Reconcile canonical project state and the closed CI-secret process gap</name>
  <files>.planning/STATE.md, .planning/ROADMAP.md, docs/BUGS.md</files>
  <action>
Update the three canonical planning surfaces without rewriting unrelated historical material.

In `.planning/STATE.md`, advance the frontmatter and visible last-updated date to 2026-07-18; add a concise recent-activity/status entry covering production RLS/grant/view/function hardening, migration 031, zero advisor errors, commit `454af70e`, successful CI run `29599228105` attempt 2, and the configured GitHub `prod` `SUPABASE_DB_PASSWORD`. Replace every current-focus, tactical-pending, next-action, and active-risk statement that still says the Supabase secrets are missing or manual database pushes are required. Keep the password value absent. Preserve the two remaining advisor warnings as non-critical follow-ups and keep the recurrence-level migration/RLS lint explicitly deferred rather than claiming it exists.

In `.planning/ROADMAP.md`, amend only the post-launch P1 Supabase-secrets follow-up so it is visibly complete as of 2026-07-18; leave deferred product phases and unrelated roadmap content unchanged.

In `docs/BUGS.md`, move the full `Configure Supabase secrets so CI auto-migrate activates` item from `P1 — Process gaps` to `Closed`, preserving its 2026-06-21 production near-miss narrative because that history explains the three-secret guard. Replace stale setup instructions and obsolete “pending migration today” text with a dated close note: all three required secret names are configured, the password value was not inspected, and run `29599228105` attempt 2 was green. Keep the evidence precise: the run passed, while the database-password secret was added afterward, so a future push/rerun is the proof that auto-migrate consumes it. Do not claim the successful run itself exercised the newly added password.
  </action>
  <verify>
    <automated>rg -n "29599228105|454af70e|SUPABASE_DB_PASSWORD|zero (Supabase )?advisor errors|20260717170215_harden_public_schema_rls|migration 031" .planning/STATE.md .planning/ROADMAP.md docs/BUGS.md &amp;&amp; ! rg -n "Remaining tactical items: SUPABASE|P1 — Configure SUPABASE|Highest — configure SUPABASE|Today it's inert|Status: scaffolded but gated" .planning/STATE.md .planning/ROADMAP.md docs/BUGS.md</automated>
  </verify>
  <done>All three canonical records agree that the production security work and secret setup are complete, retain the near-miss history, state the CI timing accurately, expose no secret value, and leave only genuine non-critical follow-ups pending.</done>
</task>

<task type="auto">
  <name>Task 2: Close the original 260610 RLS production follow-ups and prove documentation-only scope</name>
  <files>.planning/quick/260610-rls-enable-on-remaining-tables/SUMMARY.md</files>
  <action>
Append a dated production close-out section to the existing 260610 SUMMARY rather than rewriting its historical discovery or code-delivery result. Mark its open follow-ups 1 (apply migration 027) and 3 (verify production behavior) as closed/superseded by the direct 2026-07-17 production hardening and `20260717170215_harden_public_schema_rls.sql`. Record that the broader fix also hardened the six analytics views and seven privileged functions, preserved Metabase/service-role access, and reduced Supabase advisor errors to zero. Note migration 031 and the configured GitHub prod password as adjacent operational close-out facts. Leave follow-up 2—the recurrence-level CI guard for future tables without RLS—clearly deferred, and retain the two non-critical Supabase warnings.

After the documentation edits, verify the evidence without reading secret values: inspect commit `454af70e`; query GitHub run `29599228105` attempt 2 for `conclusion=success`; list GitHub `prod` environment secret names and confirm `SUPABASE_DB_PASSWORD` is present. Then inspect the complete porcelain status with individual untracked files included, not only `git diff`: fail if any tracked or untracked path falls outside `.planning/STATE.md`, `.planning/ROADMAP.md`, `docs/BUGS.md`, this amended SUMMARY, and the quick task's own PLAN/SUMMARY artifacts. Explicitly tolerate the known pre-existing `.planning/graphs/`, `graphify-out/`, and `supabase/.temp/` trees without cleaning or changing them. Do not modify migrations, application code, GitHub workflow configuration, Cloudflare configuration, Supabase production, or local graph artifacts.
  </action>
  <verify>
    <automated>git show --quiet --format='%H %s' 454af70e | rg '^454af70e.*fix\(db\): harden public schema access$' &amp;&amp; test "$(gh run view 29599228105 --repo metanmai/synapse --attempt 2 --json conclusion --jq .conclusion)" = success &amp;&amp; gh api repos/metanmai/synapse/environments/prod/secrets --jq '.secrets[].name' | rg -x 'SUPABASE_DB_PASSWORD' &amp;&amp; rg -n "Production close-out|2026-07-17|zero.*advisor|recurrence.*deferred" .planning/quick/260610-rls-enable-on-remaining-tables/SUMMARY.md &amp;&amp; git diff --check &amp;&amp; test -z "$(git status --porcelain=v1 --untracked-files=all | cut -c4- | rg -v '^(\.planning/STATE\.md|\.planning/ROADMAP\.md|docs/BUGS\.md|\.planning/quick/260610-rls-enable-on-remaining-tables/SUMMARY\.md|\.planning/quick/260718-igd-reconcile-gsd-records-for-the-completed-/260718-igd-(PLAN|SUMMARY)\.md|\.planning/graphs/|graphify-out/|supabase/\.temp/)')"</automated>
  </verify>
  <done>The 260610 history explicitly closes the production apply/verification gap, leaves the recurrence guard deferred, all external evidence checks pass without exposing credentials, and the diff contains documentation/planning artifacts only.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Production/GitHub evidence → planning records | External operational facts are summarized into durable repository documentation. |
| Secret metadata → repository text | Secret names and presence may be recorded; secret values must never enter files, commands, or output. |
| Historical task → current state | The 260610 code-delivery history must remain intact while its later production follow-ups are closed. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-260718-01 | Repudiation | CI/security completion claims | medium | mitigate | Cite the exact commit, migration, project, and GitHub run/attempt; separate the run date from the later secret setup. |
| T-260718-02 | Information Disclosure | GitHub environment secret | high | mitigate | Query and record secret names only; never fetch, print, or store values. |
| T-260718-03 | Tampering | Application/database scope | medium | mitigate | Enforce a diff allowlist limited to the four requested records and this quick task's artifacts. |
| T-260718-04 | Elevation of Privilege | Documentation-only execution | low | accept | No production or runtime mutation is authorized or necessary; verification is read-only. |
</threat_model>

<verification>
1. Frontmatter and plan structure validate through `gsd-tools.cjs`.
2. Exact evidence checks pass for commit `454af70e`, CI attempt 2 success, and the presence (not value) of `SUPABASE_DB_PASSWORD` in GitHub `prod`.
3. Stale pending-language searches return no matches in current-state sections.
4. Updated records all retain the remaining warnings and deferred recurrence guard.
5. The final porcelain status, including individual untracked files, contains only the documentation/planning allowlist plus the known pre-existing `.planning/graphs/`, `graphify-out/`, and `supabase/.temp/` artifacts.
</verification>

<success_criteria>
- Future GSD resumes no longer instruct the user to configure an already-present secret or apply an already-applied production hardening.
- STATE, ROADMAP, BUGS, and the 260610 SUMMARY tell the same evidence-backed story with accurate chronology.
- Migration 031 and the full 2026-07-17 hardening scope are recorded without changing SQL or application code.
- No credential value is exposed and no unrelated file changes.
</success_criteria>

<output>
Create `.planning/quick/260718-igd-reconcile-gsd-records-for-the-completed-/260718-igd-SUMMARY.md` when done.
</output>
