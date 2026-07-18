---
phase: 1
slug: stabilize-backend-observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-19
scope: slice-1a-wrangler-free
---

# Phase 1 — Validation Strategy (slice 1a)

> Per-phase validation contract for feedback sampling during execution.
> **Scope:** slice 1a (wrangler-free) only. Slice 1b validation strategy will be drafted on the CF-enabled machine.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x (mcp: 4.1.2; backend: 4.1.0 — verified `backend/package.json:30`, `mcp/package.json:41`) |
| **Config file (mcp)** | `mcp/vitest.config.ts` |
| **Config file (backend)** | `backend/vitest.config.ts` (uses `@cloudflare/vitest-pool-workers`) |
| **Quick run (mcp)** | `cd mcp && npx vitest run test/cli/init.test.ts test/cli/status.test.ts test/cli/mcp-command.test.ts test/capture/handoff-sync.test.ts test/capture/daemon-backoff.test.ts` |
| **Quick run (backend)** | `cd backend && npx vitest run test/lib/observability.test.ts test/lib/observability-wiring.test.ts` |
| **Full suite** | `npm run test` from repo root (every workspace; ~25-30s including pre-push lint+typecheck) |
| **Estimated runtime (quick)** | ~5 seconds per workspace |

---

## Sampling Rate

- **After every task commit:** Run quick command for the touched workspace
- **After every plan wave:** Run `npm run test` from repo root
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds (quick) / 30 seconds (full)

The pre-push hook already enforces full-suite green on every push (per `feedback_always_test`).

---

## Per-Task Verification Map

> Task IDs will be assigned by the planner. Each row below maps a requirement → behavior → test command. The planner MUST attach `<acceptance_criteria>` referencing these tests to each task.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| BUG-02 | `DaemonManager.isRunning()` returns `true` when launchd reports label loaded (mock execSync) | unit | `cd mcp && npx vitest run test/cli/status.test.ts` | ✅ extend | ⬜ pending |
| BUG-02 | `DaemonManager.isRunning()` returns `false` when `launchctl print` throws (service not loaded) | unit | same | ✅ extend | ⬜ pending |
| BUG-02 | `DaemonManager.isRunning()` falls back to PID-file check on non-supervisor platforms | unit | same | ✅ extend | ⬜ pending |
| BUG-02 | `capture status` distinguishes "supervised by launchd/systemd" from "alive via PID" in output | unit | same | ✅ extend | ⬜ pending |
| BUG-03 | `resolveSynapseMcpCommand` returns absolute bin path when `which synapsesync` succeeds (mock execSync) | unit | `cd mcp && npx vitest run test/cli/mcp-command.test.ts` | ❌ W0 | ⬜ pending |
| BUG-03 | `resolveSynapseMcpCommand` returns `node <abs>/dist/index.js` shape when `which` fails but dist exists | unit | same | ❌ W0 | ⬜ pending |
| BUG-03 | `resolveSynapseMcpCommand` returns `npx synapsesync` last-resort when neither resolves | unit | same | ❌ W0 | ⬜ pending |
| BUG-03 | `probeNpmRegistry` returns `false` on 2s timeout (mock fetch) | unit | same | ❌ W0 | ⬜ pending |
| BUG-04 | `runInit` writes a new `.mcp.json` in cwd with the synapse server entry | integration | `cd mcp && npx vitest run test/cli/init.test.ts` | ✅ extend | ⬜ pending |
| BUG-04 | `runInit` merges into an existing `.mcp.json` preserving other server entries | integration | same | ✅ extend | ⬜ pending |
| BUG-04 | `runInit` backs up and rewrites for an invalid existing `.mcp.json` (existing `writeMcpJson` corrupt path) | integration | same | ✅ extend | ⬜ pending |
| BUG-04 | `runInit` calls `ensureGitignore(cwd, ".mcp.json")` whenever cwd `.mcp.json` is written | integration | same | ✅ extend | ⬜ pending |
| OBS-01 | `scrubPayload` removes `event.extra[k].payload` from synapse-shaped event objects | unit | `cd backend && npx vitest run test/lib/observability.test.ts` | ✅ | ✅ green |
| OBS-01 | `scrubPayload` preserves stack traces and request metadata | unit | same | ✅ | ✅ green |
| OBS-01 | `scrubPayload` returns the same event when no synapse-shaped data is attached | unit | same | ✅ | ✅ green |
| OBS-01 | `scrubPayload` removes `event.request.data` and `event.breadcrumbs[*].data.payload` (Hono body capture path) | unit | same | ✅ | ✅ green |
| OBS-01 (wiring) | `backend/src/index.ts` calls `app.use(sentry(...))` BEFORE CORS and any other middleware | unit (module-level assertion) | `cd backend && npx vitest run test/lib/observability-wiring.test.ts` | ✅ | ✅ green |
| BUGS.md #12 | Backoff starts at base delay (10s) | unit (fake timers) | `cd mcp && npx vitest run test/capture/daemon-backoff.test.ts` | ❌ W0 | ⬜ pending |
| BUGS.md #12 | Backoff doubles on each failure (10→20→40→80→160→300) | unit | same | ❌ W0 | ⬜ pending |
| BUGS.md #12 | Backoff caps at MAX_DELAY (300s) | unit | same | ❌ W0 | ⬜ pending |
| BUGS.md #12 | Backoff resets to base on first success | unit | same | ❌ W0 | ⬜ pending |
| BUGS.md #12 | Jitter is within ±25% of the current delay (assert range) | unit | same | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files that MUST exist before any production code change lands (stubs + first failing test):

- [ ] `mcp/test/cli/mcp-command.test.ts` — BUG-03 resolver branches + proxy probe (new file)
- [x] `backend/test/lib/observability.test.ts` — OBS-01 `scrubPayload` filtering (new file)
- [x] `backend/test/lib/observability-wiring.test.ts` — OBS-01 middleware-order assertion (new file)
- [ ] `mcp/test/capture/daemon-backoff.test.ts` — BUGS.md #12 backoff schedule (new file, uses `vi.useFakeTimers`)
- [ ] Extend `mcp/test/cli/init.test.ts` — BUG-04 (new + merge + corrupt + gitignore paths)
- [ ] Extend `mcp/test/cli/status.test.ts` — BUG-02 (launchd / systemd / pid-file branches with mocked `execSync`)
- [ ] Framework install: **none** — vitest is already wired in both workspaces

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real launchd-supervised daemon shows "Daemon: running" via `synapse capture status` | BUG-02 SC#2 | Requires actual launchd state on a real macOS machine | After landing the fix on the dev machine, run `synapse capture status`; expect output containing "Daemon: running" and "supervised by launchd". |
| Fresh `synapse init` on a Netskope-restricted network produces a working `.mcp.json` | BUG-03 SC#3 | Requires the actual proxy network | **Deferred to slice 1b verification.** Re-tested on a Netskope-restricted machine after deploy. |
| Deliberate throw at `events-batch.ts` produces a Sentry event within 1 min | OBS-01 SC#4 | Requires deployed Worker + Sentry project | **Deferred to slice 1b.** Slice 1a verifies via `observability-wiring.test.ts` that the middleware is wired correctly. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s per task
- [ ] `nyquist_compliant: true` set in frontmatter after planner integrates this map

**Approval:** pending

---

## Notes for the Planner

- The Per-Task Verification Map rows are keyed by REQ-ID, not task ID. When you write tasks, attach each task's `<acceptance_criteria>` to the matching row(s). One task may close multiple rows; one row may need multiple tasks (e.g., BUG-04 has a write task + a gitignore task).
- Wave 0 tasks should ALL create test files with at least one failing test (RED step). No production code lands before Wave 0 is complete.
- The pre-push hook runs `lint && typecheck && test` — design wave commits so the hook fires once per merge, not per task. Atomic commits per task are fine but stack them and push at wave boundaries.
- Slice 1b validation strategy will be added to this file when work resumes on the CF-enabled machine. Do not close this VALIDATION.md until both slices ship.
