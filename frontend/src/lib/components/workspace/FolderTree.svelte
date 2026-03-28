<script lang="ts">
  import type { EntryListItem } from "$lib/types";

  let { entries, selectedPath, projectName, onSelect } = $props<{
    entries: EntryListItem[];
    selectedPath: string | null;
    projectName: string;
    onSelect: (path: string) => void;
  }>();

  interface TreeNode {
    name: string;
    path: string;
    children: Record<string, TreeNode>;
    files: { name: string; path: string }[];
  }

  function buildTree(items: EntryListItem[]): TreeNode {
    const root: TreeNode = { name: "", path: "", children: {}, files: [] };
    for (const item of items) {
      const parts = item.path.split("/");
      let current = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts[i];
        if (!current.children[dir]) {
          current.children[dir] = {
            name: dir,
            path: parts.slice(0, i + 1).join("/"),
            children: {},
            files: [],
          };
        }
        current = current.children[dir];
      }
      current.files.push({ name: parts[parts.length - 1], path: item.path });
    }
    return root;
  }

  let tree = $derived(buildTree(entries));

  // Track which folders are expanded — default all open
  let expanded = $state<Set<string>>(new Set());

  // Auto-expand all folders when entries change
  $effect(() => {
    const dirs = new Set<string>();
    for (const item of entries) {
      const parts = item.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join("/"));
      }
    }
    expanded = dirs;
  });

  function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expanded = next;
  }
</script>

{#snippet folder(node: TreeNode, depth: number)}
  {#each Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name)) as child}
    <button onclick={() => toggle(child.path)}
      class="flex items-center gap-1 w-full text-left py-1 cursor-pointer truncate"
      style="padding-left: {depth * 12 + 4}px; color: var(--color-accent); font-size: 11px; font-weight: 500;">
      <span class="opacity-60" style="font-size: 9px;">{expanded.has(child.path) ? "▼" : "▶"}</span>
      {child.name}
    </button>
    {#if expanded.has(child.path)}
      {#each child.files.sort((a, b) => a.name.localeCompare(b.name)) as file}
        <button onclick={() => onSelect(file.path)}
          class="block w-full text-left py-1 rounded truncate cursor-pointer"
          style="padding-left: {(depth + 1) * 12 + 4}px; font-size: 11px;
            {selectedPath === file.path
              ? `background-color: var(--color-pink-dark); color: white; font-weight: 500;`
              : `color: var(--color-text);`}"
        >
          {file.name}
        </button>
      {/each}
      {@render folder(child, depth + 1)}
    {/if}
  {/each}
{/snippet}

<div>
  <!-- Root-level files -->
  {#each tree.files.sort((a, b) => a.name.localeCompare(b.name)) as file}
    <button onclick={() => onSelect(file.path)}
      class="block w-full text-left py-1 px-1 rounded truncate cursor-pointer"
      style="font-size: 11px;
        {selectedPath === file.path
          ? `background-color: var(--color-pink-dark); color: white; font-weight: 500;`
          : `color: var(--color-text);`}"
    >
      {file.name}
    </button>
  {/each}
  <!-- Folders -->
  {@render folder(tree, 0)}
  {#if entries.length === 0}
    <p class="px-1" style="color: var(--color-text-muted); font-size: 11px;">No entries yet</p>
  {/if}
</div>
