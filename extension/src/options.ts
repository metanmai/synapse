// Options page. Two ways to connect, both stored in chrome.storage.local where the
// service worker reads them:
//   1. Sign in (chrome.identity) → a capture-scoped token; captures POST directly to the backend.
//   2. Local daemon token + port (fallback) → captures POST to the loopback daemon.

import { getSignedInEmail, signIn, signOut } from "./auth.js";

const tokenInput = document.getElementById("token") as HTMLInputElement | null;
const portInput = document.getElementById("port") as HTMLInputElement | null;
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save");
const signinBtn = document.getElementById("signin");
const signoutBtn = document.getElementById("signout");
const accountEl = document.getElementById("account");

async function renderAccount(): Promise<void> {
  const email = await getSignedInEmail();
  if (accountEl) accountEl.textContent = email ? `Signed in as ${email}` : "Not signed in";
}

async function load(): Promise<void> {
  const data = await chrome.storage.local.get(["synapseToken", "synapsePort"]);
  if (tokenInput && typeof data.synapseToken === "string") tokenInput.value = data.synapseToken;
  if (portInput) portInput.value = String(typeof data.synapsePort === "number" ? data.synapsePort : 7726);
  await renderAccount();
}

// signIn() must run from a user gesture (this click) so launchWebAuthFlow's window is allowed.
signinBtn?.addEventListener("click", () => {
  if (accountEl) accountEl.textContent = "Signing in…";
  void signIn()
    .then(({ email }) => {
      if (accountEl) accountEl.textContent = `Signed in as ${email}`;
    })
    .catch((err) => {
      if (accountEl) accountEl.textContent = `Sign-in failed: ${(err as Error).message}`;
    });
});

signoutBtn?.addEventListener("click", () => {
  void signOut().then(renderAccount);
});

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
