import fs from "node:fs";
import path from "node:path";
import { synapseRoot } from "./handoff-paths.js";

export interface SyncState {
  cloudConversationId: string;
  lastSyncedMessageCount: number;
  // Cached after first sync. The conversation's owning project on the
  // backend — known after createConversation returns (the backend resolves
  // it from working_context.git_origin_url). Persisted so a daemon restart
  // doesn't have to refetch the conversation row to learn the routing.
  // Older state files written before this field landed will omit these;
  // loadSyncStates tolerates the absence.
  projectId?: string;
  projectName?: string | null;
}

interface SyncStateFile {
  version: 1;
  states: Record<string, SyncState>;
}

const CURRENT_VERSION = 1;

export function syncStatePath(): string {
  return path.join(synapseRoot(), "sync-state.json");
}

export function loadSyncStates(log?: (msg: string) => void): Map<string, SyncState> {
  const file = syncStatePath();
  if (!fs.existsSync(file)) return new Map();

  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as SyncStateFile;
    if (parsed?.version !== CURRENT_VERSION || !parsed.states || typeof parsed.states !== "object") {
      log?.(`sync-state.json has unknown shape (version=${parsed?.version}), starting fresh`);
      return new Map();
    }
    const entries: [string, SyncState][] = [];
    for (const [k, v] of Object.entries(parsed.states)) {
      if (
        v &&
        typeof v === "object" &&
        typeof v.cloudConversationId === "string" &&
        typeof v.lastSyncedMessageCount === "number"
      ) {
        const state: SyncState = {
          cloudConversationId: v.cloudConversationId,
          lastSyncedMessageCount: v.lastSyncedMessageCount,
        };
        if (typeof v.projectId === "string") state.projectId = v.projectId;
        if (typeof v.projectName === "string" || v.projectName === null) state.projectName = v.projectName;
        entries.push([k, state]);
      }
    }
    return new Map(entries);
  } catch (err) {
    log?.(`sync-state.json read failed (${err instanceof Error ? err.message : err}), starting fresh`);
    return new Map();
  }
}

export function saveSyncStates(states: Map<string, SyncState>, log?: (msg: string) => void): void {
  const file = syncStatePath();
  const dir = path.dirname(file);

  try {
    fs.mkdirSync(dir, { recursive: true });
    const payload: SyncStateFile = {
      version: CURRENT_VERSION,
      states: Object.fromEntries(states),
    };
    // Atomic write: temp file in same dir + rename. Keeps the file from
    // landing half-written if the daemon is killed (launchd kills, SIGTERM)
    // between the open and the close.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), "utf-8");
    fs.renameSync(tmp, file);
  } catch (err) {
    log?.(`sync-state.json write failed: ${err instanceof Error ? err.message : err}`);
  }
}
