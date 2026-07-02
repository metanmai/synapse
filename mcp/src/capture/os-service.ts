import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStableNodePath } from "../cli/util/node-path.js";

export const LAUNCHD_LABEL = "app.synapsesync.daemon";

/**
 * Windows Task Scheduler task name for the daemon. Used both for the
 * `schtasks /Create /TN <name>` registration and the `schtasks /Query
 * /TN <name>` supervisor check. No backslash prefix — `schtasks` accepts
 * either `SynapseSync` or `\SynapseSync` and normalises to the latter.
 */
export const WINDOWS_TASK_NAME = "SynapseSync";

export interface ServiceTemplate {
  /** Absolute path to the node executable that will run the daemon. */
  node: string;
  /** Absolute path to the synapse CLI entry script (commands.js). */
  script: string;
  /** Path to the daemon's combined stdout/stderr log file. */
  log: string;
}

export function renderLaunchdPlist(a: ServiceTemplate): string {
  // launchd parses each <string> in ProgramArguments as a separate argv
  // entry — the first one MUST be the executable path, not a shell command.
  // Combining `node` + script into a single string makes launchd try to
  // exec a literal file named "node /path/to/script.js" and fail with
  // status 127 << 8 = 19968. Each token gets its own <string>.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${a.node}</string>
    <string>${a.script}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>${a.log}</string>
  <key>StandardOutPath</key><string>${a.log}</string>
</dict>
</plist>`;
}

export function renderSystemdUnit(a: ServiceTemplate): string {
  // systemd parses ExecStart as a shell-style command line where the first
  // token is the absolute executable and subsequent tokens are args.
  return `[Unit]
Description=Synapse capture and handoff daemon
After=network.target

[Service]
ExecStart=${a.node} ${a.script} daemon
Restart=always
RestartSec=5
StandardOutput=append:${a.log}
StandardError=append:${a.log}

[Install]
WantedBy=default.target
`;
}

/**
 * XML-escape a string so it's safe to interpolate into an element body or a
 * double-quoted attribute. Paths normally only need `&` escaping (rare in
 * Windows paths but possible), but handling all five named entities makes
 * the renderer robust if a user's home directory ever contains `<`/`>`/etc.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render the Windows Task Scheduler XML definition that runs the daemon at
 * user logon. Mirrors the macOS launchd plist's `RunAtLoad=true` and the
 * Linux systemd unit's `Restart=always` semantics:
 *   - `<LogonTrigger>` fires once at user logon (like RunAtLoad)
 *   - `<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>` so an
 *     already-running daemon doesn't get a sibling spawned
 *   - `<RestartOnFailure>` retries 3× at 1-minute intervals on crash (a
 *     softer KeepAlive — Task Scheduler doesn't have a true "always restart"
 *     loop; for chronic crashes the user re-logs or runs `synapsesync
 *     daemon` manually)
 *   - `<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>` — no time cap (the
 *     daemon is meant to run continuously)
 *   - `<LogonType>InteractiveToken</LogonType>` + `<RunLevel>LeastPrivilege
 *     </RunLevel>` so the task runs as the current user without elevation
 *     (no UAC prompt at install time)
 *
 * Stdout/stderr redirection: Task Scheduler doesn't natively pipe a task's
 * output to a file the way launchd/systemd do. We rely on the daemon
 * writing its own log via the existing `~/.synapse/daemon.log` writer
 * (capture-worker.ts) — the `a.log` field is unused on Windows but kept in
 * the signature for cross-platform symmetry.
 */
export function renderTaskSchedulerXml(a: ServiceTemplate): string {
  const cmd = escapeXml(a.node);
  // Quote the script path so spaces in `C:\Users\Some User\...` survive the
  // schtasks argv split. `daemon` is a single token so doesn't need quoting.
  const args = escapeXml(`"${a.script}" daemon`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Synapse capture and handoff daemon</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${cmd}</Command>
      <Arguments>${args}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

/**
 * Activate the service file the OS just received. Idempotent: an already-loaded
 * service produces a launchctl/systemctl error which we swallow (re-running
 * install should never throw).
 *
 * On macOS we unload-then-load so re-installs pick up a new plist body
 * (launchd caches the previous Label config until unloaded). The `-w` on load
 * flips the Disabled key to false in the LaunchDaemons overrides, so the
 * service stays loaded across reboots.
 */
function loadServiceFile(p: string): void {
  if (process.platform === "darwin") {
    try {
      execSync(`launchctl unload "${p}"`, { stdio: "ignore" });
    } catch {
      // Service wasn't loaded yet — fine, this is first install.
    }
    try {
      execSync(`launchctl load -w "${p}"`, { stdio: "ignore" });
    } catch {
      // Best-effort: load can fail for reasons we can't recover from in-process
      // (e.g. SIP restrictions, malformed plist) — surface via daemon.log
      // rather than crashing the install.
    }
    return;
  }
  if (process.platform === "linux") {
    try {
      execSync("systemctl --user daemon-reload", { stdio: "ignore" });
    } catch {
      /* not running under systemd — fine */
    }
    try {
      execSync("systemctl --user enable --now synapsesync.service", { stdio: "ignore" });
    } catch {
      /* enable failed — daemon.log will show why */
    }
    return;
  }
  if (process.platform === "win32") {
    // schtasks /Create reads the XML and registers (or replaces, via /F) the
    // task in the per-user store. No elevation required because the XML
    // declares RunLevel=LeastPrivilege + LogonType=InteractiveToken.
    // Quoting: `/XML` and `/TN` values must be CMD-escaped — schtasks runs
    // under cmd.exe even when invoked from bash via execSync. Path with
    // spaces is wrapped in double-quotes; the path itself can't contain
    // unescaped quotes so this is safe.
    try {
      execSync(`schtasks /Create /TN "${WINDOWS_TASK_NAME}" /XML "${p}" /F`, {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Registration failed — surface via daemon.log on first manual run.
      // Reasons: malformed XML, AV blocking the schtasks invocation, or
      // user lacks "Log on as a batch job" right (rare on personal Windows
      // installs). Don't crash install; the user can run `synapsesync
      // daemon` manually until they resolve the issue.
    }
  }
}

/**
 * Resolve the absolute path to the CLI entry script that the daemon will run.
 *
 * Must point to dist/index.js (which registers the dispatcher + handlers and
 * dispatches the `daemon` subcommand to its handler), NOT dist/cli/commands.js
 * (which is a helper module with no top-level main — exec'ing it with `daemon`
 * as argv would just load the module and exit cleanly with no daemon). After
 * build, os-service.js lives at dist/capture/os-service.js, so ../index.js
 * resolves up one level to dist/index.js.
 *
 * Exported so the regression test can pin the resolution without invoking
 * writeServiceFile (which would touch ~/Library/LaunchAgents).
 */
export function resolveDaemonScriptPath(moduleUrl: string): string {
  const here = path.dirname(fileURLToPath(moduleUrl));
  return path.resolve(here, "../index.js");
}

export function writeServiceFile(): { platform: string; path: string } {
  // process.execPath is the absolute path to the node binary that's running
  // this install — pinning to an absolute node keeps the daemon on a known
  // interpreter even when the user's PATH changes or multiple node installs
  // coexist. resolveStableNodePath rewrites Homebrew Cellar paths to the
  // formula's stable symlink: the raw execPath there is version-pinned and
  // vanishes on `brew upgrade node`, leaving launchd/systemd unable to
  // respawn the daemon after the next restart.
  const nodeBin = resolveStableNodePath();
  const script = resolveDaemonScriptPath(import.meta.url);
  const log = path.join(os.homedir(), ".synapse", "daemon.log");
  const tmpl = { node: nodeBin, script, log };

  if (process.platform === "darwin") {
    const p = path.join(os.homedir(), "Library/LaunchAgents/app.synapsesync.daemon.plist");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, renderLaunchdPlist(tmpl));
    loadServiceFile(p);
    return { platform: "darwin", path: p };
  }
  if (process.platform === "linux") {
    const p = path.join(os.homedir(), ".config/systemd/user/synapsesync.service");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, renderSystemdUnit(tmpl));
    loadServiceFile(p);
    return { platform: "linux", path: p };
  }
  if (process.platform === "win32") {
    // The XML lives under `~/.synapse/` (already created by other code paths)
    // rather than `~/Library/LaunchAgents`-style platform conventions —
    // Windows doesn't have a per-user task XML directory, and the file is
    // only an artifact we hand to schtasks; the registered task lives in
    // the Task Scheduler database, not on disk.
    const p = path.join(os.homedir(), ".synapse", "synapsesync.task.xml");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, renderTaskSchedulerXml(tmpl));
    loadServiceFile(p);
    return { platform: "win32", path: p };
  }
  throw new Error(
    `Unsupported platform: ${process.platform}. Synapse supports darwin, linux, and win32; run \`synapsesync daemon\` manually on other platforms.`,
  );
}

/**
 * Path to the installed service file for the current platform, or null on
 * unsupported platforms. Pure function — does not touch disk.
 */
export function serviceFilePath(): string | null {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/LaunchAgents/app.synapsesync.daemon.plist");
  }
  if (process.platform === "linux") {
    return path.join(os.homedir(), ".config/systemd/user/synapsesync.service");
  }
  if (process.platform === "win32") {
    return path.join(os.homedir(), ".synapse", "synapsesync.task.xml");
  }
  return null;
}

/**
 * Unload the daemon from the OS service supervisor (launchd on macOS, systemd
 * on Linux) and delete the unit file. Returns true if anything was removed.
 * Best-effort: a service that's already unloaded or a missing file is a no-op.
 */
export function removeServiceFile(): boolean {
  const p = serviceFilePath();
  if (!p || !fs.existsSync(p)) return false;

  if (process.platform === "darwin") {
    try {
      execSync(`launchctl unload "${p}"`, { stdio: "ignore" });
    } catch {
      // Service may not be loaded (e.g. user manually unloaded it).
    }
  } else if (process.platform === "linux") {
    try {
      execSync("systemctl --user disable --now synapsesync.service", { stdio: "ignore" });
    } catch {
      // Unit may not be enabled.
    }
  } else if (process.platform === "win32") {
    try {
      execSync(`schtasks /Delete /TN "${WINDOWS_TASK_NAME}" /F`, {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Task may not exist (already removed, or never registered).
    }
  }

  try {
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
