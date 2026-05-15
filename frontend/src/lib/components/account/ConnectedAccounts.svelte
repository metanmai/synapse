<script lang="ts">
import { enhance } from "$app/forms";

let { providers } = $props<{ providers: string[] }>();

const accounts = [
  { provider: "google", label: "Google" },
  { provider: "github", label: "GitHub" },
];
</script>

<div class="glass rounded-xl" style="padding: 2rem;">
  <h3 style="font-size: 18px; font-weight: 700; color: var(--color-accent);" class="mb-3">Connected Accounts</h3>
  <div class="space-y-2">
    {#each accounts as { provider, label }}
      {@const connected = providers.includes(provider)}
      {#if connected}
        <div class="flex items-center justify-between px-4 py-2 rounded-lg"
          style="background: rgba(63, 185, 80, 0.08); border: 1px solid rgba(63, 185, 80, 0.2);">
          <span style="font-size: 14px; color: var(--color-text);">{label}</span>
          <span style="font-size: 12px; color: var(--color-success); font-weight: 500;">Connected</span>
        </div>
      {:else}
        <form method="POST" action="?/connectOAuth" use:enhance>
          <input type="hidden" name="provider" value={provider} />
          <button type="submit" class="btn-secondary w-full text-left cursor-pointer">
            Link {label} Account
          </button>
        </form>
      {/if}
    {/each}
  </div>
</div>
