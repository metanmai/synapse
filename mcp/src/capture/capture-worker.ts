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
  const watcher = new CaptureWatcher(registry);

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
