// mcp/src/capture/cli.ts
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accent, bold, muted } from "../cli/theme.js";
import { DaemonManager } from "./daemon.js";
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
    default:
      console.log(`${bold("Usage:")}`);
      console.log("  npx synapsesync-mcp capture start    Start capture daemon");
      console.log("  npx synapsesync-mcp capture stop     Stop capture daemon");
      console.log("  npx synapsesync-mcp capture status   Check daemon status");
      console.log("  npx synapsesync-mcp capture list     List captured sessions");
  }
}

function startCapture(): void {
  if (daemon.isRunning()) {
    console.log(`${accent("Capture daemon is already running")} (PID ${daemon.readPid()})`);
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
    console.log(`${accent("Capture daemon started")} (PID ${child.pid})`);
    console.log(muted(`Log: ${daemon.getLogFile()}`));
  }
}

function stopCapture(): void {
  const pid = daemon.readPid();
  if (!pid || !daemon.isRunning()) {
    console.log("Capture daemon is not running.");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    daemon.cleanup();
    console.log(`${accent("Capture daemon stopped")} (PID ${pid})`);
  } catch {
    console.log("Failed to stop daemon. It may have already exited.");
    daemon.cleanup();
  }
}

function captureStatus(): void {
  const status = daemon.status();
  if (status.running) {
    console.log(`${accent("Running")} (PID ${status.pid})`);
  } else {
    console.log(muted("Not running"));
  }

  const sessions = store.list();
  console.log(`${sessions.length} captured session(s)`);
}

function listCaptures(): void {
  const sessions = store.list();
  if (sessions.length === 0) {
    console.log(muted("No captured sessions yet."));
    return;
  }

  for (const s of sessions.slice(0, 20)) {
    const date = new Date(s.updatedAt).toLocaleString();
    const msgCount = s.messages.length;
    console.log(`  ${accent(s.id)}  ${s.tool}  ${msgCount} msgs  ${date}`);
  }

  if (sessions.length > 20) {
    console.log(muted(`  ... and ${sessions.length - 20} more`));
  }
}
