<script lang="ts">
  import { enhance } from "$app/forms";
  import type { EntryHistory } from "$lib/types";

  let { versions } = $props<{ versions: EntryHistory[] }>();
</script>

<div class="space-y-3">
  {#each versions as version}
    <div class="p-4 rounded-xl"
      style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs" style="color: var(--color-text-muted);">
          {new Date(version.changed_at).toLocaleString()} ·
          <span class="rounded-full px-2 py-0.5"
            style="background-color: var(--color-bg-muted);">
            {version.source}
          </span>
        </div>
        <form method="POST" action="?/restore" use:enhance>
          <input type="hidden" name="historyId" value={version.id} />
          <button type="submit" class="text-xs cursor-pointer"
            style="color: var(--color-link);">
            Restore this version
          </button>
        </form>
      </div>
      <pre class="text-xs font-mono rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto"
        style="background-color: var(--color-bg-muted); line-height: 1.6;"
      >{version.content}</pre>
    </div>
  {/each}
  {#if versions.length === 0}
    <p class="text-sm" style="color: var(--color-text-muted);">No version history</p>
  {/if}
</div>
