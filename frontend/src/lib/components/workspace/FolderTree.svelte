<script lang="ts">
  import type { EntryListItem } from "$lib/types";

  let { entries, selectedPath, projectName, onSelect, onAction } = $props<{
    entries: EntryListItem[];
    selectedPath: string | null;
    projectName: string;
    onSelect: (path: string) => void;
    onAction: (action: "activity" | "share" | "delete", path: string, isFolder: boolean) => void;
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

  let expanded = $state<Set<string>>(new Set());
  let menuOpen = $state<string | null>(null);

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

  function toggleMenu(e: MouseEvent, path: string) {
    e.stopPropagation();
    menuOpen = menuOpen === path ? null : path;
  }

  function handleAction(action: "activity" | "share" | "delete", path: string, isFolder: boolean) {
    menuOpen = null;
    onAction(action, path, isFolder);
  }

  // Close menu on outside click
  function handleWindowClick() {
    if (menuOpen) menuOpen = null;
  }
</script>

<svelte:window onclick={handleWindowClick} />

{#snippet contextMenu(path: string, isFolder: boolean)}
  <div class="relative inline-block">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <button onclick={(e) => toggleMenu(e, path)}
      class="opacity-0 group-hover:opacity-100 px-1 cursor-pointer rounded"
      style="font-size: 11px; color: var(--color-text-muted); line-height: 1;"
    >...</button>
    {#if menuOpen === path}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div onclick={(e) => e.stopPropagation()}
        class="absolute left-0 top-full mt-1 rounded-lg shadow-lg py-1 z-50"
        style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border); min-width: 120px;">
        <button onclick={() => handleAction("activity", path, isFolder)}
          class="block w-full text-left px-3 py-1.5 cursor-pointer hover:opacity-80"
          style="font-size: 11px; color: var(--color-text);">
          Activity
        </button>
        <button onclick={() => handleAction("share", path, isFolder)}
          class="block w-full text-left px-3 py-1.5 cursor-pointer hover:opacity-80"
          style="font-size: 11px; color: var(--color-text);">
          Share
        </button>
        {#if !isFolder}
          <button onclick={() => handleAction("delete", path, false)}
            class="block w-full text-left px-3 py-1.5 cursor-pointer hover:opacity-80"
            style="font-size: 11px; color: var(--color-danger);">
            Delete
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet folder(node: TreeNode, depth: number)}
  {#each Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name)) as child}
    <div class="group flex items-center" style="padding-left: {depth * 12 + 4}px;">
      <button onclick={() => toggle(child.path)}
        class="flex items-center gap-1 flex-1 min-w-0 text-left py-1 cursor-pointer truncate"
        style="color: var(--color-accent); font-size: 11px; font-weight: 500;">
        <span class="opacity-60 shrink-0" style="font-size: 9px;">{expanded.has(child.path) ? "▼" : "▶"}</span>
        <span class="truncate">{child.name}</span>
      </button>
      {@render contextMenu(child.path, true)}
    </div>
    {#if expanded.has(child.path)}
      {#each child.files.sort((a, b) => a.name.localeCompare(b.name)) as file}
        <div class="group flex items-center" style="padding-left: {(depth + 1) * 12 + 4}px;">
          <button onclick={() => onSelect(file.path)}
            class="flex-1 min-w-0 text-left py-1 rounded truncate cursor-pointer"
            style="font-size: 11px;
              {selectedPath === file.path
                ? `background-color: var(--color-pink-dark); color: white; font-weight: 500;`
                : `color: var(--color-text);`}"
          >
            {file.name}
          </button>
          {@render contextMenu(file.path, false)}
        </div>
      {/each}
      {@render folder(child, depth + 1)}
    {/if}
  {/each}
{/snippet}

<div>
  {#each tree.files.sort((a, b) => a.name.localeCompare(b.name)) as file}
    <div class="group flex items-center px-1">
      <button onclick={() => onSelect(file.path)}
        class="flex-1 min-w-0 text-left py-1 rounded truncate cursor-pointer"
        style="font-size: 11px;
          {selectedPath === file.path
            ? `background-color: var(--color-pink-dark); color: white; font-weight: 500;`
            : `color: var(--color-text);`}"
      >
        {file.name}
      </button>
      {@render contextMenu(file.path, false)}
    </div>
  {/each}
  {@render folder(tree, 0)}
  {#if entries.length === 0}
    <p class="px-1" style="color: var(--color-text-muted); font-size: 11px;">No entries yet</p>
  {/if}
</div>
