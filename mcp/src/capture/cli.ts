import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { accent, bold, muted, success } from "../cli/theme.js";
import { DaemonManager } from "./daemon.js";
import { OpensslMissingError, caStatus, installCa, uninstallCa } from "./proxy/onboarding.js";
import {
  deleteProxyConfig,
  effectiveProxyEnabled,
  proxyConfigPath,
  readProxyConfig,
  writeProxyConfig,
} from "./proxy/proxy-config.js";
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
  // Defensive: unhandled 'error' on a detached spawn kills the parent
  // (see daemon.spawnPrewarm comment for the bug-class explanation).
  child.on("error", () => {});

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
    case "enable":
      return proxyEnable();
    case "disable":
      return proxyDisable();
    default:
      proxyHelp();
  }
}

function proxyHelp(): void {
  clack.intro(`${accent("◆")} ${bold("Synapse Proxy")}`);
  clack.log.message(
    [
      `  ${accent("install")}     Install proxy CA into login keychain + print env snippet`,
      `  ${accent("enable")}      Turn on proxy capture (writes config + restarts daemon)`,
      `  ${accent("disable")}     Turn off proxy capture (removes config + restarts daemon)`,
      `  ${accent("status")}      Show CA path, fingerprint, keychain trust state, enable state`,
      `  ${accent("uninstall")}   Remove proxy CA from login keychain`,
    ].join("\n"),
  );
  clack.outro(muted("synapsesync capture proxy <command>"));
}

function proxyInstall(): void {
  clack.intro(`${accent("◆")} ${bold("Synapse Proxy")} — install CA`);
  let r: ReturnType<typeof installCa>;
  try {
    r = installCa();
  } catch (err) {
    // Surface `OpensslMissingError` as a clean operator-facing message with
    // the platform-specific install hint, instead of a raw stack trace.
    if (err instanceof OpensslMissingError) {
      clack.log.error("Missing prerequisite: openssl");
      clack.log.message(muted(`  ${err.installHint}`));
      clack.outro(muted("Install openssl and re-run `synapsesync capture proxy install`."));
      process.exit(1);
    }
    throw err;
  }
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
      bold("Then turn on proxy capture (writes config + restarts daemon):"),
      muted("  synapsesync capture proxy enable"),
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
  const cfg = readProxyConfig();
  const enabled = effectiveProxyEnabled(process.env);

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
  if (enabled) {
    lines.push(
      `  ${success("●")} ${bold("Enabled")}     ${success("on")} ${muted(`(${cfg.enabledAt ? `since ${cfg.enabledAt}` : "via env override"})`)}`,
    );
  } else {
    lines.push(`  ${muted("○")} ${bold("Enabled")}     ${muted("off")}`);
  }
  lines.push(`  ${muted("●")} ${bold("Proxy port")}  ${accent(String(r.proxyPort))}`);
  clack.log.message(lines.join("\n"));

  if (!r.caExists || !r.inKeychain) {
    clack.log.message(`\n${bold("To complete onboarding:")}\n${muted("  synapsesync capture proxy install")}`);
  } else if (!enabled) {
    clack.log.message(`\n${bold("To turn on proxy capture:")}\n${muted("  synapsesync capture proxy enable")}`);
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

async function proxyEnable(): Promise<void> {
  clack.intro(`${accent("◆")} ${bold("Synapse Proxy")} — enable`);
  writeProxyConfig({ enabled: true, enabledAt: new Date().toISOString() });
  clack.log.success(`Proxy enabled (config: ${muted(proxyConfigPath())})`);

  const r = await restartDaemon();
  if (r.stoppedPid) clack.log.message(muted(`  Stopped previous daemon (PID ${r.stoppedPid})`));
  if (r.startedPid) {
    clack.log.success(`Daemon running with proxy active ${muted(`(PID ${r.startedPid})`)}`);
  } else {
    clack.log.warn("Failed to spawn daemon — run `synapsesync capture start` manually.");
  }
  clack.outro(muted("Point tools at http://127.0.0.1:7727 (HTTPS_PROXY env)"));
}

async function proxyDisable(): Promise<void> {
  clack.intro(`${accent("◆")} ${bold("Synapse Proxy")} — disable`);
  deleteProxyConfig();
  clack.log.success("Proxy disabled (config removed)");

  const r = await restartDaemon();
  if (r.stoppedPid) clack.log.message(muted(`  Stopped previous daemon (PID ${r.stoppedPid})`));
  if (r.startedPid) {
    clack.log.success(`Daemon running without proxy ${muted(`(PID ${r.startedPid})`)}`);
  } else {
    clack.log.warn("Failed to spawn daemon — run `synapsesync capture start` manually.");
  }
  clack.outro(muted("synapsesync.app"));
}

/**
 * Stop the daemon (if running), wait for it to actually exit, then
 * spawn a fresh one. Returns the old + new PIDs for logging.
 *
 * Critical race: if we don't wait for the old process to exit, the
 * new daemon may try to bind port 7727 while the old one still owns
 * it, causing EADDRINUSE. Polling `kill -0 pid` (via `process.kill(pid, 0)`)
 * is the standard portable way to wait for process death without
 * needing wait()/waitpid().
 */
async function restartDaemon(): Promise<{ stoppedPid?: number; startedPid?: number }> {
  let stoppedPid: number | undefined;
  if (daemon.isRunning()) {
    const pid = daemon.readPid();
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already dead */
      }
      daemon.cleanup();
      const exited = await waitForProcessExit(pid, 5000);
      if (!exited) {
        // Hung in shutdown (e.g., openssl spawn mid-CONNECT). Escalate
        // so we don't leak a daemon — better to lose an in-flight
        // capture than to fail the restart and leave the user in a
        // half-broken state.
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* */
        }
        await waitForProcessExit(pid, 2000);
      }
      stoppedPid = pid;
    }
  }

  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "capture-worker.js");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  // Defensive: unhandled 'error' on a detached spawn kills the parent
  // (see daemon.spawnPrewarm comment for the bug-class explanation).
  child.on("error", () => {});
  child.unref();

  let startedPid: number | undefined;
  if (child.pid) {
    daemon.writePid(child.pid);
    startedPid = child.pid;
  }
  return { stoppedPid, startedPid };
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // signal 0 = existence check, never delivers a signal
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      return true; // process is gone
    }
  }
  return false; // still alive past deadline
}
