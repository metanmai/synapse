---
phase: 2
slug: real-user-identity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-20
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Substantive content is sourced from `02-RESEARCH.md` § Validation Architecture (lines 835-924) — this file is the executable contract; the research file is the rationale.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x (mcp/package.json:39, backend/package.json:23, frontend/package.json) |
| **Config file** | `mcp/vitest.config.ts`, `backend/vitest.config.ts`, `frontend/vitest.config.ts` |
| **Quick run (per-workspace)** | `cd mcp && npm test` (~8s) · `cd backend && npm test` (~12s) — pick the workspace that changed |
| **Full suite command** | `npm test` from repo root — runs all 4 workspaces |
| **E2E command** | `cd mcp && npm run test:e2e` (sets `TEST_E2E=1`) |
| **Estimated runtime** | ~25s full (pre-push hook gate; per CLAUDE.md) |

---

## Sampling Rate

- **After every task commit:** `cd mcp && npm test` OR `cd backend && npm test` — whichever workspace owns the change
- **After every plan wave:** `npm test` from repo root (lint + typecheck + test across all workspaces)
- **Before `/gsd:verify-work`:** Full suite + e2e (`mcp/test/e2e/handoff.e2e.test.ts` extended with multi-device scenario) must be green
- **Phase gate (Success Criterion #3):** `node mcp/scripts/test-cli-flow.mjs` passes against production
- **Max feedback latency:** ~25s

---

## Per-Task Verification Map

> **Populated by the planner** when PLAN.md files are written. Each task gets a row mapping the requirement (IDENT-01 or IDENT-02), the test type, and the automated command. See `02-RESEARCH.md` § Phase Requirements → Test Map for the canonical list of behaviors to map.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _TBD by planner_ | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files that must exist (NEW) or be extended (EXISTING) **before** implementation begins. Source: `02-RESEARCH.md` § Wave 0 Gaps.

- [ ] `backend/test/api/auth-me.test.ts` — **NEW** (~80 LOC). `/me` endpoint contract: 200 with `{user_id, email, tier}`, 401 on bad/missing auth, `user_id` matches `public.users.id` (not `auth.users.id`).
- [ ] `mcp/test/cli/init.test.ts` — **EXTEND** (~6 cases). Fail-fast on `/me` rejection (D-05); successful `/me` writes `user_id` + `email` to `~/.synapse/config.json`; idempotent re-run.
- [ ] `mcp/test/cli/hook-dispatch.test.ts` — **EXTEND** (~4 cases). Env-var precedence (`SYNAPSE_USER_ID` wins), config fallback, no-config fallback to placeholder, hashCwd determinism (regression guard).
- [ ] `mcp/test/capture/handoff-sync.test.ts` — **EXTEND** (~5 cases). `runEagerPullCycle` writes `_pulled: true`, advances watermark, no-op on empty pull, clean error on 401/5xx, subsequent flush filters `_pulled` events.
- [ ] `backend/test/api/events-batch-auto-create.test.ts` — **EXTEND** (~3 cases). Request body accepts `payload.git_remote_url`; cwd_<hash> with `git_remote_url` still resolves; `git_basename`-only path still works (regression).
- [ ] `mcp/test/capture/handoff-brief.test.ts` — **EXTEND** (~3 cases). D-09: "Your last activity" when device_id matches; hostname-suffix when device_id differs but user_id matches; existing other-user line untouched.
- [ ] `mcp/test/e2e/handoff.e2e.test.ts` — **EXTEND** (~1 describe block). Machine-A captures + flushes; "machine-B" (fresh tmpdir, same user_id, different device_id) inits + eager-pulls + SessionStart's brief contains machine-A focus + hostname.
- [ ] `backend/test/api/projects-merge.test.ts` — **NEW** (~60 LOC). **DEFERRED behind `/gsd:ui-phase 2`** — owner-role enforcement on both source + target, RPC result, activity-log entry.

**Framework install:** None. vitest already present in all 4 workspaces.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration 018 adds `projects.git_remote_url` column + index without error on existing prod | D-06 schema | Supabase migration push is a one-shot human-gated operation; no CI test exercises live DDL on prod | Run `supabase db push` from a CF-enabled machine. Verify: column exists in `projects`, index `idx_projects_git_remote_url` exists, existing rows have NULL backfilled. |
| `mcp/scripts/test-cli-flow.mjs` against production | Success Criterion #3 | The e2e roundtrip touches the real Supabase + real auth path; cannot run inside vitest stub harness | Run `node mcp/scripts/test-cli-flow.mjs` with a Plus-tier API key in `~/.synapse/config.json`. Expect: event captured locally, flushed to backend, visible in `handoff_events` with `actor_user_id = <real-uuid>`. |
| Multi-device user experience smoke | IDENT-02 | The "second machine" is a hardware-distinct laptop in practice; not modeled in test infra beyond fresh-tmpdir | On machine A: `synapse init` + a Claude Code session that emits events. On machine B (fresh OS user or fresh `~/.synapse`): `synapse init` + open Claude Code in the same git repo. Assert: brief contains machine-A focus + hostname-of-machine-A. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (8 files above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
