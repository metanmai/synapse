import fs from "node:fs";
import path from "node:path";
import { healthcheckPath, synapseRoot } from "../capture/handoff-paths.js";
import { checkSupervisor } from "./util/daemon-supervisor.js";

export async function runStatus(): Promise<string> {
  // Primary line: existing healthcheck-age semantics (preserves backwards compat).
  const hcPath = healthcheckPath();
  let line = "Daemon: not running";
  if (fs.existsSync(hcPath)) {
    const ts = new Date(fs.readFileSync(hcPath, "utf-8").trim()).getTime();
    const age = Date.now() - ts;
    line = age < 60_000 ? "Daemon: healthy" : "Daemon: STALE";
  }

  // Additive supervisor context (BUG-02): when checkSupervisor reports a
  // running supervised process, append the supervisor name + PID. When it
  // reports running but unsupervised (PID-only), append only the PID. When
  // running:false, append nothing — line above already says "not running"
  // or healthcheck state. Each branch produces an observably distinct
  // output so the three states are pairwise distinguishable (the bug class
  // BUG-02 closes).
  //
  // TODO: BUGS.md #12 follow-up — surface last successful flush + current
  // backoff state once daemon.log readback lands in slice 1b.
  const sup = checkSupervisor();
  if (sup.running) {
    if (sup.supervisor === "launchd") {
      line += ` · supervised by launchd · PID ${sup.pid ?? "unknown"}`;
    } else if (sup.supervisor === "systemd") {
      line += ` · supervised by systemd · PID ${sup.pid ?? "unknown"}`;
    } else if (sup.pid !== null) {
      line += ` · PID ${sup.pid}`;
    }
  }

  const projects = listProjects();
  return `${line}. Projects tracked: ${projects.length}.`;
}

export async function runDoctor(): Promise<string> {
  const lines: string[] = [];
  // runStatus() already ends with "Projects tracked: N." — don't print the
  // count a second time (it read as a confusing duplicate).
  lines.push(await runStatus());
  for (const p of listProjects()) {
    const eventsPath = path.join(synapseRoot(), "projects", p, "events.jsonl");
    const wmPath = path.join(synapseRoot(), "projects", p, ".watermark");
    const queued = countQueued(eventsPath, wmPath);
    lines.push(`  ${p}: Queued events: ${queued}`);
  }
  return lines.join("\n");
}

function listProjects(): string[] {
  const dir = path.join(synapseRoot(), "projects");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

function countQueued(events: string, watermark: string): number {
  if (!fs.existsSync(events)) return 0;
  const all = fs.readFileSync(events, "utf-8").split("\n").filter(Boolean);
  if (!fs.existsSync(watermark)) return all.length;
  const wm = fs.readFileSync(watermark, "utf-8").trim();
  return all.filter((line) => {
    try {
      const event: { event_id: string } = JSON.parse(line);
      return event.event_id > wm;
    } catch {
      // A single corrupt/partial line (interrupted append) must not crash
      // `doctor` — skip it; the daemon's append is atomic per line anyway.
      return false;
    }
  }).length;
}
