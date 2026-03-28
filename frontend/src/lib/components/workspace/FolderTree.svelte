<script lang="ts">
  import type { EntryListItem } from "$lib/types";

  let { entries, selectedPath, projectName } = $props<{
    entries: EntryListItem[];
    selectedPath: string | null;
    projectName: string;
  }>();

  function buildTree(items: EntryListItem[]) {
    const tree: Record<string, string[]> = {};
    for (const item of items) {
      const parts = item.path.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
      if (!tree[folder]) tree[folder] = [];
      tree[folder].push(item.path);
    }
    return tree;
  }

  let tree = $derived(buildTree(entries));
  let folders = $derived(Object.keys(tree).sort());
</script>

<div class="text-sm">
  {#each folders as folder}
    <div class="mb-3">
      <div class="font-medium text-xs uppercase tracking-wide px-2 mb-1"
        style="color: var(--color-text-muted);">
        {folder}
      </div>
      {#each tree[folder] as path}
        {@const filename = path.split("/").pop()}
        <a href="/projects/{encodeURIComponent(projectName)}?path={encodeURIComponent(path)}"
          class="block w-full text-left px-2 py-1.5 rounded-lg text-sm truncate"
          style={selectedPath === path
            ? `background-color: var(--color-bg-muted); color: var(--color-accent); font-weight: 500;`
            : `color: var(--color-text);`}
        >
          {filename}
        </a>
      {/each}
    </div>
  {/each}
  {#if entries.length === 0}
    <p class="text-xs px-2" style="color: var(--color-text-muted);">No entries yet</p>
  {/if}
</div>
