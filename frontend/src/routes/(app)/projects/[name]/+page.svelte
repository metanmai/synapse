<script lang="ts">
  import FolderTree from "$lib/components/workspace/FolderTree.svelte";
  import EntryViewer from "$lib/components/workspace/EntryViewer.svelte";
  import EntryEditor from "$lib/components/workspace/EntryEditor.svelte";
  import PathActivityPanel from "$lib/components/workspace/PathActivityPanel.svelte";
  import PathSharePanel from "$lib/components/workspace/PathSharePanel.svelte";
  import type { Entry } from "$lib/types";

  let { data, form } = $props();

  let mode = $state<"view" | "edit" | "new" | "search" | "activity" | "share" | "empty">("empty");
  let selectedPath = $state<string | null>(null);
  let entry = $state<Entry | null>(null);
  let searchQuery = $state("");
  let searchResults = $state<Entry[]>([]);
  let loading = $state(false);

  // Context menu state
  let contextPath = $state<string | null>(null);
  let contextIsFolder = $state(false);

  // Resizable sidebar
  let sidebarWidth = $state(220);
  let dragging = $state(false);

  function onDragStart(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    const onMove = (e: MouseEvent) => {
      sidebarWidth = Math.min(Math.max(e.clientX, 140), 500);
    };
    const onUp = () => {
      dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

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

  function handleAction(action: "activity" | "share" | "delete", path: string, isFolder: boolean) {
    contextPath = path;
    contextIsFolder = isFolder;
    if (action === "activity") {
      mode = "activity";
    } else if (action === "share") {
      mode = "share";
    } else if (action === "delete") {
      if (confirm(`Delete ${path}?`)) {
        // TODO: wire up delete API
      }
    }
  }

  function closePanel() {
    mode = selectedPath ? "view" : "empty";
    if (selectedPath && mode === "view") selectEntry(selectedPath);
  }
</script>

<div class="flex h-full" style={dragging ? "user-select: none; cursor: col-resize;" : ""}>
  <!-- File tree sidebar -->
  <div class="p-2 overflow-y-auto shrink-0"
    style="width: {sidebarWidth}px; border-right: 1px solid var(--color-border); background-color: var(--color-bg-raised);">
    <div class="flex items-center justify-between mb-2 px-1">
      <span class="font-medium uppercase tracking-wide"
        style="color: var(--color-text-muted); font-size: 10px;">Files</span>
      <div class="flex gap-2">
        <button onclick={() => startSearch()}
          class="cursor-pointer" style="color: var(--color-text-muted); font-size: 10px;">Search</button>
        <button onclick={() => startNew()}
          class="cursor-pointer" style="color: var(--color-link); font-size: 10px;">+ New</button>
      </div>
    </div>
    <FolderTree entries={data.entries} {selectedPath}
      projectName={data.project.name} onSelect={selectEntry} onAction={handleAction} />
  </div>

  <!-- Resize handle -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div onmousedown={onDragStart}
    class="w-1 shrink-0 cursor-col-resize hover:opacity-100 transition-opacity"
    style="background-color: {dragging ? 'var(--color-pink)' : 'transparent'}; opacity: {dragging ? 1 : 0.5};"
    onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-pink)'}
    onmouseleave={(e) => { if (!dragging) e.currentTarget.style.backgroundColor = 'transparent'; }}>
  </div>

  <!-- Main content -->
  <div class="flex-1 p-6 overflow-y-auto min-w-0">
    {#if loading}
      <div class="text-center mt-20" style="color: var(--color-text-muted);">Loading...</div>
    {:else if mode === "activity" && contextPath}
      <PathActivityPanel
        path={contextPath}
        isFolder={contextIsFolder}
        activity={data.activity}
        onClose={closePanel}
      />
    {:else if mode === "share" && contextPath}
      <PathSharePanel
        path={contextPath}
        isFolder={contextIsFolder}
        projectId={data.project.id}
        shareLinks={data.shareLinks}
        onClose={closePanel}
      />
    {:else if mode === "search"}
      <div class="space-y-3">
        <form onsubmit={(e) => { e.preventDefault(); doSearch(); }} class="flex gap-2">
          <input type="text" placeholder="Search context..." autofocus
            bind:value={searchQuery}
            class="flex-1 rounded-lg px-3 py-2.5 text-sm"
            style="border: 1px solid var(--color-border);"
          />
          <button type="submit"
            class="rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
            style="background-color: var(--color-accent); color: white;">
            Search
          </button>
        </form>
        {#each searchResults as result}
          <button onclick={() => selectEntry(result.path)}
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
      <div class="text-center mt-20" style="color: var(--color-text-muted); font-size: 12px;">
        Select a file or create a new one
      </div>
    {/if}

    {#if form?.error}
      <p class="mt-4 text-sm" style="color: var(--color-danger);">{form.error}</p>
    {/if}
  </div>
</div>
