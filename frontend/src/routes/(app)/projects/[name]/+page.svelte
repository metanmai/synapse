<script lang="ts">
  import FolderTree from "$lib/components/workspace/FolderTree.svelte";
  import EntryViewer from "$lib/components/workspace/EntryViewer.svelte";
  import EntryEditor from "$lib/components/workspace/EntryEditor.svelte";
  import SearchPanel from "$lib/components/workspace/SearchPanel.svelte";
  import type { Entry } from "$lib/types";

  let { data, form } = $props();

  let mode = $state<"view" | "edit" | "new" | "search" | "empty">("empty");
  let selectedPath = $state<string | null>(null);
  let entry = $state<Entry | null>(null);
  let searchQuery = $state("");
  let searchResults = $state<Entry[]>([]);
  let loading = $state(false);

  async function selectEntry(path: string) {
    selectedPath = path;
    loading = true;
    mode = "view";
    try {
      const res = await fetch(`/projects/${encodeURIComponent(data.project.name)}/api/entry?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        entry = await res.json();
      } else {
        entry = null;
      }
    } catch {
      entry = null;
    }
    loading = false;
  }

  async function doSearch() {
    if (searchQuery.length < 2) return;
    loading = true;
    mode = "search";
    try {
      const res = await fetch(`/projects/${encodeURIComponent(data.project.name)}/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) {
        searchResults = await res.json();
      }
    } catch {
      searchResults = [];
    }
    loading = false;
  }

  function startNew() {
    mode = "new";
    entry = null;
    selectedPath = null;
  }

  function startEdit() {
    mode = "edit";
  }

  function startSearch() {
    mode = "search";
    searchResults = [];
  }

  function handleSearchSelect(path: string) {
    selectEntry(path);
  }

  function handleSaved() {
    // Reload entry after save
    if (selectedPath) selectEntry(selectedPath);
  }
</script>

<div class="flex h-full">
  <!-- File tree sidebar -->
  <div class="w-64 p-3 overflow-y-auto"
    style="border-right: 1px solid var(--color-border); background-color: var(--color-bg-raised);">
    <div class="flex items-center justify-between mb-3">
      <span class="text-xs font-medium uppercase tracking-wide"
        style="color: var(--color-text-muted);">Files</span>
      <div class="flex gap-2">
        <button onclick={() => startSearch()}
          class="text-xs cursor-pointer" style="color: var(--color-text-muted);">Search</button>
        <button onclick={() => startNew()}
          class="text-xs cursor-pointer" style="color: var(--color-accent);">+ New</button>
      </div>
    </div>
    <FolderTree entries={data.entries} {selectedPath}
      projectName={data.project.name} onSelect={selectEntry} />
  </div>

  <!-- Main content -->
  <div class="flex-1 p-6 overflow-y-auto">
    {#if loading}
      <div class="text-center mt-20" style="color: var(--color-text-muted);">Loading...</div>
    {:else if mode === "search"}
      <div class="space-y-3">
        <form onsubmit={(e) => { e.preventDefault(); doSearch(); }} class="flex gap-2">
          <input type="text" placeholder="Search context..." autofocus
            bind:value={searchQuery}
            class="flex-1 rounded-lg px-3 py-2.5 text-sm"
            style="border: 1px solid var(--color-border);"
          />
          <button type="submit"
            class="rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer"
            style="background-color: var(--color-accent);">
            Search
          </button>
        </form>
        {#each searchResults as result}
          <button onclick={() => handleSearchSelect(result.path)}
            class="block w-full text-left rounded-xl p-3 text-sm cursor-pointer"
            style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
            <div class="font-medium">{result.path}</div>
            <div class="text-xs mt-1 line-clamp-2" style="color: var(--color-text-muted);">
              {result.content.slice(0, 150)}
            </div>
          </button>
        {/each}
        {#if searchResults.length === 0 && searchQuery.length > 1}
          <p class="text-sm" style="color: var(--color-text-muted);">No results found</p>
        {/if}
      </div>
    {:else if mode === "new"}
      <EntryEditor projectName={data.project.name} isNew />
    {:else if mode === "edit" && entry}
      <EntryEditor {entry} projectName={data.project.name} />
    {:else if mode === "view" && entry}
      <EntryViewer {entry} projectName={data.project.name} onEdit={startEdit} />
    {:else}
      <div class="text-center mt-20" style="color: var(--color-text-muted);">
        Select a file or create a new one
      </div>
    {/if}

    {#if form?.error}
      <p class="mt-4 text-sm" style="color: var(--color-danger);">{form.error}</p>
    {/if}
  </div>
</div>
