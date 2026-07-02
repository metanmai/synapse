// Service worker. Receives relayed turns/heartbeats, buffers turns in
// chrome.storage.session (survives ~30s MV3 eviction), and POSTs to the local
// daemon ingest with the shared-secret token. Daemon-down → turns stay buffered
// (cap + drop-oldest in CaptureBuffer); badge shows the backlog.

import { scrubSecretValues } from "@synapse/shared/redact.js";
import { API_URL } from "../config.js";
import { type BufferedTurn, CaptureBuffer } from "./buffer.js";

const DEFAULT_PORT = 7726;

interface RelayMessage {
  __synapse?: boolean;
  kind?: string;
  host?: string;
  role?: string;
  content?: string;
  eventNames?: string[];
  byteLength?: number;
  sampleHash?: string;
}

async function getConfig(): Promise<{ token?: string; port: number; captureToken?: string }> {
  const data = await chrome.storage.local.get(["synapseToken", "synapsePort", "synapseCaptureToken"]);
  return {
    token: typeof data.synapseToken === "string" ? data.synapseToken : undefined,
    port: typeof data.synapsePort === "number" ? data.synapsePort : DEFAULT_PORT,
    captureToken:
      typeof data.synapseCaptureToken === "string" && data.synapseCaptureToken ? data.synapseCaptureToken : undefined,
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

export async function postCapture(port: number, token: string, host: string, turns: BufferedTurn[]): Promise<boolean> {
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

/**
 * Slice C: direct-to-backend ingest. POSTs the capture-scoped key to /api/capture/browser.
 * Content is scrubbed CLIENT-SIDE here (defense-in-depth — the backend scrubs again) so a
 * secret never transits the wire. Backend-down → returns false → the worker falls back to
 * the local daemon (if configured), else the turns stay buffered.
 */
export async function postCaptureToBackend(
  captureToken: string,
  host: string,
  turns: BufferedTurn[],
): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/capture/browser`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${captureToken}` },
      body: JSON.stringify({
        host,
        messages: turns.map((t) => ({ role: t.role, content: scrubSecretValues(t.content), ts: t.ts })),
      }),
    });
    return res.ok;
  } catch {
    return false; // backend unreachable
  }
}

export async function postDrift(
  port: number,
  token: string,
  payload: { host: string; eventNames: string[]; byteLength: number; sampleHash: string },
): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/drift`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-synapse-ingest-token": token },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false; // daemon unreachable
  }
}

async function handleDrift(payload: {
  host: string;
  eventNames: string[];
  byteLength: number;
  sampleHash: string;
}): Promise<void> {
  const { token, port } = await getConfig();
  if (!token) return;
  await postDrift(port, token, payload);
}

async function flush(): Promise<void> {
  const { token, port, captureToken } = await getConfig();
  if (!captureToken && !token) return; // neither backend nor daemon configured → opt-out
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
    // Slice C: backend-direct first (capture token), the local daemon as the fallback.
    let ok = false;
    if (captureToken) ok = await postCaptureToBackend(captureToken, host, hostTurns);
    if (!ok && token) ok = await postCapture(port, token, host, hostTurns);
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

export async function handleTurn(turn: BufferedTurn): Promise<void> {
  const buffer = await loadBuffer();
  buffer.add(turn);
  await saveBuffer(buffer);
  await flush();
}

/** Register the relay→worker message listener. Called at load in the worker; tests call it after stubbing chrome. */
export function installWorker(): void {
  chrome.runtime.onMessage.addListener((message) => {
    const m = message as RelayMessage;
    if (!m || m.__synapse !== true || typeof m.host !== "string") return;
    if (m.kind === "heartbeat") {
      void heartbeat(m.host);
      return;
    }
    if (m.kind === "drift") {
      void handleDrift({
        host: m.host,
        eventNames: Array.isArray(m.eventNames) ? m.eventNames : [],
        byteLength: typeof m.byteLength === "number" ? m.byteLength : 0,
        sampleHash: typeof m.sampleHash === "string" ? m.sampleHash : "",
      });
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
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) installWorker();
