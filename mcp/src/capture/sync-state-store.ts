import fs from "node:fs";
import path from "node:path";
import { synapseRoot } from "./handoff-paths.js";

export interface SyncState {
  cloudConversationId: string;
  lastSyncedMessageCount: number;
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
        entries.push([
          k,
          { cloudConversationId: v.cloudConversationId, lastSyncedMessageCount: v.lastSyncedMessageCount },
        ]);
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
