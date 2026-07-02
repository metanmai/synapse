// Options page: stores the loopback ingest token + port (printed by the wizard)
// in chrome.storage.local, where the service worker reads them.

const tokenInput = document.getElementById("token") as HTMLInputElement | null;
const portInput = document.getElementById("port") as HTMLInputElement | null;
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save");

async function load(): Promise<void> {
  const data = await chrome.storage.local.get(["synapseToken", "synapsePort"]);
  if (tokenInput && typeof data.synapseToken === "string") tokenInput.value = data.synapseToken;
  if (portInput) portInput.value = String(typeof data.synapsePort === "number" ? data.synapsePort : 7726);
}

saveBtn?.addEventListener("click", () => {
  if (!tokenInput || !portInput) return;
  void chrome.storage.local
    .set({
      synapseToken: tokenInput.value.trim(),
      synapsePort: Number.parseInt(portInput.value, 10) || 7726,
    })
    .then(() => {
      if (statusEl) statusEl.textContent = "Saved.";
    });
});

void load();
