import fs from "node:fs";
import path from "node:path";
import { getMonthlyCostUsd } from "../capture/daemon-cc.js";
import { healthcheckPath, synapseRoot } from "../capture/handoff-paths.js";

export async function runStatus(): Promise<string> {
  const hcPath = healthcheckPath();
  let line = "Daemon: not running";
  if (fs.existsSync(hcPath)) {
    const ts = new Date(fs.readFileSync(hcPath, "utf-8").trim()).getTime();
    const age = Date.now() - ts;
    line = age < 60_000 ? "Daemon: healthy" : "Daemon: STALE";
  }
  const projects = listProjects();
  return `${line}. Projects tracked: ${projects.length}.`;
}

export async function runDoctor(): Promise<string> {
  const lines: string[] = [];
  lines.push(await runStatus());
  lines.push(`Projects tracked: ${listProjects().length}`);
  for (const p of listProjects()) {
    const eventsPath = path.join(synapseRoot(), "projects", p, "events.jsonl");
    const wmPath = path.join(synapseRoot(), "projects", p, ".watermark");
    const queued = countQueued(eventsPath, wmPath);
    lines.push(`  ${p}: Queued events: ${queued}`);
  }
  lines.push(`Monthly daemon cost: $${getMonthlyCostUsd().toFixed(4)}`);
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
    const event: { event_id: string } = JSON.parse(line);
    return event.event_id > wm;
  }).length;
}
