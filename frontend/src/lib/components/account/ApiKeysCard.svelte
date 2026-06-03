<script lang="ts">
import { enhance } from "$app/forms";
import { formatDate, isExpired } from "./account-helpers";

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
let createLoading = $state(false);

// BUG #6: inline-rename state. Tracks which key (if any) is being
// edited + the in-progress label text. Only one key can be in edit
// mode at a time — opening edit on another key cancels the current.
let editingKeyId = $state<string | null>(null);
let editingLabel = $state("");
let renameLoading = $state(false);

// Display name: strip the cli- prefix the backend stores so users see
// "laptop" rather than "cli-laptop" in the rename input. The backend
// re-adds the prefix on save if the existing row had it.
const CLI_PREFIX = "cli-";
function displayLabel(label: string): string {
  return label.startsWith(CLI_PREFIX) ? label.slice(CLI_PREFIX.length) : label;
}

function startEdit(keyId: string, currentLabel: string): void {
  editingKeyId = keyId;
  editingLabel = displayLabel(currentLabel);
}
function cancelEdit(): void {
  editingKeyId = null;
  editingLabel = "";
}
</script>

<div class="glass rounded-xl" style="padding: 2rem;">
  <div class="flex items-center justify-between mb-2">
    <h3 style="font-size: 18px; font-weight: 700; color: var(--color-accent);">API Keys</h3>
    <button
      type="button"
      class="btn-primary cursor-pointer"
      style="font-size: 13px;"
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
      class="glass rounded-lg p-3 mb-3"
      style="background-color: var(--color-bg-muted);"
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
        createLoading = true;
        return async ({ update }) => {
          createLoading = false;
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
          class="w-full text-sm"
          style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text);"
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
          class="w-full text-sm"
          style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text);"
        />
      </div>
      <button type="submit" disabled={createLoading} class="btn-primary cursor-pointer">
        {#if createLoading}
          <span class="flex items-center justify-center gap-2">
            <span class="spinner spinner-sm spinner-white"></span>
            Creating...
          </span>
        {:else}
          Create Key
        {/if}
      </button>
    </form>
  {/if}

  {#if keys.length === 0}
    <p class="text-sm" style="color: var(--color-text-muted);">
      No API keys yet. Create one to connect your tools.
    </p>
  {:else}
    <div class="space-y-1">
      {#each keys as key, i (key.id)}
        <div
          class="flex items-center justify-between text-sm"
          style="border-radius: 8px; padding: 10px 12px; {i % 2 === 0
            ? 'background: rgba(86, 28, 36, 0.02);'
            : ''} {isExpired(key.expires_at) ? 'opacity: 0.5;' : ''}"
        >
          <div class="flex-1 min-w-0">
            {#if editingKeyId === key.id}
              <!-- BUG #6 inline-rename form. Enter submits; Escape (via the
                   Cancel button) bails. Backend handles cli- prefix preservation. -->
              <form
                method="POST"
                action="?/renameKey"
                use:enhance={() => {
                  renameLoading = true;
                  return async ({ update }) => {
                    renameLoading = false;
                    await update();
                    cancelEdit();
                  };
                }}
                class="flex items-center gap-2"
              >
                <input type="hidden" name="keyId" value={key.id} />
                <input
                  name="label"
                  type="text"
                  bind:value={editingLabel}
                  required
                  maxlength="80"
                  class="flex-1 text-sm"
                  aria-label="New label for {displayLabel(key.label)}"
                  style="border-radius: 8px; padding: 6px 10px; background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text);"
                />
                <button
                  type="submit"
                  disabled={renameLoading || !editingLabel.trim()}
                  class="cursor-pointer text-xs font-medium"
                  style="border-radius: 9999px; padding: 4px 12px; background: var(--color-accent); color: white;"
                >
                  Save
                </button>
                <button
                  type="button"
                  onclick={cancelEdit}
                  class="cursor-pointer text-xs"
                  style="color: var(--color-text-muted);"
                >
                  Cancel
                </button>
              </form>
            {:else}
              <div
                class="font-medium"
                style={isExpired(key.expires_at) ? 'text-decoration: line-through;' : ''}
              >
                {displayLabel(key.label)}
              </div>
              <div class="text-xs mt-0.5" style="color: var(--color-text-muted);">
                Created {formatDate(key.created_at)} · Last used {formatDate(key.last_used_at)}
                {#if key.expires_at}
                  · {isExpired(key.expires_at) ? "Expired" : `Expires ${formatDate(key.expires_at)}`}
                {/if}
              </div>
            {/if}
          </div>
          {#if editingKeyId !== key.id}
            <div class="flex items-center gap-2 ml-3">
              <button
                type="button"
                onclick={() => startEdit(key.id, key.label)}
                class="cursor-pointer text-xs font-medium"
                style="border-radius: 9999px; padding: 4px 12px; border: 1px solid var(--color-border); color: var(--color-text-muted); background: transparent;"
                aria-label="Rename {displayLabel(key.label)}"
              >
                Rename
              </button>
              <form method="POST" action="?/revokeKey" use:enhance>
                <input type="hidden" name="keyId" value={key.id} />
                <button
                  type="submit"
                  class="cursor-pointer text-xs font-medium"
                  style="border-radius: 9999px; padding: 4px 12px; border: 1px solid var(--color-danger); color: var(--color-danger); background: transparent;"
                >
                  Revoke
                </button>
              </form>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
