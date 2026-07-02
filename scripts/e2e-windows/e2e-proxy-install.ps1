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

# Exercise the EXACT openssl commands the daemon uses, in PowerShell,
# with timing. If these hang here, the daemon hang has the same root
# cause. If these are fast, the hang is in node-spawn-of-openssl with
# stdio:"ignore" (a different bug class entirely).
$TmpKey = "$env:TEMP\preflight-test.key"
$TmpCrt = "$env:TEMP\preflight-test.crt"
Remove-Item -ErrorAction SilentlyContinue $TmpKey, $TmpCrt

Write-Host ""
Write-Host "-- openssl smoke tests --"

$t1 = Get-Date
& openssl genrsa -out $TmpKey 4096 *>$null
$e1 = ((Get-Date) - $t1).TotalSeconds
Write-Host ("  [smoke] genrsa 4096: exit={0} elapsed={1:F2}s" -f $LASTEXITCODE, $e1)
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL preflight: openssl genrsa 4096 failed"
    exit 1
}

$t2 = Get-Date
& openssl req -new -x509 -days 3650 -key $TmpKey -out $TmpCrt -subj "/CN=PreflightCA/O=Test" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" *>$null
$e2 = ((Get-Date) - $t2).TotalSeconds
Write-Host ("  [smoke] req -new -x509 -addext: exit={0} elapsed={1:F2}s" -f $LASTEXITCODE, $e2)
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL preflight: openssl req -new -x509 with -addext failed"
    exit 1
}

Remove-Item -ErrorAction SilentlyContinue $TmpKey, $TmpCrt
Write-Host ""

# Pinpoint test: call Node's execFileSync with the EXACT pattern the
# daemon uses, in isolation. If this hangs, the bug is reproducible at
# the Node-spawn-openssl level. If it's fast, the daemon's hang is in
# code BEFORE/AFTER the openssl call (not in the spawn itself).
Write-Host "-- Node-direct openssl test (mirrors tls.ts execFileSync) --"
$NodeTestKey = "$env:TEMP\node-direct-test.key"
Remove-Item -ErrorAction SilentlyContinue $NodeTestKey

$nodeTestScript = @"
import { execFileSync } from 'node:child_process';
console.log('before-exec');
const t0 = Date.now();
try {
    execFileSync('openssl', ['genrsa', '-out', '$($NodeTestKey -replace '\\','/')', '4096'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: 30000,
    });
    console.log('after-exec elapsed_ms=' + (Date.now() - t0));
} catch (e) {
    console.log('exec-error elapsed_ms=' + (Date.now() - t0) + ' message=' + e.message);
    process.exit(2);
}
"@
$nodeTestFile = "$env:TEMP\node-direct-test.mjs"
$nodeTestScript | Out-File -FilePath $nodeTestFile -Encoding utf8 -NoNewline

$t3 = Get-Date
$nodeJob = Start-Job -ScriptBlock {
    param($scriptPath)
    & node $scriptPath 2>&1
    $LASTEXITCODE
} -ArgumentList $nodeTestFile
$nodeCompleted = Wait-Job $nodeJob -Timeout 45
if (-not $nodeCompleted) {
    Write-Host "  [node-direct] HUNG > 45s — confirms the bug is in Node's execFileSync of openssl on Windows"
    Stop-Job $nodeJob -PassThru | Receive-Job
    Remove-Job $nodeJob -Force
    Remove-Item -ErrorAction SilentlyContinue $NodeTestKey, $nodeTestFile
    exit 1
}
$nodeOut = Receive-Job $nodeJob
$e3 = ((Get-Date) - $t3).TotalSeconds
Write-Host "  [node-direct] output: $nodeOut"
Write-Host ("  [node-direct] elapsed: {0:F2}s" -f $e3)
Remove-Item -ErrorAction SilentlyContinue $NodeTestKey, $nodeTestFile
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
# Wrap in Start-Job + Wait-Job so a hang doesn't burn the full 15-min
# CI timeout. Anything > 90s is a real bug worth diagnosing fast.
Write-Host "  [install] node $Cli capture proxy install  (90s timeout)"
$installJob = Start-Job -ScriptBlock {
    param($CliPath)
    & node $CliPath capture proxy install 2>&1
    return $LASTEXITCODE
} -ArgumentList $Cli

$completed = Wait-Job $installJob -Timeout 90
if (-not $completed) {
    Write-Host "FAIL install: 'capture proxy install' hung > 90s — killing"
    Stop-Job $installJob -PassThru | Receive-Job
    Remove-Job $installJob -Force
    exit 1
}
$installOutput = Receive-Job $installJob
$installExit = $installJob.ChildJobs[0].Output[-1]
Remove-Job $installJob
Write-Host "  [install] stdout/stderr from job:"
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
