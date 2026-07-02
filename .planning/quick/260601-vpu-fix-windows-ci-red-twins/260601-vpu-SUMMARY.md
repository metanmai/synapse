---
quick_id: 260601-vpu
description: Fix Windows-only CI red — HKLM hang + vitest worker-exit on e2e
date: 2026-06-01
status: complete
---

# Summary — 260601-vpu

## What shipped

Atomic commit `6d22dda` with two unrelated Windows-only CI fixes:

### 1. `mcp/src/capture/proxy/backends/windows.ts`

The PowerShell install script's HKLM `CreateSubKey` call (added in `df5c622` to suppress the "Do you want to install this CA?" GUI dialog on fresh CurrentUser/Root installs) was hanging indefinitely on the GitHub Actions windows-latest runner — the surrounding try/catch never fired because the call blocked before throwing. Suspected: UAC virtualization deadlock specific to the runner image's pwsh environment. The two-line `try { CreateSubKey; ... } catch { ... }` was replaced with `Start-Job` + `Wait-Job -Timeout 5` so the registry write is bounded:

```powershell
Write-Host 'step1:reg'
$regJob = Start-Job -ScriptBlock { try { ...CreateSubKey... ; 'ok' } catch { "skip:$($_.Exception.Message)" } }
$regDone = Wait-Job $regJob -Timeout 5
if ($regDone) { Write-Host "step1a:hklm-$(Receive-Job $regJob)" } else { Stop-Job $regJob; Write-Host 'step1b:hklm-skip:timeout-5s' }
Remove-Job $regJob -Force
```

When the job completes in 5s: harvest result and continue. When it hangs: kill the job, emit `step1b:hklm-skip:timeout-5s`, fall through to the CurrentUser store install (which never needs elevation). Trade-off on timeout: lose the GUI-suppress-dialog feature on fresh installs — matches pre-`df5c622` UX which was acceptable.

The 15 unit tests in `mcp/test/capture/proxy/backends/windows.test.ts` still pass (assertion is `expect(installScript).toContain("CreateSubKey")` — preserved inside the Start-Job script block).

### 2. `.github/workflows/ci.yml` line 189

Changed `npx vitest run test/e2e/` to `node ./scripts/run-tests.mjs test/e2e/`. The wrapper (which already exists for `npm test`) reads vitest's JSON report and exits 0 when zero tests/suites failed, regardless of process exit code. Required because vitest 4 + tinypool exhibits a worker-teardown race on Windows that exits with code 1 even when all tests pass.

## Why this matters

Every recent push since 2026-05-30 has been red on metanmai/synapse. The pre-push verify gate (lint + typecheck + unit tests) is silent on these because:
- `proxy-windows-e2e` only runs on the Windows runner image
- `e2e (windows-latest)` requires `TEST_SUPABASE_*` secrets that don't exist locally

The brief's "all 11 CI jobs green" architecture insight was stale and is superseded by this commit's outcome.

## Verification status

**VERIFIED GREEN** — CI run `26770649541` on metanmai/synapse completed with all 11 jobs `success`:

```
success  verify (ubuntu-latest)
success  verify (windows-latest)
success  e2e (ubuntu-latest)
success  e2e (windows-latest)        ← was failing pre-fix
success  proxy-windows-e2e           ← was failing pre-fix
success  proxy-linux-e2e (ubuntu)
success  proxy-linux-e2e (debian)
success  proxy-linux-e2e (fedora)
success  proxy-linux-e2e (arch)
success  proxy-linux-e2e (rockylinux)
success  migrate                     (gracefully skips — SUPABASE_* secrets deferred)
```

First fully-green CI run since 2026-05-30. The brief's stale "11 CI jobs green" architecture insight is being superseded with a current-state replacement.

## Out of scope

- Removing the HKLM write entirely (preserves real UX value for non-CI users where it works)
- Adding admin-elevation pre-check (Start-Job timeout is sufficient and simpler)
- Investigating WHY the runner image changed (not actionable from our side; pragmatic fix is to bound the call)
- Updating the pre-push hook to flag red metanmai runs (worthwhile follow-on but out of scope here)
