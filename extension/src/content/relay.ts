// ISOLATED-world content script. Bridges the MAIN-world hook (which cannot use
// chrome.*) to the service worker. Validates the message is same-window,
// same-origin, and Synapse-tagged before forwarding.

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.origin !== location.origin) return;
  const data = event.data as { __synapse?: boolean } | null;
  if (!data || data.__synapse !== true) return;
  chrome.runtime.sendMessage(data);
});
