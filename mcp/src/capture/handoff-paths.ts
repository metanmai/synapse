import os from "node:os";
import path from "node:path";

export function synapseRoot(): string {
  return process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
}

export function projectDir(project_id: string): string {
  return path.join(synapseRoot(), "projects", project_id);
}

export function currentSessionPath(p: string): string {
  return path.join(projectDir(p), "current_session.json");
}

export function statusCachePath(p: string): string {
  return path.join(projectDir(p), "cache", "project_status.json");
}

export function briefCachePath(p: string): string {
  return path.join(projectDir(p), "cache", "brief.md");
}

export function healthcheckPath(): string {
  return path.join(synapseRoot(), "daemon.healthcheck");
}

export function flushNowSignalPath(): string {
  return path.join(synapseRoot(), "daemon-flush-now");
}
