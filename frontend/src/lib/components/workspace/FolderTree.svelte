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
  let menuPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

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
    if (menuOpen === path) {
      menuOpen = null;
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      menuPos = { x: rect.left, y: rect.bottom + 4 };
      menuOpen = path;
    }
  }

  function handleAction(action: "activity" | "share" | "delete", path: string, isFolder: boolean) {
    menuOpen = null;
    onAction(action, path, isFolder);
  }

  function handleWindowClick() {
    if (menuOpen) menuOpen = null;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<!-- Fixed-position dropdown menu -->
{#if menuOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div onclick={(e) => e.stopPropagation()}
    class="fixed rounded-lg shadow-lg py-1"
    style="left: {menuPos.x}px; top: {menuPos.y}px; z-index: 9999;
      background-color: var(--color-bg-raised); border: 1px solid var(--color-border); min-width: 120px;">
    <button onclick={() => handleAction("activity", menuOpen!, menuOpen!.indexOf(".") === -1 && entries.some(e => e.path.startsWith(menuOpen! + "/")))}
      class="block w-full text-left px-3 py-1.5 cursor-pointer hover:opacity-80"
      style="font-size: 11px; color: var(--color-text);">
      Activity
    </button>
    <button onclick={() => handleAction("share", menuOpen!, menuOpen!.indexOf(".") === -1 && entries.some(e => e.path.startsWith(menuOpen! + "/")))}
      class="block w-full text-left px-3 py-1.5 cursor-pointer hover:opacity-80"
      style="font-size: 11px; color: var(--color-text);">
      Share
    </button>
    {#if entries.some(e => e.path === menuOpen)}
      <button onclick={() => handleAction("delete", menuOpen!, false)}
        class="block w-full text-left px-3 py-1.5 cursor-pointer hover:opacity-80"
        style="font-size: 11px; color: var(--color-danger);">
        Delete
      </button>
    {/if}
  </div>
{/if}

{#snippet fileRow(filePath: string, fileName: string, depth: number)}
  {@const isSelected = selectedPath === filePath}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="group flex items-center gap-1 rounded-md cursor-pointer"
    onclick={() => onSelect(filePath)}
    style="padding: 3px 6px 3px {depth * 12 + 6}px; font-size: 11px;
      {isSelected
        ? `background-color: var(--color-pink-dark); color: white; font-weight: 500;`
        : `color: var(--color-text);`}"
  >
    <span class="flex-1 min-w-0 truncate">{fileName}</span>
    <button onclick={(e) => { e.stopPropagation(); toggleMenu(e, filePath); }}
      class="opacity-0 group-hover:opacity-100 shrink-0 px-0.5 rounded cursor-pointer"
      style="font-size: 11px; color: {isSelected ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)'}; line-height: 1;"
    >...</button>
  </div>
{/snippet}

{#snippet folder(node: TreeNode, depth: number)}
  {#each Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name)) as child}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="group flex items-center gap-1 rounded-md cursor-pointer"
      onclick={() => toggle(child.path)}
      style="padding: 3px 6px 3px {depth * 12 + 6}px;">
      <span class="opacity-60 shrink-0" style="font-size: 9px; color: var(--color-accent);">{expanded.has(child.path) ? "▼" : "▶"}</span>
      <span class="flex-1 min-w-0 truncate" style="color: var(--color-accent); font-size: 11px; font-weight: 500;">{child.name}</span>
      <button onclick={(e) => { e.stopPropagation(); toggleMenu(e, child.path); }}
        class="opacity-0 group-hover:opacity-100 shrink-0 px-0.5 rounded cursor-pointer"
        style="font-size: 11px; color: var(--color-text-muted); line-height: 1;"
      >...</button>
    </div>
    {#if expanded.has(child.path)}
      {#each child.files.sort((a, b) => a.name.localeCompare(b.name)) as file}
        {@render fileRow(file.path, file.name, depth + 1)}
      {/each}
      {@render folder(child, depth + 1)}
    {/if}
  {/each}
{/snippet}

<div>
  {#each tree.files.sort((a, b) => a.name.localeCompare(b.name)) as file}
    {@render fileRow(file.path, file.name, 0)}
  {/each}
  {@render folder(tree, 0)}
  {#if entries.length === 0}
    <p class="px-1" style="color: var(--color-text-muted); font-size: 11px;">No entries yet</p>
  {/if}
</div>
