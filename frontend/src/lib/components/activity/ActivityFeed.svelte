<script lang="ts">
import type { ActivityLogEntry } from "$lib/types";

let { entries } = $props<{ entries: ActivityLogEntry[] }>();

const actionLabels: Record<string, string> = {
  entry_created: "created",
  entry_updated: "updated",
  entry_deleted: "deleted",
  member_added: "added member",
  member_removed: "removed member",
  settings_changed: "changed settings",
  share_link_created: "created share link",
  share_link_revoked: "revoked share link",
};
</script>

<div class="space-y-3">
  {#each entries as entry}
    <div class="p-3 rounded-xl text-sm"
      style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
      <div class="flex items-center gap-2">
        <span class="font-medium">{actionLabels[entry.action] ?? entry.action}</span>
        <span class="text-xs rounded-full px-2 py-0.5"
          style="background-color: var(--color-pink); color: white;">
          {entry.source}
        </span>
        <span class="text-xs ml-auto" style="color: var(--color-text-muted);">
          {new Date(entry.created_at).toLocaleString()}
        </span>
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
