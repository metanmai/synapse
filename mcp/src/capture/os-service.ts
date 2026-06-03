import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  <key>Label</key><string>app.synapsesync.daemon</string>
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
  // this install. Pinning to that exact node ensures the daemon runs with
  // the same node version, even if the user's PATH changes later or
  // multiple node installs coexist.
  const nodeBin = process.execPath;
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
  throw new Error(
    `Unsupported platform: ${process.platform}. Run \`synapse daemon\` manually until Windows service support lands.`,
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
  }

  try {
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
