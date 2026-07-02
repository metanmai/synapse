// MAIN-world content script (Chrome 111+). Runs in the page's JS context at
// document_start so it patches window.fetch BEFORE the app captures its own
// reference (the spike confirmed a late hook loses that race). Captures
// conversation turns and posts them to the ISOLATED relay via window.postMessage
// (MAIN world cannot use chrome.runtime). Reads conversation data only.

import type { CaptureAdapter } from "./adapters/types.js";
import { type DriftSentinel, createDriftSentinel } from "./drift-sentinel.js";
import { summarizeShape } from "./drift-shape.js";
import { adapterForHost } from "./registry.js";

export type PostFn = (kind: string, payload?: Record<string, unknown>) => void;

/** Drain a (possibly streaming) response body to a string, non-destructively. */
export async function readAll(resp: Response): Promise<string> {
  if (!resp.body) return resp.text().catch(() => "");
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let acc = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
  }
  return acc;
}

/**
 * Build a fetch wrapper that mirrors the original fetch but, for completion
 * requests, extracts the user + assistant turns and forwards them via `post`.
 * Pure (no globals) so it can be driven directly in tests.
 */
export function makeHookedFetch(
  origFetch: typeof fetch,
  adapter: CaptureAdapter,
  post: PostFn,
  sentinel?: DriftSentinel,
): typeof fetch {
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const input = args[0];
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const init = args[1];
    const reqBody = typeof init?.body === "string" ? init.body : undefined;

    const res = await origFetch(...args);
    try {
      if (url && adapter.matchesCompletion(url)) {
        if (reqBody) {
          try {
            const userTurn = adapter.parseRequest(JSON.parse(reqBody));
            if (userTurn) post("turn", { role: userTurn.role, content: userTurn.content });
          } catch {
            /* non-JSON request body — ignore */
          }
        }
        // Read a CLONE so the page's own response stream is untouched.
        void readAll(res.clone()).then((text) => {
          const turn = adapter.parseResponse(text);
          if (turn) post("turn", { role: turn.role, content: turn.content });
          if (sentinel) {
            const outcome = { matched: true, hadBody: text.trim().length > 0, parsedOk: !!turn };
            if (sentinel.record(adapter.host, outcome) === "drift") {
              post("drift", { ...summarizeShape(text) });
            }
          }
        });
      }
    } catch {
      /* capture must never break the page */
    }
    return res;
  };
}

/** Wire the hook to the live page: pick the adapter, install the heartbeat, and patch window.fetch. */
export function installFetchHook(win: Window = window, loc: Location = location, doc: Document = document): void {
  const adapter = adapterForHost(loc.host);
  if (!adapter) return;

  const post: PostFn = (kind, payload = {}) => {
    win.postMessage({ __synapse: true, kind, host: loc.host, ...payload }, loc.origin);
  };

  // Page-visit heartbeat (R2): "this CAPTURE_HOST tab is active" — independent
  // of any extraction, so a silently-broken adapter is still detectable.
  const pingIfVisible = (): void => {
    if (doc.visibilityState === "visible") post("heartbeat");
  };
  pingIfVisible();
  setInterval(pingIfVisible, 60_000);

  win.fetch = makeHookedFetch(win.fetch.bind(win), adapter, post, createDriftSentinel());
}

if (typeof window !== "undefined") installFetchHook();
