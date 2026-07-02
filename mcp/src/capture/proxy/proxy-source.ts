/**
 * ProxySource — adapts the LLM API proxy daemon into a long-running
 * session source compatible with the existing capture pipeline.
 *
 * Layers 1–3b deliver a working proxy primitive that emits
 * `CapturedRequest` events via an `onCaptured` callback. ProxySource
 * is the wrapper that:
 *
 *   • Owns a TlsManager (so the CA persists at ~/.synapse/proxy/ca.pem
 *     across daemon restarts — users only install it once)
 *   • Owns a ProxyServer instance bound to a port
 *   • Buffers CapturedRequests in memory
 *   • On idle (no captures for `idleMs`), flushes the buffer through
 *     `reconstructSessions()` and emits each resulting CapturedSession
 *     as a 'session' event
 *
 * Buffering matters: claude's 3× retry pattern produces 3 CapturedRequests
 * within a few hundred ms of each other. Flushing them as a batch lets
 * reconstructSessions collapse retries into ONE session. Eager per-capture
 * emission would produce 3 duplicates.
 *
 * Lifecycle:
 *   const source = new ProxySource({ idleMs: 30_000 });
 *   const { port, caCertPath } = await source.start();
 *   source.on('session', (session: CapturedSession) => store.save + syncer.sync);
 *   // ... daemon runs, captures pile up ...
 *   await source.stop();  // flushes pending buffer; no captures lost
 *
 * Emits:
 *   'session' — CapturedSession ready for store + cloud-sync
 *   'error'   — surface for daemon-level logging; never thrown
 */

import { EventEmitter } from "node:events";
import type { CapturedSession } from "../types.js";
import { type ProxyServer, createProxyServer } from "./server.js";
import { reconstructSessions } from "./session-reconstruction.js";
import { TlsManager, type TlsManagerOptions } from "./tls.js";
import type { CapturedRequest } from "./types.js";

const DEFAULT_IDLE_MS = 30_000;

export interface ProxySourceOptions {
  /** Port the proxy listens on. 0 = OS-assigned (recommended for tests). */
  port?: number;
  /**
   * Override the TlsManager's cert dir. Defaults to ~/.synapse/proxy/.
   * Tests should pass a tmp dir to avoid touching the user's real CA.
   */
  tlsManagerOptions?: TlsManagerOptions;
  /**
   * How long the buffer must be quiet (no new captures) before flushing.
   * Default 30s — long enough to absorb retries + a follow-up turn,
   * short enough that finished sessions get pushed promptly.
   */
  idleMs?: number;
  /**
   * Idle window passed through to reconstructSessions for session
   * BOUNDARY detection. Distinct from `idleMs` (which controls when
   * the buffer is flushed). If unset, reconstructSessions uses its
   * own default (5 minutes) — which is what production should use,
   * because two requests within a flush batch but more than 5 min
   * apart are genuinely different conversations.
   */
  reconstructIdleMs?: number;
  /**
   * Tool tag applied to emitted sessions. Defaults to "claude-code"
   * matching reconstructSessions' default; UA-based inference is a
   * follow-up.
   */
  tool?: CapturedSession["tool"];
  /**
   * Per-host upstream override forwarded to createProxyServer.
   * Production usage leaves this empty; tests use it to route fake
   * upstreams.
   */
  upstreamMap?: Record<string, string>;
  /**
   * Trust bundle for outbound TLS validation, forwarded to
   * createProxyServer. Production leaves this undefined (Node's
   * default CAs apply); tests pass the fake CA.
   */
  upstreamCa?: string | string[];
}

export interface ProxySourceStartResult {
  /** The port the proxy bound to. */
  port: number;
  /** Filesystem path to the CA cert the user must install in their trust store. */
  caCertPath: string;
}

export class ProxySource extends EventEmitter {
  private readonly opts: ProxySourceOptions;
  private readonly tlsManager: TlsManager;
  private readonly buffer: CapturedRequest[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private proxy: ProxyServer | null = null;

  constructor(opts: ProxySourceOptions = {}) {
    super();
    this.opts = opts;
    this.tlsManager = new TlsManager(opts.tlsManagerOptions);
  }

  /**
   * Generate the CA (if not present) and start the proxy server.
   * Returns the bound port + CA cert path — the caller logs the path
   * so the user knows where to install the CA in their trust store.
   */
  async start(): Promise<ProxySourceStartResult> {
    if (this.proxy) {
      throw new Error("ProxySource already started");
    }
    this.tlsManager.ensureCa();
    this.proxy = await createProxyServer({
      port: this.opts.port,
      tlsManager: this.tlsManager,
      upstreamMap: this.opts.upstreamMap,
      upstreamCa: this.opts.upstreamCa,
      onCaptured: (req) => this.handleCapture(req),
    });
    return {
      port: this.proxy.port,
      caCertPath: this.tlsManager.caCertPath(),
    };
  }

  /**
   * Shut down the proxy. Flushes any buffered captures FIRST so a
   * session that was in-flight when the daemon stopped isn't lost.
   */
  async stop(): Promise<void> {
    this.cancelIdleTimer();
    this.flush();
    if (this.proxy) {
      await this.proxy.stop();
      this.proxy = null;
    }
  }

  /**
   * Force an immediate flush — useful for tests + situations where the
   * caller knows the session is complete (e.g., explicit /flush API).
   * Idempotent on an empty buffer.
   */
  flushNow(): void {
    this.cancelIdleTimer();
    this.flush();
  }

  /** Inspect the current buffer size (testing affordance). */
  bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * Feed a CapturedRequest into the buffer directly, bypassing the
   * proxy server. Used by tests to drive the buffer/flush state
   * machine without sending real TLS traffic. Production callers
   * should rely on the proxy's onCaptured wiring instead.
   */
  ingest(req: CapturedRequest): void {
    this.handleCapture(req);
  }

  private handleCapture(req: CapturedRequest): void {
    this.buffer.push(req);
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    this.cancelIdleTimer();
    const idleMs = this.opts.idleMs ?? DEFAULT_IDLE_MS;
    this.idleTimer = setTimeout(() => {
      this.flush();
    }, idleMs);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const requests = this.buffer.splice(0);
    let sessions: CapturedSession[] = [];
    try {
      // Pass reconstructIdleMs through verbatim — undefined means
      // reconstructSessions uses its own 5min default. We deliberately
      // do NOT couple this to the flush idleMs: a 30s flush window
      // doesn't imply 30s session boundaries (a retry burst is 1s; a
      // new conversation is minutes).
      sessions = reconstructSessions(requests, {
        idleMs: this.opts.reconstructIdleMs,
        tool: this.opts.tool,
      });
    } catch (err) {
      // reconstructSessions is pure-function; a throw here implies a
      // bug in the proxy or session-reconstruction code. Surface it
      // for daemon logging but don't kill the daemon — subsequent
      // captures should still flow.
      this.emit("error", err);
      return;
    }
    for (const session of sessions) {
      this.emit("session", session);
    }
  }
}
