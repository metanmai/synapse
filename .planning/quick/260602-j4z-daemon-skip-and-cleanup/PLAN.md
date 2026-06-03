---
quick_id: 260602-j4z
description: Daemon-side skip for ephemeral cwds + insight consolidation + spam-project cleanup script
date: 2026-06-02
status: in-progress
---

# Quick Task 260602-j4z — Daemon Skip + Insight Audit + Project Cleanup

## Problem

Two visible symptoms reported by the user today:

1. **Dashboard pollution** — 11 of ~50 projects on the user's dashboard are spam (test patterns: `synapse-proxy-l5-OEZODO`, `multi-device-1779992672254`, `cursor-wrap-poc`, etc.). Root cause: the local capture daemon (invoked via `synapsesync hook ...`) dispatches events from **every** cwd it sees. Agent worktrees created by Claude Code's `isolation: "worktree"` mode (`~/.claude/worktrees/agent-<random>/`) trigger event emission, and the backend's `findOrCreateProjectByGit` auto-creates a project. There is no existing skip mechanism — `mcp/src/cli/hook-dispatch.ts` `readHookPayloadFromStdin` is unconditional.

2. **Insight bloat** — 52 active insights on the synapse project (CLAUDE.md brevity rule says "consolidate aggressively"). Per-save supersession is honored on individual writes, but old session-specific insights now reflected in code/docs are still active, bloating every SessionStart brief.

## Fix shape

### Part 1 — Daemon-side skip predicate (the prevention)

Add `shouldSkipDispatch(cwd, env, opts?)` to `mcp/src/cli/hook-dispatch.ts` that returns `{ skip: true, reason }` when ANY of:

| Condition | Why | Match pattern |
|---|---|---|
| `cwd` under `~/.claude/worktrees/` | Claude Code's agent-isolation namespace. **Never** a real project. | `path.relative(homeWorktrees, cwd)` doesn't start with `..` |
| `cwd` under `$TMPDIR` / `/tmp/` / `/private/tmp/` | Scratch dirs from tests, spikes, throwaway experiments. macOS aliases `/tmp` → `/private/tmp`. | Each prefix checked separately with `path.relative` guard. |
| `.synapse-skip` marker file in cwd or any ancestor up to home | User-controlled per-dir opt-out. Doesn't require remembering env vars. | Walk parents from cwd up to (and including) home; stop at home or filesystem root. |
| `SYNAPSE_SKIP_DISPATCH=1` env var | Scripted opt-out for E2E test runners and CI. | `env.SYNAPSE_SKIP_DISPATCH === "1"` |

**Wiring**: `readHookPayloadFromStdin` becomes `Promise<AnyHookPayload | null>`. After computing `canonicalCwd(parsed.cwd ?? process.cwd())`, call `shouldSkipDispatch(cwd, process.env)`. If skip, optionally emit `SYNAPSE_DEBUG=1` stderr line and return `null`. Caller (`commands.ts:runHook`) does `if (!payload) return;` before dispatching.

**Why this placement and not earlier**:
- We need `cwd` from the stdin payload to evaluate the predicate. Parsing JSON is cheap and side-effect-free.
- We short-circuit BEFORE `hashCwd` / `getGitBasename` / `getGitRemoteUrl` to avoid wasted shell-outs.
- We short-circuit BEFORE any handler call → no event emission → no backend auto-create.

**Pure-helper extractability**: `shouldSkipDispatch` takes `cwd: string` and `env: NodeJS.ProcessEnv` plus optional `opts` (override `homeDir`, `tmpDir`, `markerFile`, `fileExists`) so it's unit-testable without touching the real filesystem or environment.

### Part 2 — Insight audit (the cleanup of accumulated state)

`mcp__synapse__list_insights({ project: "synapse" })` → 52 active entries. Group:

| Category | Action | Why |
|---|---|---|
| Migration N applied | Supersede with one consolidating "Migrations 018, 019, 025, 026 applied to prod 2026-05-XX" insight, then retire that too (it's recorded in supabase/migrations/) | Migration history lives in the migration files, not insights |
| "X deferred — see BUGS.md" | Supersede en masse with one "P-tier work items deferred to v1.X tracked in docs/BUGS.md" insight | BUGS.md is the canonical deferred list |
| Per-CI-run state ("CI green as of <sha>") | Supersede with one "CI gate: full pre-push verify + post-push metanmai matrix" architecture insight | Specific SHAs go stale instantly |
| "scripts/X.mjs exists" architecture notes | Retire — file existing is its own documentation | Architecture insights are for non-obvious behavior, not file inventories |
| One-off learnings already in CONVENTIONS or BUGS | Retire | Codebase docs are the durable record |

**Target**: 52 → ~20-25 active. Keep load-bearing insights (the proxy stack architecture, multi-device-keys status, in-flight bug TODOs, user preferences) and the brevity rules embedded as preferences.

### Part 3 — Bulk delete script (the visible cleanup, user-driven)

`scripts/cleanup-spam-projects.mjs` (Node, no deps beyond built-in `fetch` + `readline`):

1. Read `SYNAPSE_API_KEY` from env (or `~/.synapse/config.json` if user pattern matches).
2. `GET /api/projects` with bearer auth → list of projects.
3. Filter to candidates matching:
   - `/-[A-Za-z0-9]{6}$/` (6-char random suffix — e.g. `synapse-proxy-l5-OEZODO`, `multi-device-1779992672254`)
   - `/^multi-device-/`
   - `/^cwd_[a-f0-9]{12}$/` (un-rewritten daemon placeholder)
   - `/^unknown$/`
4. Print candidate names in a table.
5. Prompt "Delete these N projects? Type 'yes' to confirm:" via readline.
6. On `yes`, send `DELETE /api/projects/:id?force=true` per project, log each result.
7. On anything else, print "Cancelled. No projects deleted." and exit 0.

**Why not auto-run**: user reviews the list to catch false positives (e.g. a real project that happens to match a pattern). Manual approval is the safety net.

## must_haves

- New `shouldSkipDispatch` exported from `hook-dispatch.ts`, pure (no top-level side effects, optional opts param for DI).
- `readHookPayloadFromStdin` returns `AnyHookPayload | null`.
- `runHook` in `commands.ts` short-circuits cleanly (exits 0, no error) on `null`.
- New test file `mcp/test/cli/hook-dispatch-skip.test.ts` with positive + negative cases per branch:
  - worktrees: `~/.claude/worktrees/agent-abc` matches; `~/.claude/projects/foo` does NOT; `~/.claude/worktrees-backup/foo` does NOT (boundary check).
  - tmpdir: `$TMPDIR/anything` matches; sibling-of-tmpdir does NOT.
  - marker: `.synapse-skip` in cwd matches; in grandparent matches; in dir outside home boundary does NOT walk past home.
  - env: `SYNAPSE_SKIP_DISPATCH=1` matches; `SYNAPSE_SKIP_DISPATCH=0` does NOT; unset does NOT.
  - real project cwd (`/Users/Tanmai.N/Documents/synapse`) does NOT skip.
- `npm run lint` + `npm run typecheck` + `node mcp/scripts/run-tests.mjs` all green.
- `scripts/cleanup-spam-projects.mjs` exists and is executable; doesn't auto-run on import.
- Active insight count drops from 52 to ~20-25.
- Atomic commit per part, pushed to tanmain.

## Out of scope

- Retroactive cleanup of existing spam projects in code (deferred to user running cleanup script).
- Changing the backend's `findOrCreateProjectByGit` flow (the skip happens daemon-side; backend is unchanged).
- Migration to remove existing spam from DB tables (DB is fine; just hide them from dashboard or delete via API).
- Adding rate-limit or quota on auto-project-create (out of scope — skip is sufficient).
- Updating frontend dashboard to filter test patterns (defense-in-depth, but not the source-of-truth fix).

## Verification cadence

After Part 1 commit:
- `gh run watch <id> --repo metanmai/synapse` → confirm verify + e2e + proxy matrix still green.
- Manually trigger a hook from a worktree dir → confirm no event emitted (check daemon logs OR backend project list before/after).

After Part 2 audit:
- `mcp__synapse__list_insights({ project: "synapse", limit: 100 })` → confirm count is ~20-25.

After Part 3:
- User runs script manually; confirms candidate list before approving; dashboard shows clean state.
