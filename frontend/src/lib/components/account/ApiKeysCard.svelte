<script lang="ts">
import { enhance } from "$app/forms";

let { keys, newKey, keyError } = $props<{
  keys: {
    id: string;
    label: string;
    expires_at: string | null;
    last_used_at: string | null;
    created_at: string;
  }[];
  newKey?: { id: string; label: string; api_key: string } | null;
  keyError?: string | null;
}>();

let showCreateForm = $state(false);

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}
</script>

<div
  class="p-4 rounded-xl"
  style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);"
>
  <div class="flex items-center justify-between mb-2">
    <h3 class="font-medium" style="color: var(--color-accent);">API Keys</h3>
    <button
      type="button"
      class="rounded-lg px-3 py-1.5 text-sm cursor-pointer"
      style="border: 1px solid var(--color-pink); color: var(--color-pink-dark);"
      onclick={() => (showCreateForm = !showCreateForm)}
    >
      {showCreateForm ? "Cancel" : "Create Key"}
    </button>
  </div>

  <p class="text-sm mb-3" style="color: var(--color-text-muted);">
    Use API keys to connect Claude, ChatGPT, or other AI tools.
  </p>

  {#if keyError}
    <div class="rounded-lg p-3 text-sm mb-3" style="color: var(--color-danger);">
      {keyError}
    </div>
  {/if}

  {#if newKey}
    <div
      class="rounded-lg p-3 mb-3"
      style="background-color: var(--color-bg-muted); border: 1px solid var(--color-border);"
    >
      <p class="text-sm font-medium mb-1" style="color: var(--color-accent);">
        Key created: {newKey.label}
      </p>
      <div class="font-mono text-sm break-all mb-2">{newKey.api_key}</div>
      <p class="text-xs" style="color: var(--color-link);">
        Save this key now — it won't be shown again.
      </p>
    </div>
  {/if}

  {#if showCreateForm}
    <form
      method="POST"
      action="?/createKey"
      use:enhance={() => {
        return async ({ update }) => {
          await update();
          showCreateForm = false;
        };
      }}
      class="rounded-lg p-3 mb-3"
      style="background-color: var(--color-bg-muted); border: 1px solid var(--color-border);"
    >
      <div class="mb-2">
        <label for="key-label" class="block text-sm mb-1" style="color: var(--color-text-muted);"
          >Label</label
        >
        <input
          id="key-label"
          name="label"
          type="text"
          required
          placeholder="e.g. MacBook Pro, CI server"
          class="w-full rounded-lg px-3 py-2 text-sm"
          style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text);"
        />
      </div>
      <div class="mb-3">
        <label for="key-expires" class="block text-sm mb-1" style="color: var(--color-text-muted);"
          >Expires (optional)</label
        >
        <input
          id="key-expires"
          name="expires_at"
          type="datetime-local"
          class="w-full rounded-lg px-3 py-2 text-sm"
          style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text);"
        />
      </div>
      <button
        type="submit"
        class="rounded-lg px-4 py-2 text-sm font-medium cursor-pointer"
        style="background-color: var(--color-pink); color: white; border: none;"
      >
        Create Key
      </button>
    </form>
  {/if}

  {#if keys.length === 0}
    <p class="text-sm" style="color: var(--color-text-muted);">
      No API keys yet. Create one to connect your tools.
    </p>
  {:else}
    <div class="space-y-2">
      {#each keys as key (key.id)}
        <div
          class="flex items-center justify-between rounded-lg p-3 text-sm"
          style="background-color: var(--color-bg-muted); {isExpired(key.expires_at)
            ? 'opacity: 0.5;'
            : ''}"
        >
          <div class="flex-1 min-w-0">
            <div class="font-medium" style={isExpired(key.expires_at) ? 'text-decoration: line-through;' : ''}>
              {key.label}
            </div>
            <div class="text-xs mt-0.5" style="color: var(--color-text-muted);">
              Created {formatDate(key.created_at)} · Last used {formatDate(key.last_used_at)}
              {#if key.expires_at}
                · {isExpired(key.expires_at) ? "Expired" : `Expires ${formatDate(key.expires_at)}`}
              {/if}
            </div>
          </div>
          <form method="POST" action="?/revokeKey" use:enhance>
            <input type="hidden" name="keyId" value={key.id} />
            <button
              type="submit"
              class="rounded px-2 py-1 text-xs cursor-pointer ml-3"
              style="border: 1px solid var(--color-danger); color: var(--color-danger);"
            >
              Revoke
            </button>
          </form>
        </div>
      {/each}
    </div>
  {/if}
</div>
