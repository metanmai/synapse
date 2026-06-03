import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { accent, bold, muted, success } from "../cli/theme.js";
import { DaemonManager } from "./daemon.js";
import { caStatus, installCa, uninstallCa } from "./proxy/onboarding.js";
import { SessionStore } from "./store.js";

const daemon = new DaemonManager();
const store = new SessionStore();

export async function runCapture(args: string[]): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "start":
      return startCapture();
    case "stop":
      return stopCapture();
    case "status":
      return captureStatus();
    case "list":
      return listCaptures();
    case "proxy":
      return runProxy(args.slice(1));
    default:
      captureHelp();
  }
}

function captureHelp(): void {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Capture")}`);
  clack.log.message(
    [
      `  ${accent("start")}            Start the session capture daemon`,
      `  ${accent("stop")}             Stop the capture daemon`,
      `  ${accent("status")}           Check daemon status and session count`,
      `  ${accent("list")}             List recently captured sessions`,
      `  ${accent("proxy install")}    Install LLM proxy CA in your trust store`,
      `  ${accent("proxy status")}     Show proxy CA + onboarding state`,
      `  ${accent("proxy uninstall")}  Remove proxy CA from your trust store`,
    ].join("\n"),
  );
  clack.outro(muted("synapsesync capture <command>"));
}

function startCapture(): void {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Capture")}`);

  if (daemon.isRunning()) {
    clack.log.info(`Daemon is already running ${muted(`(PID ${daemon.readPid()})`)}`);
    clack.outro(muted("Use 'capture stop' to restart"));
    return;
  }

  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "capture-worker.js");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });

  child.unref();
  if (child.pid) {
    daemon.writePid(child.pid);
    clack.log.success(`Daemon started ${muted(`(PID ${child.pid})`)}`);
    clack.log.message(muted(`  Log: ${daemon.getLogFile()}`));
  }
  clack.outro(muted("Sessions will be captured automatically"));
}

function stopCapture(): void {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Capture")}`);

  const pid = daemon.readPid();
  if (!pid || !daemon.isRunning()) {
    clack.log.info("Daemon is not running.");
    clack.outro(muted("Use 'capture start' to begin"));
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    daemon.cleanup();
    clack.log.success(`Daemon stopped ${muted(`(PID ${pid})`)}`);
  } catch {
    clack.log.warn("Could not stop daemon — it may have already exited.");
    daemon.cleanup();
  }
  clack.outro(muted("synapsesync.app"));
}

function captureStatus(): void {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Capture")}`);

  const status = daemon.status();
  const sessions = store.list();

  const lines: string[] = [];

  // Daemon status
  if (status.running) {
    lines.push(`  ${success("\u25CF")} ${bold("Daemon")}  ${success("running")} ${muted(`PID ${status.pid}`)}`);
  } else {
    lines.push(`  ${muted("\u25CB")} ${bold("Daemon")}  ${muted("stopped")}`);
  }

  // Session count
  lines.push(`  ${muted("\u25CF")} ${bold("Sessions")}  ${accent(String(sessions.length))} captured`);

  // Tool breakdown if sessions exist
  if (sessions.length > 0) {
    const toolCounts = new Map<string, number>();
    for (const s of sessions) {
      toolCounts.set(s.tool, (toolCounts.get(s.tool) ?? 0) + 1);
    }
    const breakdown = Array.from(toolCounts.entries())
      .map(([tool, count]) => `${tool} ${muted(`(${count})`)}`)
      .join(muted("  \u00B7  "));
    lines.push(`           ${breakdown}`);
  }

  clack.log.message(lines.join("\n"));
  clack.outro(muted("synapsesync.app"));
}

function listCaptures(): void {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Sessions")}`);

  const sessions = store.list();
  if (sessions.length === 0) {
    clack.log.info("No captured sessions yet.");
    clack.log.message(muted(`  Run ${accent("synapsesync capture start")} to begin.`));
    clack.outro(muted("synapsesync.app"));
    return;
  }

  const lines = sessions.slice(0, 20).map((s) => {
    const date = new Date(s.updatedAt).toLocaleString();
    const msgs = `${s.messages.length} msgs`;
    const toolLabel = s.tool.padEnd(12);
    return `  ${accent(s.id)}  ${bold(toolLabel)}  ${muted(msgs.padEnd(10))}  ${muted(date)}`;
  });

  clack.log.message(lines.join("\n"));

  if (sessions.length > 20) {
    clack.log.message(muted(`  … and ${sessions.length - 20} more`));
  }

  clack.outro(muted(`${sessions.length} session(s) total`));
}

// ── Proxy subcommands ────────────────────────────────────────────────────

async function runProxy(args: string[]): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case "install":
      return proxyInstall();
    case "status":
      return proxyStatus();
    case "uninstall":
      return proxyUninstall();
    default:
      proxyHelp();
  }
}

function proxyHelp(): void {
  clack.intro(`${accent("◆")} ${bold("Synapse Proxy")}`);
  clack.log.message(
    [
      `  ${accent("install")}     Install proxy CA into login keychain + print env snippet`,
      `  ${accent("status")}      Show CA path, fingerprint, keychain trust state`,
      `  ${accent("uninstall")}   Remove proxy CA from login keychain`,
    ].join("\n"),
  );
  clack.outro(muted("synapsesync capture proxy <command>"));
}

function proxyInstall(): void {
  clack.intro(`${accent("◆")} ${bold("Synapse Proxy")} — install CA`);
  const r = installCa();
  clack.log.message(
    [`  ${bold("CA path:")}      ${r.caPath}`, `  ${bold("Fingerprint:")}  ${muted(r.fingerprint)}`].join("\n"),
  );
  if (r.skippedReason) {
    clack.log.warn(`Keychain install skipped: ${r.skippedReason}`);
  } else if (r.installedInKeychain) {
    clack.log.success("CA installed in login keychain.");
  } else {
    clack.log.warn("Auto-install did not register the cert. Use the manual steps below.");
  }
  clack.log.message(
    [
      "",
      bold("Add to your shell rc (~/.zshrc or ~/.bashrc):"),
      muted(r.envSnippet),
      "",
      bold("Then enable the daemon's proxy + restart:"),
      muted("  export SYNAPSE_PROXY_ENABLE=1"),
      muted("  synapsesync capture stop && synapsesync capture start"),
    ].join("\n"),
  );
  if (!r.installedInKeychain) {
    clack.log.message(`\n${bold("Manual fallback:")}\n${muted(r.manualInstallInstructions)}`);
  }
  clack.outro(muted(`Proxy will listen on http://127.0.0.1:${r.proxyPort}`));
}

function proxyStatus(): void {
  clack.intro(`${accent("◆")} ${bold("Synapse Proxy")} — status`);
  const r = caStatus();

  const lines: string[] = [];
  if (r.caExists) {
    lines.push(`  ${success("●")} ${bold("CA")}          ${success("present")}  ${muted(r.caPath)}`);
    if (r.fingerprint) lines.push(`           ${muted(r.fingerprint)}`);
  } else {
    lines.push(`  ${muted("○")} ${bold("CA")}          ${muted("not generated")} ${muted(`(${r.caPath})`)}`);
  }
  if (r.inKeychain) {
    lines.push(`  ${success("●")} ${bold("Keychain")}    ${success("trusted")} ${muted("(login keychain)")}`);
  } else {
    lines.push(`  ${muted("○")} ${bold("Keychain")}    ${muted("not trusted")}`);
  }
  lines.push(`  ${muted("●")} ${bold("Proxy port")}  ${accent(String(r.proxyPort))}`);
  clack.log.message(lines.join("\n"));

  if (!r.caExists || !r.inKeychain) {
    clack.log.message(`\n${bold("To complete onboarding:")}\n${muted("  synapsesync capture proxy install")}`);
  } else {
    clack.log.message(`\n${bold("Env snippet (paste into shell rc if not already set):")}\n${muted(r.envSnippet)}`);
  }
  clack.outro(muted("synapsesync.app"));
}

function proxyUninstall(): void {
  clack.intro(`${accent("◆")} ${bold("Synapse Proxy")} — uninstall CA`);
  const r = uninstallCa();
  if (r.removed) {
    clack.log.success("CA removed from login keychain.");
  } else if (r.skippedReason) {
    clack.log.info(`Nothing to uninstall: ${r.skippedReason}`);
  } else {
    clack.log.warn("Could not remove CA from keychain. Check Keychain Access manually.");
  }
  clack.log.message(muted("  The CA pem file on disk is preserved — reinstall with `proxy install`."));
  clack.outro(muted("synapsesync.app"));
}
