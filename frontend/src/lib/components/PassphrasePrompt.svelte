<script lang="ts">
import { setPassphrase } from "$lib/crypto";

let { onUnlock } = $props<{ onUnlock: () => void }>();
let value = $state("");
let isNew = $state(false);
let confirm = $state("");
let error = $state("");

function submit() {
  if (!value) return;
  if (isNew && value !== confirm) {
    error = "Passphrases don't match";
    return;
  }
  setPassphrase(value);
  onUnlock();
}
</script>

<div class="fixed inset-0 flex items-center justify-center z-50"
  style="background-color: rgba(0,0,0,0.5);">
  <div class="w-full max-w-sm p-6 rounded-xl"
    style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
    <div class="flex items-center gap-3 mb-4">
      <img src="/logo.svg" alt="Synapse logo" class="w-8 h-8" />
      <h2 class="text-lg font-semibold" style="color: var(--color-accent);">
        {isNew ? "Set Encryption Passphrase" : "Unlock Workspace"}
      </h2>
    </div>
    <p class="text-xs mb-4" style="color: var(--color-text-muted);">
      {isNew
        ? "Your content is encrypted end-to-end. Choose a passphrase — if you lose it, your data cannot be recovered."
        : "Enter your passphrase to decrypt your files."}
    </p>
    <form onsubmit={(e) => { e.preventDefault(); submit(); }} class="space-y-3">
      <input type="password" bind:value placeholder="Passphrase" aria-label="Passphrase" required autofocus
        class="w-full rounded-lg px-3 py-2.5 text-sm"
        style="border: 1px solid var(--color-border);"
      />
      {#if isNew}
        <input type="password" bind:value={confirm} placeholder="Confirm passphrase" required
          class="w-full rounded-lg px-3 py-2.5 text-sm"
          style="border: 1px solid var(--color-border);"
        />
      {/if}
      {#if error}
        <p class="text-xs" style="color: var(--color-danger);">{error}</p>
      {/if}
      <button type="submit"
        class="w-full rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
        style="background-color: var(--color-accent); color: white;">
        {isNew ? "Set Passphrase" : "Unlock"}
      </button>
    </form>
    {#if !isNew}
      <button onclick={() => isNew = true}
        class="mt-3 text-xs cursor-pointer" style="color: var(--color-link);">
        First time? Set a new passphrase
      </button>
    {/if}
  </div>
</div>
