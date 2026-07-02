// Service worker. Receives relayed turns/heartbeats, buffers turns in
// chrome.storage.session (survives ~30s MV3 eviction), and POSTs to the local
// daemon ingest with the shared-secret token. Daemon-down → turns stay buffered
// (cap + drop-oldest in CaptureBuffer); badge shows the backlog.

import { type BufferedTurn, CaptureBuffer } from "./buffer.js";

const DEFAULT_PORT = 7726;

interface RelayMessage {
  __synapse?: boolean;
  kind?: string;
  host?: string;
  role?: string;
  content?: string;
}

async function getConfig(): Promise<{ token?: string; port: number }> {
  const data = await chrome.storage.local.get(["synapseToken", "synapsePort"]);
  return {
    token: typeof data.synapseToken === "string" ? data.synapseToken : undefined,
    port: typeof data.synapsePort === "number" ? data.synapsePort : DEFAULT_PORT,
  };
}

async function loadBuffer(): Promise<CaptureBuffer> {
  const data = await chrome.storage.session.get("synapseBuffer");
  const items = Array.isArray(data.synapseBuffer) ? (data.synapseBuffer as BufferedTurn[]) : [];
  return CaptureBuffer.fromJSON(items);
}

async function saveBuffer(buffer: CaptureBuffer): Promise<void> {
  await chrome.storage.session.set({ synapseBuffer: buffer.toJSON() });
}

async function updateBadge(buffer: CaptureBuffer): Promise<void> {
  chrome.action.setBadgeText({ text: buffer.size > 0 ? String(buffer.size) : "" });
  await Promise.resolve();
}

async function postCapture(port: number, token: string, host: string, turns: BufferedTurn[]): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-synapse-ingest-token": token },
      body: JSON.stringify({ host, messages: turns.map((t) => ({ role: t.role, content: t.content, ts: t.ts })) }),
    });
    return res.ok;
  } catch {
    return false; // daemon unreachable
  }
}

async function flush(): Promise<void> {
  const { token, port } = await getConfig();
  if (!token) return; // not configured → opt-out
  const buffer = await loadBuffer();
  if (buffer.size === 0) return;

  const turns = buffer.drain();
  const byHost = new Map<string, BufferedTurn[]>();
  for (const t of turns) {
    const list = byHost.get(t.host) ?? [];
    list.push(t);
    byHost.set(t.host, list);
  }

  const failed: BufferedTurn[] = [];
  for (const [host, hostTurns] of byHost) {
    const ok = await postCapture(port, token, host, hostTurns);
    if (!ok) failed.push(...hostTurns);
  }

  const next = CaptureBuffer.fromJSON(failed); // re-buffer only what failed
  await saveBuffer(next);
  await updateBadge(next);
}

async function heartbeat(host: string): Promise<void> {
  const { token, port } = await getConfig();
  if (!token) return;
  try {
    await fetch(`http://127.0.0.1:${port}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-synapse-ingest-token": token },
      body: JSON.stringify({ host }),
    });
  } catch {
    /* daemon unreachable — heartbeats are best-effort */
  }
}

async function handleTurn(turn: BufferedTurn): Promise<void> {
  const buffer = await loadBuffer();
  buffer.add(turn);
  await saveBuffer(buffer);
  await flush();
}

chrome.runtime.onMessage.addListener((message) => {
  const m = message as RelayMessage;
  if (!m || m.__synapse !== true || typeof m.host !== "string") return;
  if (m.kind === "heartbeat") {
    void heartbeat(m.host);
    return;
  }
  if (m.kind === "turn" && typeof m.content === "string") {
    void handleTurn({
      host: m.host,
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
      ts: new Date().toISOString(),
    });
  }
});
