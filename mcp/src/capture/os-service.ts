import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ServiceTemplate {
  bin: string;
  log: string;
}

export function renderLaunchdPlist(a: ServiceTemplate): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.synapsesync.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${a.bin}</string><string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>${a.log}</string>
  <key>StandardOutPath</key><string>${a.log}</string>
</dict>
</plist>`;
}

export function renderSystemdUnit(a: ServiceTemplate): string {
  return `[Unit]
Description=Synapse capture and handoff daemon
After=network.target

[Service]
ExecStart=${a.bin} daemon
Restart=always
RestartSec=5
StandardOutput=append:${a.log}
StandardError=append:${a.log}

[Install]
WantedBy=default.target
`;
}

export function writeServiceFile(): { platform: string; path: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const synapseBin = `node ${path.resolve(here, "../cli/commands.js")}`;
  const log = path.join(os.homedir(), ".synapse", "daemon.log");

  if (process.platform === "darwin") {
    const p = path.join(os.homedir(), "Library/LaunchAgents/app.synapsesync.daemon.plist");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, renderLaunchdPlist({ bin: synapseBin, log }));
    return { platform: "darwin", path: p };
  }
  if (process.platform === "linux") {
    const p = path.join(os.homedir(), ".config/systemd/user/synapsesync.service");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, renderSystemdUnit({ bin: synapseBin, log }));
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
