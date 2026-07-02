---
quick_id: 260602-j4z
description: Daemon-side skip for ephemeral cwds + insight consolidation + spam-project cleanup script
date: 2026-06-02
status: complete
---

# Summary — 260602-j4z

## What shipped

Three discrete deliverables across two atomic commits + one server-side audit:

### Part 1 — `feat(hook): skip dispatch from ephemeral cwds` (commit `68e6ceb`)

Added `shouldSkipDispatch(cwd, env, opts?)` to `mcp/src/cli/hook-dispatch.ts`. Short-circuits the hook dispatch path BEFORE git shell-outs or event emission when:

| Condition | Skip reason | Production default |
|---|---|---|
| `cwd` under `~/.claude/worktrees/` | Claude Code agent-isolation namespace | always on |
| `cwd` under tmp prefixes | scratch dirs | `[tmpDir, /tmp, /private/tmp, /private/var/folders, /var/folders]` (configurable via opts) |
| `.synapse-skip` marker file in cwd or any ancestor up to home | user-controlled per-dir opt-out | always on, walk stops at home |
| `SYNAPSE_SKIP_DISPATCH=1` env var | scripted opt-out for E2E / CI | always on |

**Wiring**: `readHookPayloadFromStdin` returns `Promise<AnyHookPayload | null>`. `commands.ts:runHook` short-circuits cleanly (exits 0) on `null`. `SYNAPSE_DEBUG=1` emits a stderr line so users can audit skip decisions without inspecting the daemon's source.

**Tests**: `mcp/test/cli/hook-dispatch-skip.test.ts` — 23 unit tests covering every branch positively + negatively. Key boundary checks:
- `~/.claude/worktrees-backup` does NOT match `~/.claude/worktrees/`
- `/tmpfoo` does NOT match `/tmp/`
- marker walk stops at home (marker outside home is ignored)
- env-var wins over path checks (short-circuit verified)

**Pure**: predicate takes `cwd: string`, `env: NodeJS.ProcessEnv`, optional `opts: SkipDispatchOpts` (override `homeDir`, `tmpDir`, `tmpPrefixes`, `markerFile`, `fileExists`). No top-level side effects. The `tmpPrefixes` override is what lets the test sandbox itself — which lives at `/private/var/folders/...` — opt out of branch (b) when exercising the other branches.

**Bug class guarded**: backend `findOrCreateProjectByGit` auto-creates a project per throwaway cwd. With ~30 agent worktree spawns per active session, the user's dashboard accumulated 11+ test-pattern projects across days (synapse-proxy-l5-OEZODO, multi-device-1779992672254, cursor-wrap-poc, …). The skip predicate makes that impossible going forward.

### Part 2 — Synapse insight audit (server-side, no commit)

Reduced active insights from **52 → 20**. Four consolidating insights saved with `supersedes` covering 36 retired entries:

1. `[architecture]` "Proxy daemon shipped: 9 layers cross-platform via TLS-MITM forward proxy" — replaces 11 per-layer milestone notes
2. `[learning]` "Windows trust-store install: PowerShell Import-Certificate over certutil; openssl needs piped stdio" — replaces 3 Windows-install gotchas
3. `[decision]` "v1.0 shipped 2026-05-29; v1.X follow-ups tracked in STATE.md + BUGS.md" — replaces 14 per-commit state snapshots + deferred-X decisions
4. `[preference]` "Insights are for gotchas + decisions, not 'X is done' status notes" — replaces 8 file-existence inventory entries

The remaining 20 active insights are all load-bearing: 5 non-obvious learnings (timestamp races, vitest 4 pool config, detached spawn pitfalls, …), 4 architecture invariants (SYNAPSE_HOME device boundary, pure-helper pattern, @synapse/shared Node 24 dep, CI graceful-skip), 3 active action items (orphan owner_id, desktop-apps smoke, Layer 8 non-MDM Mac E2E), the 4 consolidations from today, and 4 device-specific findings (TLS probe results, npm-dep gap, etc.).

### Part 3 — `tooling: add scripts/cleanup-spam-projects.mjs` (commit `bb82112`)

Interactive pattern-match cleanup script. Complements (does not replace) the existing `cleanup-dev-projects.mjs`:

- `cleanup-dev-projects.mjs` = **allow-list** (keep KEEP_NAMES, force-delete everything else). Aggressive. Maintainer's dev account.
- `cleanup-spam-projects.mjs` (new) = **pattern-match** (find candidates matching `SPAM_PATTERNS`, print them + "kept" list, require typed "yes" confirmation, DELETE force=true per project). Safer. Any account with daemon-from-ephemeral-cwd pollution.

Patterns: `/-[A-Za-z0-9]{6}$/` (agent worktree suffix), `/^multi-device-/`, `/^cwd_[a-f0-9]{12}$/` (un-rewritten placeholder), `/^unknown$/`. Auth via `~/.synapse/config.json` `api_key` or `SYNAPSE_API_KEY` env var. Never auto-runs.

### Action item (new, post-Part-1 push)

`[action_item]` "CaptureWatcher dedup tests flake under load — investigate scan interval / timing". The pre-push hook gated my Part 3 push because `test/unit/capture/watcher.test.ts` "deduplicates unchanged files (mtime+size)" hung past 30s timeout (vitest doesn't preempt). Same test passed in 6s on retry. Saved as action_item for future investigation — pre-existing flake, not introduced by this work.

## Verification

- ✓ `npm run lint` clean (1 pre-existing warning in `onboarding-openssl-prereq.test.ts:112` — not introduced)
- ✓ `npm run typecheck` clean
- ✓ `node mcp/scripts/run-tests.mjs` — 725 passed, 163 skipped (e2e gated on TEST_SUPABASE_* secrets), 0 failed
- ✓ Part 1 pre-push hook passed first try
- ✓ Part 3 pre-push hook passed on retry after flaky watcher test settled
- ✓ Active Synapse insight count: 52 → 20 (confirmed via `list_insights`)
- ⏳ CI on metanmai — will be confirmed after bot mirrors `bb82112`

## Why this matters

User's direct quote: "shouldn't the test patterns not exist, ever? Why do I keep seeing spam in my dashboard?" The honest answer was **yes, they shouldn't**, and the daemon was missing the predicate that would make that true. This commit closes the gap at the source: future agent worktree spawns won't create projects. The cleanup script handles the historical pollution under explicit user approval.

## Out of scope

- Retroactive cleanup of EXISTING spam projects in the user's dashboard — Part 3 script ships the tool; user runs it manually after reviewing the candidate list.
- Backend `findOrCreateProjectByGit` flow changes — the skip happens daemon-side, backend is unchanged.
- Frontend dashboard filtering of test-pattern names — defense-in-depth, deferred. The daemon skip is the source-of-truth fix.
- Watcher test flake investigation — saved as action_item for later.
- STATE.md "Quick Tasks Completed" table — no such section exists in this repo's STATE.md (precedent: prior quick tasks like 260601-vpu also did not update STATE.md).
