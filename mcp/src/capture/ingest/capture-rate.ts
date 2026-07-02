/**
 * Per-host capture-rate signal (R2 / P1).
 *
 * Detects a SILENTLY-broken adapter. Under the extension architecture a broken
 * adapter (UI/wire change) emits *nothing* — so a signal keyed on "events
 * arrived but none parsed" would never fire in the most likely failure mode.
 * The fix: the extension sends a page-visit `heartbeat` whenever a CAPTURE_HOST
 * tab is active, independent of extraction. A real captured turn is a `capture`.
 * So "heartbeats present, zero captures over the window" = a broken adapter,
 * and becomes detectable.
 */

interface CaptureRateOptions {
  windowMs: number;
}

type RateKind = "heartbeat" | "capture" | "drift";

interface RateEvent {
  host: string;
  ts: number;
  kind: RateKind;
}

export class CaptureRateTracker {
  private readonly windowMs: number;
  private events: RateEvent[] = [];

  constructor(opts: CaptureRateOptions) {
    this.windowMs = opts.windowMs;
  }

  /** A CAPTURE_HOST tab was active — recorded as an attempt with didCapture:false. */
  heartbeat(host: string, ts: number): void {
    this.record(host, ts, "heartbeat");
  }

  /** A real conversation turn was ingested for this host. */
  capture(host: string, ts: number): void {
    this.record(host, ts, "capture");
  }

  private record(host: string, ts: number, kind: RateKind): void {
    this.events.push({ host, ts, kind });
    this.prune(ts);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.events = this.events.filter((e) => e.ts >= cutoff);
  }

  /** Hosts with ≥1 heartbeat but 0 captures within the rolling window ending at `now`. */
  staleHosts(now: number): string[] {
    this.prune(now);
    const heartbeatHosts = new Set<string>();
    const captureHosts = new Set<string>();
    for (const e of this.events) {
      if (e.ts > now) continue;
      if (e.kind === "heartbeat") heartbeatHosts.add(e.host);
      else captureHosts.add(e.host);
    }
    return [...heartbeatHosts].filter((h) => !captureHosts.has(h));
  }

  /** The extension detected matched-but-unparseable completions for this host. */
  drift(host: string, ts: number): void {
    this.record(host, ts, "drift");
  }

  /** Hosts with ≥1 drift event within the rolling window ending at `now`. */
  driftHosts(now: number): string[] {
    this.prune(now);
    const hosts = new Set<string>();
    for (const e of this.events) {
      if (e.ts <= now && e.kind === "drift") hosts.add(e.host);
    }
    return [...hosts];
  }
}
