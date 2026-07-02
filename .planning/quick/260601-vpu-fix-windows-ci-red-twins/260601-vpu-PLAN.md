---
quick_id: 260601-vpu
description: Fix Windows-only CI red — HKLM hang + vitest worker-exit on e2e
date: 2026-06-01
status: in-progress
---

# Quick Task 260601-vpu: Windows CI Red — Twin Fixes

## Problem

`gh run list --repo metanmai/synapse` shows **every recent push red**, including:
- `proxy-windows-e2e` — `synapsesync capture proxy install` hangs >60s on the Windows runner. Last debug marker before timeout: `step1:reg`. The HKLM `CreateSubKey('SOFTWARE\Microsoft\SystemCertificates\Root\ProtectedRoots')` added in `df5c622` to suppress the first-cert-install GUI dialog never returns; the surrounding try/catch never fires.
- `e2e (windows-latest)` — all 121 tests pass but vitest exits 1 due to the same tinypool worker-exit teardown bug already worked around in `mcp/scripts/run-tests.mjs` for `npm test`. The e2e step in `.github/workflows/ci.yml:189` invokes `npx vitest run test/e2e/` directly, bypassing the wrapper.

Both are pre-existing (visible in CI history going back multiple commits) but undiagnosed because the pre-push hook runs lint+typecheck+unit-tests locally — neither failing job runs in that scope.

The brief's "all 11 CI jobs green" architecture insight (5/30/2026) is stale. Will be superseded after this fix lands green.

## Fixes

### 1. `mcp/src/capture/proxy/backends/windows.ts` — bound the HKLM call

Replace the single-line `try { ... CreateSubKey ... } catch { ... }` with PowerShell `Start-Job` + `Wait-Job -Timeout 5`. If the job completes in 5s, harvest the result and continue. If it doesn't, kill the job and emit `step1b:hklm-skip:timeout-5s`, then fall through to the CurrentUser/Root install (which never needs elevation).

Behavior on hang: install completes successfully; user loses the GUI-suppress-dialog feature on first install, which is the same UX as pre-`df5c622`. Acceptable.

### 2. `.github/workflows/ci.yml` line 189 — route e2e through the wrapper

Change `npx vitest run test/e2e/` to `node ./scripts/run-tests.mjs test/e2e/`. The wrapper already handles the worker-exit case: reads vitest's JSON report and exits 0 when there are no test failures, regardless of the underlying process exit code.

## must_haves

- `mcp/test/capture/proxy/backends/windows.test.ts` still passes (assertions check for `CreateSubKey` substring which my fix preserves inside the Start-Job script block)
- Full mcp test suite still passes locally
- Lint + typecheck clean
- Push to origin; subsequent CI run shows both `proxy-windows-e2e` and `e2e (windows-latest)` GREEN

## Out of scope

- Investigating why GitHub Actions windows-latest runner image changed behavior on `CreateSubKey` (probably image update; not actionable from our side)
- Removing the HKLM write entirely (we keep it for non-CI users where it works and provides real UX value)
- Adding an admin-elevation pre-check (the Start-Job timeout is sufficient and simpler)

## Verification cadence

Push → watch `gh run watch <id> --repo metanmai/synapse` → confirm both jobs green → save Synapse insight + supersede the stale "11 jobs green" architecture entry.
