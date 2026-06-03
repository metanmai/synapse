# Synapse proxy Layer 8 E2E -- Windows trust-store install assertions.
#
# Drives `synapsesync capture proxy install/status/uninstall` against
# the REAL CurrentUser Root certificate store via certutil. Mirrors the
# Linux Docker matrix's e2e-proxy-install.sh -- same install/status/
# uninstall sequence, same filesystem-state assertions, distro-aware
# expected paths replaced with the Windows certutil store query.
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

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Get-Item $ScriptRoot).Parent.Parent.FullName
$Cli = "$RepoRoot\mcp\dist\index.js"
$CN = "Synapse Proxy CA"

Write-Host "== e2e-proxy-install (Windows) =="
Write-Host "  repo_root=$RepoRoot"
Write-Host "  cli=$Cli"

# Preflight diagnostics: surface what's on PATH BEFORE the daemon runs.
# The daemon's TlsManager spawns `openssl` via execFileSync — if it's
# missing or broken, knowing that here is more useful than a 15-min
# silent hang later.
Write-Host ""
Write-Host "-- preflight diagnostics --"
$OpensslSrc = (Get-Command openssl -ErrorAction SilentlyContinue).Source
Write-Host "  openssl on PATH: $OpensslSrc"
if (-not $OpensslSrc) {
    Write-Host "FAIL preflight: openssl is NOT on PATH; the daemon will crash when ensureCa() runs"
    exit 1
}
$OpensslVer = & openssl version 2>&1
Write-Host "  openssl version: $OpensslVer"
Write-Host "  node version:    $(& node --version)"
Write-Host "  certutil:        $((Get-Command certutil).Source)"
Write-Host ""

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

# Pre-state: ensure clean slate
& certutil -delstore -user Root $CN > $null 2>&1
Assert-CertNotInStore -Stage "pre-state"

# STAGE 1: install
Write-Host "  [install] node $Cli capture proxy install"
& node $Cli capture proxy install
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL install: 'capture proxy install' exited $LASTEXITCODE"
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
