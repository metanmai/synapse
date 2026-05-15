<script lang="ts">
  import { enhance } from "$app/forms";

  let { apiKey, error } = $props<{ apiKey?: string | null; error?: string | null }>();
</script>

<div class="p-4 rounded-xl"
  style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
  <h3 class="font-medium mb-2">API Key</h3>
  <p class="text-sm mb-3" style="color: var(--color-text-muted);">
    Use this key to connect Claude, ChatGPT, or other AI tools.
  </p>
  {#if apiKey}
    <div class="rounded-lg p-3 font-mono text-sm break-all mb-3"
      style="background-color: var(--color-bg-muted);">
      {apiKey}
    </div>
  {:else}
    <div class="rounded-lg p-3 font-mono text-sm mb-3"
      style="background-color: var(--color-bg-muted); color: var(--color-text-muted);">
      ••••••••••••••••
    </div>
  {/if}
  <form method="POST" action="?/regenerateKey" use:enhance>
    <button type="submit" class="rounded-lg px-3 py-2 text-sm cursor-pointer"
      style="border: 1px solid var(--color-border);">
      {apiKey ? "Regenerate" : "Generate API Key"}
    </button>
  </form>
  {#if apiKey}
    <p class="text-xs mt-2" style="color: var(--color-link);">
      Save this key now — it won't be shown again.
    </p>
  {/if}
  {#if error}
    <p class="text-xs mt-2" style="color: var(--color-danger);">{error}</p>
  {/if}
</div>
