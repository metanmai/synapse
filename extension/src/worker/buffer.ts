/**
 * Capture buffer with dedupe + cap (P4). The MV3 service worker is evicted
 * after ~30s idle, losing in-memory state — so this buffer is serialized to
 * chrome.storage.session (toJSON/fromJSON) and restored on wake. The cap +
 * drop-oldest is the daemon-unreachable policy: never grow without bound.
 */

export interface BufferedTurn {
  host: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
}

export class CaptureBuffer {
  private items: BufferedTurn[] = [];
  private seen = new Set<string>();

  constructor(private readonly cap: number = 500) {}

  private key(t: BufferedTurn): string {
    return `${t.host}|${t.role}|${t.content}`;
  }

  /** Add a turn. Dedupes identical turns; drops oldest beyond the cap. Returns true if newly added. */
  add(t: BufferedTurn): boolean {
    const k = this.key(t);
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    this.items.push(t);
    while (this.items.length > this.cap) {
      const dropped = this.items.shift();
      if (dropped) this.seen.delete(this.key(dropped));
    }
    return true;
  }

  /** Remove and return everything buffered (called on a successful flush). */
  drain(): BufferedTurn[] {
    const out = this.items;
    this.items = [];
    this.seen.clear();
    return out;
  }

  get size(): number {
    return this.items.length;
  }

  toJSON(): BufferedTurn[] {
    return this.items;
  }

  static fromJSON(items: BufferedTurn[], cap = 500): CaptureBuffer {
    const b = new CaptureBuffer(cap);
    for (const t of items) b.add(t);
    return b;
  }
}
