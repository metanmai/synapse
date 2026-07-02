// MAIN-world content script (Chrome 111+). Runs in the page's JS context at
// document_start so it patches window.fetch BEFORE the app captures its own
// reference (the spike confirmed a late hook loses that race). Captures
// conversation turns and posts them to the ISOLATED relay via window.postMessage
// (MAIN world cannot use chrome.runtime). Reads conversation data only.

import { adapterForHost } from "./registry.js";

(() => {
  const adapter = adapterForHost(location.host);
  if (!adapter) return;

  const post = (kind: string, payload: Record<string, unknown> = {}): void => {
    window.postMessage({ __synapse: true, kind, host: location.host, ...payload }, location.origin);
  };

  // Page-visit heartbeat (R2): "this CAPTURE_HOST tab is active" — independent
  // of any extraction, so a silently-broken adapter is still detectable.
  const pingIfVisible = (): void => {
    if (document.visibilityState === "visible") post("heartbeat");
  };
  pingIfVisible();
  setInterval(pingIfVisible, 60_000);

  const origFetch = window.fetch.bind(window);

  const readAll = async (resp: Response): Promise<string> => {
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
  };

  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
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
        });
      }
    } catch {
      /* capture must never break the page */
    }
    return res;
  };
})();
