import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AdapterRegistry } from "./adapter-registry.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { ClineAdapter } from "./adapters/cline.js";
import { CodexAdapter } from "./adapters/codex.js";
import { CopilotCliAdapter } from "./adapters/copilot-cli.js";
import { CursorAdapter } from "./adapters/cursor.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { RooCodeAdapter } from "./adapters/roo-code.js";
import { CloudSyncer } from "./cloud-sync.js";
import { SessionStore } from "./store.js";
import { CaptureWatcher } from "./watcher.js";

const logFile = path.join(os.homedir(), ".synapse", "capture.log");

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
}

async function main(): Promise<void> {
  log("Capture daemon starting");

  const registry = new AdapterRegistry();
  registry.register(new ClaudeCodeAdapter());
  registry.register(new ClineAdapter());
  registry.register(new CodexAdapter());
  registry.register(new CopilotCliAdapter());
  registry.register(new CursorAdapter());
  registry.register(new GeminiAdapter());
  registry.register(new RooCodeAdapter());

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

    // Pass the adapter through so the syncer can invoke its local-CLI
    // `compact()` method on first sync. Adapters without compact() skip
    // local-CLI compaction; the dashboard falls back to the hosted path.
    const ok = await syncer.sync(stored, adapter);
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
