import { EventEmitter } from "node:events";
import fs from "node:fs";
import { type FSWatcher, watch } from "chokidar";
import type { AdapterRegistry } from "./adapter-registry.js";
import type { CapturedSession } from "./types.js";

export type WatcherHealth = "healthy" | "degraded" | "error";

interface FileState {
  mtime: number;
  size: number;
}

export class CaptureWatcher extends EventEmitter {
  private registry: AdapterRegistry;
  private fsWatcher: FSWatcher | null = null;
  private running = false;
  private health: WatcherHealth = "healthy";
  private lastError: string | null = null;

  // Event queue for batch processing
  private eventQueue: Set<string> = new Set();
  private processTimer: ReturnType<typeof setInterval> | null = null;

  // mtime+size dedup tracking
  private fileStates = new Map<string, FileState>();

  // Configurable scan interval (ms)
  private scanInterval: number;

  constructor(registry: AdapterRegistry, scanInterval = 5000) {
    super();
    this.registry = registry;
    this.scanInterval = scanInterval;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const paths = this.registry.allWatchPaths();
    if (paths.length === 0) return;

    // Check which paths actually exist
    const existingPaths = paths.filter((p) => {
      try {
        fs.accessSync(p);
        return true;
      } catch {
        return false;
      }
    });

    if (existingPaths.length === 0) {
      this.health = "degraded";
      this.lastError = "No watch paths exist";
      // Still start -- chokidar can watch non-existent paths
    }

    if (existingPaths.length < paths.length) {
      this.health = "degraded";
      this.lastError = `${paths.length - existingPaths.length} watch path(s) not found`;
    }

    this.fsWatcher = watch(paths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    this.fsWatcher.on("add", (filePath) => this.queueEvent(filePath));
    this.fsWatcher.on("change", (filePath) => this.queueEvent(filePath));
    this.fsWatcher.on("error", (err) => {
      this.health = "error";
      this.lastError = String(err);
      this.emit("error", err);
    });

    // Batch process events on scan interval
    this.processTimer = setInterval(() => this.processQueue(), this.scanInterval);

    this.running = true;

    await new Promise<void>((resolve) => {
      if (this.fsWatcher) {
        this.fsWatcher.on("ready", resolve);
      } else {
        resolve();
      }
    });
  }

  async stop(): Promise<void> {
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
    // Process any remaining events before stopping
    this.processQueue();
    if (this.fsWatcher) {
      await this.fsWatcher.close();
      this.fsWatcher = null;
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getHealth(): WatcherHealth {
    return this.health;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private queueEvent(filePath: string): void {
    this.eventQueue.add(filePath);
  }

  private processQueue(): void {
    if (this.eventQueue.size === 0) return;

    // Snapshot and clear the queue
    const paths = Array.from(this.eventQueue);
    this.eventQueue.clear();

    for (const filePath of paths) {
      this.handleEvent(filePath);
    }
  }

  private hasFileChanged(filePath: string): boolean {
    try {
      const stat = fs.statSync(filePath);
      const current: FileState = { mtime: stat.mtimeMs, size: stat.size };
      const previous = this.fileStates.get(filePath);

      if (previous && previous.mtime >= current.mtime && previous.size === current.size) {
        return false; // Unchanged
      }

      this.fileStates.set(filePath, current);
      return true;
    } catch {
      return false; // File gone or unreadable
    }
  }

  private handleEvent(filePath: string): void {
    // mtime+size dedup
    if (!this.hasFileChanged(filePath)) return;

    const adapter = this.registry.findByPath(filePath);
    if (!adapter) return;

    try {
      const session: CapturedSession | null = adapter.parse(filePath);
      if (!session) return;
      this.emit("session", session);
    } catch (err) {
      this.emit("error", err);
    }
  }
}
