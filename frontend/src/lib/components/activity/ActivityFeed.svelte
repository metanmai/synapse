<script lang="ts">
import type { ActivityLogEntry } from "$lib/types";
import { getActionLabel } from "./activity-helpers";

let { entries } = $props<{ entries: ActivityLogEntry[] }>();
</script>

<div class="space-y-3">
  {#each entries as entry}
    <div class="p-3 rounded-xl text-sm"
      style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
      <div class="flex items-center gap-2">
        <span class="font-medium">{getActionLabel(entry.action)}</span>
        <span class="text-xs rounded-full px-2 py-0.5"
          style="background-color: var(--color-pink); color: white;">
          {entry.source}
        </span>
        <time class="text-xs ml-auto" datetime={entry.created_at} style="color: var(--color-text-muted);">
          {new Date(entry.created_at).toLocaleString()}
        </time>
      </div>
      {#if entry.target_path}
        <div class="text-xs mt-1 font-mono" style="color: var(--color-text-muted);">
          {entry.target_path}
        </div>
      {/if}
      {#if entry.target_email}
        <div class="text-xs mt-1" style="color: var(--color-text-muted);">
          {entry.target_email}
        </div>
      {/if}
    </div>
  {/each}
  {#if entries.length === 0}
    <p class="text-sm" style="color: var(--color-text-muted);">No activity yet</p>
  {/if}
</div>
