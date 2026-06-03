import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CloudSyncer } from "./cloud-sync.js";
import { defaultRegistry } from "./default-registry.js";
import { SessionStore } from "./store.js";
import { CaptureWatcher } from "./watcher.js";

const logFile = path.join(os.homedir(), ".synapse", "capture.log");

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
}

async function main(): Promise<void> {
  log("Capture daemon starting");

  const registry = defaultRegistry();

  log(`Registered adapters: ${registry.tools().join(", ")}`);

  const store = new SessionStore();
  const syncer = new CloudSyncer(log);
  // Optional env override so end-to-end tests can run without waiting the
  // default 5-minute idle window: `SYNAPSE_CAPTURE_IDLE_MS=5000` flushes
  // after ~5 seconds of file quiet. Production default unchanged.
  const idleMs = process.env.SYNAPSE_CAPTURE_IDLE_MS
    ? Number.parseInt(process.env.SYNAPSE_CAPTURE_IDLE_MS, 10)
    : undefined;
  const watcher =
    idleMs && Number.isFinite(idleMs) ? new CaptureWatcher(registry, 5000, idleMs) : new CaptureWatcher(registry);
  if (idleMs && Number.isFinite(idleMs)) log(`Idle timeout overridden via SYNAPSE_CAPTURE_IDLE_MS=${idleMs}ms`);

  watcher.on("session", (session) => {
    log(`Captured session ${session.id} from ${session.tool} (${session.messages.length} messages)`);
    store.save(session);
  });

  watcher.on("idle", async (filePath: string) => {
    const adapter = registry.findByPath(filePath);
    if (!adapter) return;
    const session = adapter.parse(filePath);
    if (!session) return;

    // Load from store (may have more recent data)
    const stored = store.load(session.id);
    if (!stored) return;

    // Compaction is no longer triggered here — it's owned by the pull path
    // (SessionStart hook → handoff-brief). Sync only pushes messages.
    const ok = await syncer.sync(stored);
    if (ok) {
      log(`Synced session ${stored.id} to cloud (${stored.messages.length} messages)`);
    }
  });

  watcher.on("error", (err) => {
    log(`Watcher error: ${err}`);
  });

  process.on("SIGTERM", async () => {
    log("Received SIGTERM, shutting down");
    await watcher.stop();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    log("Received SIGINT, shutting down");
    await watcher.stop();
    process.exit(0);
  });

  await watcher.start();
  log(`Watching: ${registry.allWatchPaths().join(", ")}`);
  log(`Health: ${watcher.getHealth()}`);
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
