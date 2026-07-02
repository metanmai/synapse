<script lang="ts">
import type { Entry, EntryListItem } from "$lib/types";

let {
  entries,
  selectedPath,
  projectName,
  onSelect,
  onAction,
  onNewInFolder,
  canEdit = true,
} = $props<{
  entries: EntryListItem[];
  selectedPath: string | null;
  projectName: string;
  onSelect: (path: string) => void;
  onAction: (action: "activity" | "share" | "delete" | "export", path: string, isFolder: boolean) => void;
  onNewInFolder?: (folderPath: string) => void;
  canEdit?: boolean;
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
    const menuHeight = 140; // approximate max menu height
    const spaceBelow = window.innerHeight - rect.bottom;
    const y = spaceBelow < menuHeight ? rect.top - menuHeight : rect.bottom + 4;
    menuPos = { x: rect.left, y };
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
  <div onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === 'Escape') menuOpen = null; }}
    role="menu"
    tabindex="-1"
    class="fixed rounded-lg shadow-lg py-1 context-menu"
    style="left: {menuPos.x}px; top: {menuPos.y}px;">
    <button role="menuitem" onclick={() => handleAction("activity", menuOpen!, menuPathIsFolder(menuOpen!))}
      class="menu-item block w-full text-left px-3 py-1.5 cursor-pointer">
      Activity
    </button>
    <button role="menuitem" onclick={() => handleAction("share", menuOpen!, menuPathIsFolder(menuOpen!))}
      class="menu-item block w-full text-left px-3 py-1.5 cursor-pointer">
      Share
    </button>
    <a role="menuitem" href={`/projects/${encodeURIComponent(projectName)}/api/export`}
      download
      class="menu-item menu-link block w-full text-left px-3 py-1.5 cursor-pointer"
      onclick={() => { menuOpen = null; }}>
      Export
    </a>
    {#if canEdit && menuOpen && menuPathIsFile(menuOpen)}
      <button role="menuitem" onclick={() => handleAction("delete", menuOpen!, false)}
        class="menu-item-danger block w-full text-left px-3 py-1.5 cursor-pointer">
        Delete
      </button>
    {/if}
  </div>
{/if}

{#snippet fileRow(filePath: string, fileName: string, depth: number)}
  {@const isSelected = selectedPath === filePath}
  <div class="tree-row group flex items-center gap-1 cursor-pointer"
    class:tree-row-selected={isSelected}
    role="treeitem"
    tabindex="0"
    aria-selected={isSelected}
    onclick={() => onSelect(filePath)}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(filePath); } }}
    style="--depth: {depth};"
  >
    <span class="flex-1 min-w-0 truncate">{fileName}</span>
    <button onclick={(e) => { e.stopPropagation(); toggleMenu(e, filePath); }}
      aria-label="Actions for {fileName}"
      class="tree-action-btn opacity-0 group-hover:opacity-100 shrink-0 px-0.5 rounded cursor-pointer"
      style="color: {isSelected ? 'var(--color-pink-dark)' : 'var(--color-text-muted)'};"
    >...</button>
  </div>
{/snippet}

{#snippet folder(node: TreeNode, depth: number)}
  {#each Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name)) as child}
    <div class="tree-row tree-row-folder group flex items-center gap-1 cursor-pointer"
      role="treeitem"
      tabindex="0"
      aria-selected={false}
      aria-expanded={expanded.has(child.path)}
      onclick={() => toggle(child.path)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(child.path); } else if (e.key === 'ArrowRight' && !expanded.has(child.path)) { e.preventDefault(); toggle(child.path); } else if (e.key === 'ArrowLeft' && expanded.has(child.path)) { e.preventDefault(); toggle(child.path); } }}
      style="--depth: {depth};">
      <span class="folder-icon opacity-60 shrink-0" aria-hidden="true">{expanded.has(child.path) ? "▼" : "▶"}</span>
      <span class="folder-name flex-1 min-w-0 truncate">{child.name}</span>
      <button onclick={(e) => { e.stopPropagation(); onNewInFolder?.(child.path); }}
        aria-label="New file in {child.name}"
        class="new-file-btn opacity-0 group-hover:opacity-100 shrink-0 rounded cursor-pointer"
        title="New file in {child.name}"
      >+</button>
      <button onclick={(e) => { e.stopPropagation(); toggleMenu(e, child.path); }}
        aria-label="Actions for {child.name}"
        class="tree-action-btn opacity-0 group-hover:opacity-100 shrink-0 px-0.5 rounded cursor-pointer"
      >...</button>
    </div>
    {#if expanded.has(child.path)}
      <div role="group">
        {@render folder(child, depth + 1)}
        {#each child.files.sort((a, b) => a.name.localeCompare(b.name)) as file}
          {@render fileRow(file.path, file.name, depth + 1)}
        {/each}
      </div>
    {/if}
  {/each}
{/snippet}

<div role="tree" aria-label="File tree">
  <!-- Search bar -->
  <div class="mb-2 px-1">
    <label for="folder-tree-search" class="sr-only">Search files</label>
    <input id="folder-tree-search" type="text" placeholder="Search files..." bind:value={searchQuery}
      oninput={onSearchInput}
      class="w-full rounded-md px-2 py-1.5 folder-tree-search"
    />
    <p class="search-hint">
      Semantic search — finds by meaning
    </p>
  </div>

  {#if searchLoading}
    <div class="flex items-center gap-2 px-2 py-1">
      <div class="spinner search-spinner"></div>
      <span class="search-status-text">Searching...</span>
    </div>
  {:else if searchResults !== null}
    <!-- Semantic search results -->
    {#if searchResults.length === 0}
      <p class="search-status-text px-2 py-1">No matches</p>
    {:else}
      {#each searchResults as result}
        {@const isResultSelected = selectedPath === result.path}
        <div class="search-result cursor-pointer"
          class:search-result-selected={isResultSelected}
          role="treeitem"
          tabindex="0"
          aria-selected={isResultSelected}
          onclick={() => onSelect(result.path)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(result.path); } }}
        >
          <div class="search-result-path truncate"
            class:search-result-path-selected={isResultSelected}>
            {result.path}
          </div>
          {#if result.content}
            <div class="search-result-preview truncate">
              {result.content.slice(0, 100)}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  {:else}
    <!-- Normal tree view -->
    {@render folder(tree, 0)}
    {#each tree.files.sort((a, b) => a.name.localeCompare(b.name)) as file}
      {@render fileRow(file.path, file.name, 0)}
    {/each}
    {#if entries.length === 0}
      <p class="search-status-text px-1">No entries yet</p>
    {/if}
  {/if}
</div>

<style>
  /* Context menu (dropdown) */
  .context-menu {
    z-index: 9999;
    background-color: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    min-width: 120px;
  }

  .menu-item {
    font-size: 11px;
    color: var(--color-text);
  }

  .menu-item:hover {
    opacity: 0.8;
  }

  .menu-item-danger {
    font-size: 11px;
    color: var(--color-danger);
  }

  .menu-item-danger:hover {
    opacity: 0.8;
  }

  .menu-link {
    text-decoration: none;
  }

  /* Tree rows (shared by file rows and folder rows) */
  .tree-row {
    padding: 6px 8px 6px calc(var(--depth) * 12px + 8px);
    font-size: 12px;
    border-radius: 8px;
    transition: all 150ms ease;
    color: var(--color-text);
    border-left: 3px solid transparent;
  }

  .tree-row:hover {
    background: rgba(86, 28, 36, 0.05);
  }

  .tree-row-selected {
    background: rgba(86, 28, 36, 0.08);
    color: var(--color-pink-dark);
    font-weight: 500;
    border-left: 3px solid var(--color-pink-dark);
  }

  .tree-row-selected:hover {
    background: rgba(86, 28, 36, 0.08);
  }

  /* Folder-specific elements */
  .folder-icon {
    font-size: 10px;
    color: var(--color-accent);
  }

  .folder-name {
    color: var(--color-accent);
    font-size: 12px;
    font-weight: 500;
  }

  .new-file-btn {
    font-size: 14px;
    color: var(--color-text-muted);
    line-height: 1;
    padding: 0 3px;
  }

  .tree-action-btn {
    font-size: 12px;
    color: var(--color-text-muted);
    line-height: 1;
  }

  /* Search input */
  .folder-tree-search {
    font-size: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    outline: none;
  }

  .folder-tree-search:focus {
    border-color: var(--color-pink) !important;
  }

  .search-hint {
    font-size: 10px;
    color: var(--color-text-muted);
    margin-top: 3px;
    padding: 0 2px;
  }

  /* Search status / empty states */
  .search-status-text {
    color: var(--color-text-muted);
    font-size: 12px;
  }

  /* Search results */
  .search-result {
    padding: 6px 8px;
    border-radius: 8px;
    transition: all 150ms ease;
    border-left: 3px solid transparent;
  }

  .search-result:hover {
    background: rgba(86, 28, 36, 0.05);
  }

  .search-result-selected {
    background: rgba(86, 28, 36, 0.08);
    border-left: 3px solid var(--color-pink-dark);
  }

  .search-result-selected:hover {
    background: rgba(86, 28, 36, 0.08);
  }

  .search-result-path {
    font-size: 12px;
    color: var(--color-text);
    font-weight: 400;
  }

  .search-result-path-selected {
    color: var(--color-pink-dark);
    font-weight: 500;
  }

  .search-result-preview {
    font-size: 11px;
    color: var(--color-text-muted);
    margin-top: 2px;
  }

  .search-spinner {
    width: 12px;
    height: 12px;
    border-width: 1.5px;
  }
</style>
