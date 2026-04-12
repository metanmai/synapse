<script lang="ts">
import type { Entry, EntryListItem } from "$lib/types";

let { entries, selectedPath, projectName, onSelect, onAction, onNewInFolder } = $props<{
  entries: EntryListItem[];
  selectedPath: string | null;
  projectName: string;
  onSelect: (path: string) => void;
  onAction: (action: "activity" | "share" | "delete" | "export", path: string, isFolder: boolean) => void;
  onNewInFolder?: (folderPath: string) => void;
}>();

let searchQuery = $state("");
let searchResults = $state<Entry[] | null>(null);
let searchLoading = $state(false);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onSearchInput() {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (searchQuery.length < 2) {
    searchResults = null;
    return;
  }
  searchLoading = true;
  debounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(
        `/projects/${encodeURIComponent(projectName)}/api/search?q=${encodeURIComponent(searchQuery)}`,
      );
      if (res.ok) {
        searchResults = await res.json();
      }
    } catch {
      searchResults = [];
    }
    searchLoading = false;
  }, 300);
}

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

let expandedInitialized = false;
let expanded = $state<Set<string>>(new Set());
let menuOpen = $state<string | null>(null);
let menuPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

// Expand all directories on first load only — not on every re-render
$effect(() => {
  if (expandedInitialized) return;
  if (entries.length === 0) return;
  const dirs = new Set<string>();
  for (const item of entries) {
    const parts = item.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  expanded = dirs;
  expandedInitialized = true;
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

function handleAction(action: "activity" | "share" | "delete" | "export", path: string, isFolder: boolean) {
  menuOpen = null;
  onAction(action, path, isFolder);
}

function handleWindowClick() {
  if (menuOpen) menuOpen = null;
}

function menuPathIsFolder(menuPath: string): boolean {
  return menuPath.indexOf(".") === -1 && entries.some((item: EntryListItem) => item.path.startsWith(`${menuPath}/`));
}

function menuPathIsFile(menuPath: string): boolean {
  return entries.some((item: EntryListItem) => item.path === menuPath);
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
    <button onclick={() => handleAction("activity", menuOpen!, menuPathIsFolder(menuOpen!))}
      class="block w-full text-left px-3 py-1.5 cursor-pointer hover:opacity-80"
      style="font-size: 11px; color: var(--color-text);">
      Activity
    </button>
    <button onclick={() => handleAction("share", menuOpen!, menuPathIsFolder(menuOpen!))}
      class="block w-full text-left px-3 py-1.5 cursor-pointer hover:opacity-80"
      style="font-size: 11px; color: var(--color-text);">
      Share
    </button>
    <a href={`/projects/${encodeURIComponent(projectName)}/api/export`}
      download
      class="block w-full text-left px-3 py-1.5 cursor-pointer hover:opacity-80"
      style="font-size: 11px; color: var(--color-text); text-decoration: none;"
      onclick={() => { menuOpen = null; }}>
      Export
    </a>
    {#if menuOpen && menuPathIsFile(menuOpen)}
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
  <div class="group flex items-center gap-1 cursor-pointer"
    onclick={() => onSelect(filePath)}
    style="padding: 6px 8px 6px {depth * 12 + 8}px; font-size: 12px;
      border-radius: 8px; transition: all 150ms ease;
      {isSelected
        ? `background: rgba(86, 28, 36, 0.08); color: var(--color-pink-dark); font-weight: 500; border-left: 3px solid var(--color-pink-dark);`
        : `color: var(--color-text); border-left: 3px solid transparent;`}"
    onmouseenter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(86, 28, 36, 0.05)'; }}
    onmouseleave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
  >
    <span class="flex-1 min-w-0 truncate">{fileName}</span>
    <button onclick={(e) => { e.stopPropagation(); toggleMenu(e, filePath); }}
      class="opacity-0 group-hover:opacity-100 shrink-0 px-0.5 rounded cursor-pointer"
      style="font-size: 12px; color: {isSelected ? 'var(--color-pink-dark)' : 'var(--color-text-muted)'}; line-height: 1;"
    >...</button>
  </div>
{/snippet}

{#snippet folder(node: TreeNode, depth: number)}
  {#each Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name)) as child}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="group flex items-center gap-1 cursor-pointer"
      onclick={() => toggle(child.path)}
      style="padding: 6px 8px 6px {depth * 12 + 8}px; border-radius: 8px; transition: all 150ms ease; border-left: 3px solid transparent;"
      onmouseenter={(e) => { e.currentTarget.style.background = 'rgba(86, 28, 36, 0.05)'; }}
      onmouseleave={(e) => { e.currentTarget.style.background = ''; }}>
      <span class="opacity-60 shrink-0" style="font-size: 10px; color: var(--color-accent);">{expanded.has(child.path) ? "▼" : "▶"}</span>
      <span class="flex-1 min-w-0 truncate" style="color: var(--color-accent); font-size: 12px; font-weight: 500;">{child.name}</span>
      <button onclick={(e) => { e.stopPropagation(); onNewInFolder?.(child.path); }}
        class="opacity-0 group-hover:opacity-100 shrink-0 rounded cursor-pointer"
        style="font-size: 14px; color: var(--color-text-muted); line-height: 1; padding: 0 3px;"
        title="New file in {child.name}"
      >+</button>
      <button onclick={(e) => { e.stopPropagation(); toggleMenu(e, child.path); }}
        class="opacity-0 group-hover:opacity-100 shrink-0 px-0.5 rounded cursor-pointer"
        style="font-size: 12px; color: var(--color-text-muted); line-height: 1;"
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
  <!-- Search bar -->
  <div class="mb-2 px-1">
    <input type="text" placeholder="Search files..." bind:value={searchQuery}
      oninput={onSearchInput}
      class="w-full rounded-md px-2 py-1.5"
      style="font-size: 12px; border: 1px solid var(--color-border); background: var(--color-bg);
        outline: none;"
      onfocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-pink)')}
      onblur={(e) => (e.currentTarget.style.borderColor = 'var(--color-border)')}
    />
    <p style="font-size: 10px; color: var(--color-text-muted); margin-top: 3px; padding: 0 2px;">
      Semantic search — finds by meaning
    </p>
  </div>

  {#if searchLoading}
    <div class="flex items-center gap-2 px-2 py-1">
      <div class="spinner" style="width: 12px; height: 12px; border-width: 1.5px;"></div>
      <span style="color: var(--color-text-muted); font-size: 12px;">Searching...</span>
    </div>
  {:else if searchResults !== null}
    <!-- Semantic search results -->
    {#if searchResults.length === 0}
      <p class="px-2 py-1" style="color: var(--color-text-muted); font-size: 12px;">No matches</p>
    {:else}
      {#each searchResults as result}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="cursor-pointer"
          onclick={() => onSelect(result.path)}
          style="padding: 6px 8px; border-radius: 8px; transition: all 150ms ease;
            {selectedPath === result.path
              ? `background: rgba(86, 28, 36, 0.08); border-left: 3px solid var(--color-pink-dark);`
              : `border-left: 3px solid transparent;`}"
          onmouseenter={(e) => { if (selectedPath !== result.path) e.currentTarget.style.background = 'rgba(86, 28, 36, 0.05)'; }}
          onmouseleave={(e) => { if (selectedPath !== result.path) e.currentTarget.style.background = ''; }}
        >
          <div class="truncate" style="font-size: 12px; color: {selectedPath === result.path ? 'var(--color-pink-dark)' : 'var(--color-text)'}; font-weight: {selectedPath === result.path ? '500' : '400'};">
            {result.path}
          </div>
          {#if result.content}
            <div class="truncate" style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px;">
              {result.content.slice(0, 100)}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  {:else}
    <!-- Normal tree view -->
    {#each tree.files.sort((a, b) => a.name.localeCompare(b.name)) as file}
      {@render fileRow(file.path, file.name, 0)}
    {/each}
    {@render folder(tree, 0)}
    {#if entries.length === 0}
      <p class="px-1" style="color: var(--color-text-muted); font-size: 12px;">No entries yet</p>
    {/if}
  {/if}
</div>
