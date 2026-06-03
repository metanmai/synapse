# Synapse proxy Layer 8 E2E -- Windows trust-store install assertions.
#
# Drives `synapsesync capture proxy install/status/uninstall` against
# the REAL CurrentUser Root certificate store via certutil queries.
# Mirrors the Linux Docker matrix's e2e-proxy-install.sh -- same
# install/status/uninstall sequence, same filesystem-state assertions,
# distro-aware expected paths replaced with the Windows certutil store
# query.
#
# Run on:
#   - GitHub Actions windows-latest runner (CI matrix)
#   - Real Windows dev machine (local validation)
# NOT run on:
#   - macOS / Linux hosts (the orchestrator soft-skips there)
#
# Cleans up any pre-existing "Synapse Proxy CA" cert before starting
# so reruns are idempotent. Leaves the CurrentUser Root store in the
# same state it found it (uninstall stage removes anything install added).
#
# ASCII-only by design: Windows PowerShell 5.1 (`shell: powershell`)
# misreads UTF-8 box-drawing chars and em-dashes as mojibake and chokes
# on the resulting "syntax errors." The CI workflow now invokes pwsh
# (PowerShell 7, UTF-8 native) but keeping this script ASCII means it
# also works under legacy Windows PowerShell, in Git Bash, or in any
# code page the user happens to be on.
#
# SYNAPSE_PROXY_DEBUG=1 is set when invoking the daemon so any future
# regression in tls.ts / onboarding.ts / windows.ts surfaces timing
# markers in the CI log instead of a silent hang.

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Get-Item $ScriptRoot).Parent.Parent.FullName
$Cli = "$RepoRoot\mcp\dist\index.js"
$CN = "Synapse Proxy CA"

Write-Host "== e2e-proxy-install (Windows) =="
Write-Host "  repo_root=$RepoRoot"
Write-Host "  cli=$Cli"

function Assert-CertInStore {
    param([string]$Stage)
    $output = & certutil -store -user Root $CN 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAIL ${Stage}: cert '$CN' NOT in CurrentUser Root store"
        Write-Host $output
        exit 1
    }
}

function Assert-CertNotInStore {
    param([string]$Stage)
    & certutil -store -user Root $CN > $null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "FAIL ${Stage}: cert '$CN' UNEXPECTEDLY present in CurrentUser Root store"
        exit 1
    }
}

# Pre-state: ensure clean slate. Use PowerShell X509Store remove
# (mirrors the daemon's uninstall path) since `certutil -delstore`
# can hit the same Root-store GUI dialog that hangs CI runners.
$preCleanScript = @"
`$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','CurrentUser')
`$store.Open('ReadWrite')
`$found = `$store.Certificates | Where-Object { `$_.Subject -like '*CN=$CN*' }
if (`$found) { `$store.Remove(`$found) }
`$store.Close()
"@
powershell.exe -NoProfile -NonInteractive -Command $preCleanScript > $null 2>&1
Assert-CertNotInStore -Stage "pre-state"

# STAGE 1: install (SYNAPSE_PROXY_DEBUG=1 enables daemon-side timing
# markers so any future regression surfaces in the CI log instead of
# hanging silently for 30+ seconds).
$env:SYNAPSE_PROXY_DEBUG = "1"
Write-Host "  [install] node $Cli capture proxy install"
$installJob = Start-Job -ScriptBlock {
    param($CliPath)
    $env:SYNAPSE_PROXY_DEBUG = "1"
    & node $CliPath capture proxy install 2>&1
    return $LASTEXITCODE
} -ArgumentList $Cli

# 60s outer timeout: the daemon's internal cert-store spawn timeout
# is 30s, so any real bug should surface well within this.
$completed = Wait-Job $installJob -Timeout 60
if (-not $completed) {
    Write-Host "FAIL install: 'capture proxy install' hung > 60s -- killing job and dumping any captured output"
    $partialOut = Receive-Job $installJob
    $partialOut | ForEach-Object { Write-Host "    $_" }
    Stop-Job $installJob | Out-Null
    Remove-Job $installJob -Force
    exit 1
}
$installOutput = Receive-Job $installJob
$installExit = $installJob.ChildJobs[0].Output[-1]
Remove-Job $installJob
Write-Host "  [install] stdout/stderr from daemon:"
$installOutput | ForEach-Object { Write-Host "    $_" }
if ($installExit -ne 0) {
    Write-Host "FAIL install: 'capture proxy install' exited $installExit"
    exit 1
}
Assert-CertInStore -Stage "post-install"
Write-Host "  [install] PASS -- cert in CurrentUser Root"

# STAGE 2: status (smoke check -- non-zero exit is the regression)
Write-Host "  [status] node $Cli capture proxy status"
& node $Cli capture proxy status
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL status: 'capture proxy status' exited $LASTEXITCODE"
    exit 1
}
Write-Host "  [status] PASS"

# STAGE 3: uninstall
Write-Host "  [uninstall] node $Cli capture proxy uninstall"
& node $Cli capture proxy uninstall
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL uninstall: 'capture proxy uninstall' exited $LASTEXITCODE"
    exit 1
}
Assert-CertNotInStore -Stage "post-uninstall"
Write-Host "  [uninstall] PASS -- cert removed"

Write-Host "PASS windows"
