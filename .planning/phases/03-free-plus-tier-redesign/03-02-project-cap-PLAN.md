---
phase: 03-free-plus-tier-redesign
plan: 2
type: execute
wave: 1
depends_on: [03-01]
files_modified:
  - backend/src/lib/tier.ts
  - backend/src/api/projects.ts
  - backend/src/db/queries/projects.ts
  - mcp/src/capture/handoff-sync.ts
  - mcp/src/capture/pull-sync-errors.ts
  - frontend/src/routes/(app)/projects/+page.svelte
  - mcp/test/capture/handoff-sync.test.ts
  - backend/test/api/projects.test.ts
  - scripts/e2e-project-cap.mjs
autonomous: true
requirements: [TIER-02]

must_haves:
  truths:
    - "Both Free and Plus users hard-capped at 50 owned projects"
    - "51st create attempt returns structured 402 with code: PROJECT_QUOTA_EXCEEDED"
    - "Shared projects (role !== 'owner') do NOT count toward the 50 cap"
    - "CLI surface (synapsesync sync, daemon's findOrCreateProjectByGit) renders the quota error clearly"
    - "Browser surface (new project UI) renders the quota error inline"
    - "SessionStart brief includes ## Sync error section when a recent quota error is cached locally"
    - "E2E test asserts the bug class: N+K creates produce exactly N successes and K identical structured errors with the right code"
  artifacts:
    - path: "backend/src/api/projects.ts"
      provides: "POST /api/projects returns 402 PROJECT_QUOTA_EXCEEDED at cap"
      contains: "PROJECT_QUOTA_EXCEEDED"
    - path: "mcp/src/capture/pull-sync-errors.ts"
      provides: "Brief markdown renderer for cached sync errors (## Sync error section)"
      contains: "PROJECT_QUOTA_EXCEEDED"
    - path: "scripts/e2e-project-cap.mjs"
      provides: "E2E bug-class assertion — 51st create rejected with structured error"
      contains: "PROJECT_QUOTA_EXCEEDED"
  key_links:
    - from: "backend/src/api/projects.ts"
      to: "backend/src/lib/tier.ts:enforceProjectQuotaForTier"
      via: "import { enforceProjectQuotaForTier }"
      pattern: "enforceProjectQuotaForTier"
    - from: "mcp/src/capture/handoff-sync.ts"
      to: "backend/src/api/projects.ts response 402"
      via: "fetch response status + JSON body code field"
      pattern: "PROJECT_QUOTA_EXCEEDED"
---

<objective>
Enforce a hard 50-project cap on BOTH tiers. Surface the cap error in three places: backend response body (structured 402), CLI sync flows (daemon + `synapsesync sync`), and browser. Add a SessionStart brief `## Sync error` section that renders cached quota errors so the AI in the next session sees them.

Per CONTEXT.md: no grandfather, no banner — business confirmed no current user has >50 projects. Plus 50-cap is effectively a *change* (was unlimited) but a quiet one because no user is over it.

Shared projects (role !== 'owner') do NOT count. Only owned projects.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/phases/03-free-plus-tier-redesign/03-CONTEXT.md
@.planning/phases/03-free-plus-tier-redesign/03-PATTERNS.md
@backend/src/api/projects.ts
@backend/src/api/conversations.ts
@backend/src/db/queries/projects.ts
@backend/src/lib/tier.ts
@backend/src/lib/errors.ts
@mcp/src/capture/handoff-sync.ts
@mcp/src/capture/pull-insights.ts
</context>

<tasks>

<task id="03-02-1" type="execute">
<title>Update enforceProjectQuotaForTier to return structured error code</title>
<read_first>
  - backend/src/lib/tier.ts (existing enforceProjectQuotaForTier at lines 91-100)
  - backend/src/lib/errors.ts (AppError shape — confirm 3rd arg is the code field)
</read_first>
<action>
Edit `enforceProjectQuotaForTier` in `backend/src/lib/tier.ts`. Change the error throw:

FROM:
```typescript
throw new AppError(
  `Project limit reached (${max}). ${tier === "free" ? "Upgrade to Plus for up to 50 projects." : "Maximum 50 projects on Plus."}`,
  403,
  "TIER_LIMIT",
);
```

TO:
```typescript
throw new AppError(
  `Project limit reached (${max}). Delete an existing project to add this one.`,
  402,
  "PROJECT_QUOTA_EXCEEDED",
);
```

Status 402 distinguishes capacity-cap from auth/permission (403). Message text drops the upgrade pitch (no longer relevant — both tiers at 50).
</action>
<acceptance_criteria>
  - `grep -c "PROJECT_QUOTA_EXCEEDED" backend/src/lib/tier.ts` returns 1
  - `grep -c "TIER_LIMIT" backend/src/lib/tier.ts` returns 1 (only enforceMemberLimitForTier still uses it)
  - `grep "402" backend/src/lib/tier.ts | grep -c "Project limit"` returns 1
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-02-2" type="execute">
<title>Verify countOwnedProjects filters to role=owner only</title>
<read_first>
  - backend/src/db/queries/projects.ts (find countOwnedProjects function)
</read_first>
<action>
Read `countOwnedProjects` in `backend/src/db/queries/projects.ts`. Confirm it only counts rows where the user is the owner (e.g., filters on `projects.owner_id = userId` or joins through a memberships table with `role = 'owner'`).

If it correctly filters to owner: NO-OP, mark task complete.

If it counts membership too (e.g., includes shared projects): fix the query so it only counts owner-role rows. Add a code comment explaining the filter is load-bearing for the 50-project cap (shared projects must not count per CONTEXT.md).
</action>
<acceptance_criteria>
  - `countOwnedProjects` function present in backend/src/db/queries/projects.ts
  - Function either (a) filters on a column proving owner role, OR (b) joins memberships with role='owner' filter
  - If a fix was needed: the fix is committed with a comment explaining "shared projects do NOT count toward the 50-cap"
  - `npm run test --workspace=backend -- projects` exits 0
</acceptance_criteria>
</task>

<task id="03-02-3" type="execute">
<title>Ensure POST /api/projects surfaces the structured error</title>
<read_first>
  - backend/src/api/projects.ts (POST handler — find the call to enforceProjectQuota or equivalent)
  - backend/src/lib/errors.ts (AppError serialization path — confirm code field reaches response JSON)
</read_first>
<action>
In `backend/src/api/projects.ts` POST handler:

1. Confirm `enforceProjectQuota(ownedCount, c)` is called BEFORE the create (move it if necessary).
2. Confirm the route's error handler (likely an `onError` in `backend/src/index.ts`) serializes AppError's code field into the response JSON. If it currently serializes only the message and status, EXTEND it so `{error, code}` is the response body shape for ALL AppErrors with a code.

If the error handler already serializes code: NO-OP on the handler.

The response shape at cap MUST be:
```json
{
  "error": "Project limit reached (50). Delete an existing project to add this one.",
  "code": "PROJECT_QUOTA_EXCEEDED"
}
```
Status 402.
</action>
<acceptance_criteria>
  - `grep -c "enforceProjectQuota" backend/src/api/projects.ts` returns ≥ 1
  - Manual smoke: hit `POST /api/projects` for a user with 50 owned projects → response status 402 + body has `{"code":"PROJECT_QUOTA_EXCEEDED",...}`
  - `npm run test --workspace=backend -- projects` exits 0
</acceptance_criteria>
</task>

<task id="03-02-4" type="execute">
<title>CLI: surface the structured error in handoff-sync.ts findOrCreateProjectByGit path</title>
<read_first>
  - mcp/src/capture/handoff-sync.ts (find where /api/events/batch or /api/projects fetches happen + error handling)
  - mcp/src/capture/handoff-paths.js (synapseRoot, project paths — for caching the error)
</read_first>
<action>
In `mcp/src/capture/handoff-sync.ts`, locate the error-handling code for `POST /api/events/batch` (or whichever path triggers `findOrCreateProjectByGit`).

When the response status is 402 and the body has `code: "PROJECT_QUOTA_EXCEEDED"`:
1. Log a clear warning to console.error: `"[sync] Could not auto-create project: 50/50 project limit reached. Delete one in dashboard to continue."`
2. Cache the error to `~/.synapse/sync-errors.json` (append, with timestamp + projectPath/git_remote + code) so the brief can render it on next SessionStart. File shape:
```json
{
  "errors": [
    {"code": "PROJECT_QUOTA_EXCEEDED", "git_remote_url": "...", "at": "2026-05-29T..."}
  ]
}
```
3. Continue the cycle for other projects (best-effort — don't abort the whole sync).

Cap the cached errors at 10 entries — old entries pruned (FIFO).
</action>
<acceptance_criteria>
  - `grep -c "PROJECT_QUOTA_EXCEEDED" mcp/src/capture/handoff-sync.ts` returns ≥ 1
  - `grep -c "sync-errors.json" mcp/src/capture/handoff-sync.ts` returns ≥ 1
  - Cache write path is wrapped in try/catch so a filesystem error doesn't kill the daemon
  - `npm run typecheck --workspace=mcp` exits 0
</acceptance_criteria>
</task>

<task id="03-02-5" type="execute">
<title>Brief: new pull-sync-errors.ts renderer</title>
<read_first>
  - mcp/src/capture/pull-insights.ts (pattern to mirror — sync, returns Promise<string>, "" on no data)
  - mcp/src/capture/handoff-paths.js (synapseRoot helper)
</read_first>
<action>
Create new file `mcp/src/capture/pull-sync-errors.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { synapseRoot } from "./handoff-paths.js";

interface CachedError {
  code: string;
  git_remote_url?: string;
  at: string;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — old errors get pruned

export function pullSyncErrorsSection(): string {
  const file = path.join(synapseRoot(), "sync-errors.json");
  if (!fs.existsSync(file)) return "";

  let data: { errors?: CachedError[] };
  try {
    data = JSON.parse(fs.readFileSync(file, "utf-8")) as { errors?: CachedError[] };
  } catch {
    return "";
  }

  const now = Date.now();
  const recent = (data.errors ?? []).filter((e) => now - new Date(e.at).getTime() < MAX_AGE_MS);
  if (recent.length === 0) return "";

  const lines: string[] = ["## Sync error"];
  for (const e of recent) {
    if (e.code === "PROJECT_QUOTA_EXCEEDED") {
      const repo = e.git_remote_url ? ` for ${e.git_remote_url}` : "";
      lines.push(`- Could not auto-create project${repo}: you have 50/50 projects. Delete one in the dashboard to continue.`);
    } else {
      lines.push(`- Sync error (${e.code}) at ${e.at}`);
    }
  }
  return lines.join("\n");
}
```

Wire this into the brief assembly path (find where `pullInsightsSection` is called from — same call site appends the new section). Order: handoff → recent insights → sync errors. Sync errors section last so it's most prominent.
</action>
<acceptance_criteria>
  - File `mcp/src/capture/pull-sync-errors.ts` exists with the `pullSyncErrorsSection` export
  - The brief-assembly caller (search for `pullInsightsSection` callers) also calls `pullSyncErrorsSection` and appends its non-empty output
  - Returns `""` when no errors file exists (graceful no-op)
  - Returns `""` when all cached errors are >24h old
  - `npm run typecheck --workspace=mcp` exits 0
</acceptance_criteria>
</task>

<task id="03-02-6" type="execute">
<title>Frontend: render quota error on new-project action</title>
<read_first>
  - frontend/src/routes/(app)/projects/+page.svelte (current new-project UI — find error rendering)
  - frontend/src/lib/api.ts or wherever client fetches happen
</read_first>
<action>
Locate the new-project form / action handler in the frontend. When the API returns 402 with `code: PROJECT_QUOTA_EXCEEDED`, render the error inline near the form input:

> "You have 50/50 projects. Delete one to add this project."

Use existing error-display patterns (toast component, inline error styled to match the codebase). Don't add new visual primitives.

If the project create flow currently catches ALL errors as a generic "failed to create", branch on the response.code field so this specific case shows the actionable message.
</action>
<acceptance_criteria>
  - `grep -rn "PROJECT_QUOTA_EXCEEDED" frontend/src/` returns ≥ 1 match in routes/projects
  - Manually verify in dev: filling a fake 51st-project create scenario shows the explicit "50/50" message
  - `npm run typecheck --workspace=frontend` exits 0
</acceptance_criteria>
</task>

<task id="03-02-7" type="execute">
<title>E2E test asserting the bug class</title>
<read_first>
  - scripts/e2e-smoke.mjs (existing E2E pattern — live system, structured assertions)
  - .planning/codebase/TESTING.md
</read_first>
<action>
Create `scripts/e2e-project-cap.mjs` (new file). The test:

1. Use a test user account with an existing API key (env: `SYNAPSE_E2E_API_KEY`).
2. PRECONDITION: count current owned projects. If > 0, log warning — test creates 50+ projects, runs against live backend.
3. PHASE 1 (cleanup): delete any test projects from prior runs (matching name prefix `e2e-cap-test-`).
4. PHASE 2 (saturate): create 50 projects named `e2e-cap-test-${i}`. All should return 201.
5. PHASE 3 (assert cap): create the 51st. Assert response status === 402 AND response.code === "PROJECT_QUOTA_EXCEEDED".
6. PHASE 4 (idempotency): retry the 51st → still 402 same code (the cap is a hard fail, not a one-shot).
7. PHASE 5 (delete one + retry): delete one of the 50 → POST 51st → returns 201 (cap freed).
8. PHASE 6 (cleanup): delete all 50 test projects.

Exit code: 0 on full pass, 1 if any phase fails. Print per-phase OK/FAIL lines.

This guards the BUG CLASS — the cap fires, surfaces the right code, is idempotent at the boundary, and frees on delete. NOT a specific string assertion.
</action>
<acceptance_criteria>
  - File `scripts/e2e-project-cap.mjs` exists
  - Running `node scripts/e2e-project-cap.mjs` with valid `SYNAPSE_E2E_API_KEY` exits 0
  - Test output shows all 6 phases passed
  - Self-cleaning: post-test, no `e2e-cap-test-*` projects remain on the account
</acceptance_criteria>
</task>

</tasks>

<verification>
After all tasks:
1. `npm run lint && npm run typecheck && npm run test` all exit 0
2. `node scripts/e2e-project-cap.mjs` passes
3. Manual smoke in browser: try to create a 51st project (mock via API or set up a test account at 50) — UI shows actionable error
4. Manual smoke in CLI: induce a daemon attempt to auto-create a 51st project (e.g., open a fresh repo while at cap) → daemon log shows the warning, `~/.synapse/sync-errors.json` has the entry, next SessionStart brief includes `## Sync error` section
</verification>
