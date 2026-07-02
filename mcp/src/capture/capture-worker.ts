import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CloudSyncer } from "./cloud-sync.js";
import { defaultRegistry } from "./default-registry.js";
import { CaptureRateTracker } from "./ingest/capture-rate.js";
import { type RunningIngestServer, startIngestServer } from "./ingest/ingest-server.js";
import { DEFAULT_INGEST_PORT, effectiveProxyEnabled, readProxyConfig } from "./proxy/proxy-config.js";
import { ProxySource } from "./proxy/proxy-source.js";
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
    } else {
      // Surface the failure at the same layer that emits the success
      // message. Without this companion log, capture-worker is the
      // boundary that swallows POST failures silently. CloudSync also
      // logs its specific error reason below — keep both so a log scan
      // for one tool's session can find both the "did this session
      // sync?" answer and the "if not, why?" answer.
      log(`Sync FAILED for session ${stored.id} (${stored.messages.length} messages) — see CloudSync log lines above`);
    }
  });

  watcher.on("error", (err) => {
    log(`Watcher error: ${err}`);
  });

  // Optional: spawn the LLM API proxy alongside the file watcher.
  // Enablement resolution (env wins over config — kubectl/git convention):
  //   SYNAPSE_PROXY_ENABLE="1"          → ON (operator override)
  //   SYNAPSE_PROXY_ENABLE="0"          → OFF (operator override)
  //   unset + proxy-config.json enabled → ON  (from `synapsesync capture proxy enable`)
  //   unset + no config / disabled      → OFF (default)
  const proxyEnabled = effectiveProxyEnabled(process.env);
  let proxySource: ProxySource | null = null;
  if (proxyEnabled) {
    // Default 7727 — stable, so users can hard-code HTTPS_PROXY in their
    // shell rc. Override via SYNAPSE_PROXY_PORT only for tests / unusual
    // network setups. Matches DEFAULT_PROXY_PORT in proxy/onboarding.ts.
    const proxyPort = process.env.SYNAPSE_PROXY_PORT ? Number.parseInt(process.env.SYNAPSE_PROXY_PORT, 10) : 7727;
    const proxyIdleMs = process.env.SYNAPSE_PROXY_IDLE_MS
      ? Number.parseInt(process.env.SYNAPSE_PROXY_IDLE_MS, 10)
      : undefined;
    proxySource = new ProxySource({
      port: proxyPort,
      idleMs: proxyIdleMs,
    });
    // Same sink as the file-watcher 'idle' path: save then push to cloud.
    // The proxy buffer is flushed on idle window, so each emitted session
    // is already the "complete enough to push" snapshot — no separate
    // store-then-idle dance like the file adapters need.
    proxySource.on("session", async (session) => {
      log(`Captured proxy session ${session.id} from ${session.tool} (${session.messages.length} messages)`);
      store.save(session);
      const ok = await syncer.sync(session);
      if (ok) log(`Synced proxy session ${session.id} to cloud`);
    });
    proxySource.on("error", (err) => log(`Proxy source error: ${err}`));
    const { port: boundPort, caCertPath } = await proxySource.start();
    log(`Proxy listening on 127.0.0.1:${boundPort}`);
    log(`Proxy CA at ${caCertPath} (install in your trust store before pointing tools at the proxy)`);
  }

  // Optional: browser-capture ingest server. Opt-in is the PRESENCE of
  // proxy-config.ingestToken (minted by the wizard). Loopback only.
  const cfg = readProxyConfig();
  let ingestServer: RunningIngestServer | null = null;
  let staleTimer: ReturnType<typeof setInterval> | null = null;
  if (cfg.ingestToken) {
    const rateTracker = new CaptureRateTracker({ windowMs: 5 * 60 * 1000 });
    ingestServer = await startIngestServer({
      port: cfg.ingestPort ?? DEFAULT_INGEST_PORT,
      token: cfg.ingestToken,
      sync: (session) => syncer.sync(session),
      rateTracker,
      log,
    });
    log(`Browser-capture ingest listening on 127.0.0.1:${ingestServer.port}`);
    // Active R2 signal: a CAPTURE_HOST tab was active but produced zero turns.
    staleTimer = setInterval(() => {
      const stale = rateTracker.staleHosts(Date.now());
      if (stale.length > 0) {
        log(
          `WARNING: browser capture produced zero turns for active host(s): ${stale.join(", ")} — adapter may be broken`,
        );
      }
      const drifted = rateTracker.driftHosts(Date.now());
      if (drifted.length > 0) {
        log(
          `DRIFT: host(s) changed wire format and capture is failing: ${drifted.join(", ")} — re-run scripts/e2e-browser-live.mjs, then patch the adapter + golden fixture`,
        );
      }
    }, 60 * 1000);
    if (typeof staleTimer.unref === "function") staleTimer.unref();
  }

  async function shutdown(signal: string): Promise<void> {
    log(`Received ${signal}, shutting down`);
    if (staleTimer) clearInterval(staleTimer);
    if (ingestServer) await ingestServer.close();
    if (proxySource) await proxySource.stop();
    await watcher.stop();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await watcher.start();
  log(`Watching: ${registry.allWatchPaths().join(", ")}`);
  log(`Health: ${watcher.getHealth()}`);
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
