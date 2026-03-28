<script lang="ts">
import type { ActivityLogEntry } from "$lib/types";

let { path, isFolder, activity, onClose } = $props<{
  path: string;
  isFolder: boolean;
  activity: ActivityLogEntry[];
  onClose: () => void;
}>();

const actionLabels: Record<string, string> = {
  entry_created: "created",
  entry_updated: "updated",
  entry_deleted: "deleted",
  member_added: "added member",
  member_removed: "removed member",
  share_link_created: "shared",
  share_link_revoked: "unshared",
};

let filtered = $derived(
  activity.filter((e) =>
    isFolder ? e.target_path?.startsWith(path + "/") || e.target_path === path : e.target_path === path,
  ),
);
</script>

<div>
  <div class="flex items-center justify-between mb-4">
    <div>
      <h2 class="text-lg font-medium" style="color: var(--color-accent);">Activity</h2>
      <p class="text-xs mt-0.5 font-mono" style="color: var(--color-text-muted);">
        {path}{isFolder ? "/" : ""}
      </p>
    </div>
    <button onclick={onClose} class="text-sm cursor-pointer" style="color: var(--color-text-muted);">
      Close
    </button>
  </div>

  {#if filtered.length === 0}
    <p class="text-sm" style="color: var(--color-text-muted);">No activity for this {isFolder ? "folder" : "file"}</p>
  {:else}
    <div class="space-y-2">
      {#each filtered as entry}
        <div class="p-3 rounded-lg text-xs"
          style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
          <div class="flex items-center gap-2">
            <span class="font-medium" style="font-size: 12px;">{actionLabels[entry.action] ?? entry.action}</span>
            <span class="rounded-full px-2 py-0.5"
              style="background-color: var(--color-pink); color: white; font-size: 10px;">
              {entry.source}
            </span>
            <span class="ml-auto" style="color: var(--color-text-muted);">
              {new Date(entry.created_at).toLocaleString()}
            </span>
          </div>
          {#if entry.target_path && entry.target_path !== path}
            <div class="mt-1 font-mono" style="color: var(--color-text-muted);">
              {entry.target_path}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
