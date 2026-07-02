// ISOLATED-world content script. Bridges the MAIN-world hook (which cannot use
// chrome.*) to the service worker. Validates the message is same-window,
// same-origin, and Synapse-tagged before forwarding.

/** Forward a same-window, same-origin, Synapse-tagged message to the worker. */
export function handleRelayMessage(event: MessageEvent): void {
  if (event.source !== window) return;
  if (event.origin !== location.origin) return;
  const data = event.data as { __synapse?: boolean } | null;
  if (!data || data.__synapse !== true) return;
  chrome.runtime.sendMessage(data);
}

export function installRelay(target: EventTarget = window): void {
  target.addEventListener("message", handleRelayMessage as EventListener);
}

if (typeof window !== "undefined") installRelay();
