<script lang="ts">
  import FolderTree from "$lib/components/workspace/FolderTree.svelte";
  import EntryViewer from "$lib/components/workspace/EntryViewer.svelte";
  import EntryEditor from "$lib/components/workspace/EntryEditor.svelte";
  import SearchPanel from "$lib/components/workspace/SearchPanel.svelte";

  let { data, form } = $props();

  let mode = $derived(
    data.query ? "search"
    : data.isNew ? "new"
    : data.edit && data.entry ? "edit"
    : data.entry ? "view"
    : "empty"
  );
</script>

<div class="flex h-full">
  <!-- File tree sidebar -->
  <div class="w-64 p-3 overflow-y-auto"
    style="border-right: 1px solid var(--color-border); background-color: var(--color-bg-raised);">
    <div class="flex items-center justify-between mb-3">
      <span class="text-xs font-medium uppercase tracking-wide"
        style="color: var(--color-text-muted);">Files</span>
      <div class="flex gap-2">
        <a href="/projects/{encodeURIComponent(data.project.name)}?q="
          class="text-xs" style="color: var(--color-text-muted);">Search</a>
        <a href="/projects/{encodeURIComponent(data.project.name)}?new"
          class="text-xs" style="color: var(--color-accent);">+ New</a>
      </div>
    </div>
    <FolderTree entries={data.entries} selectedPath={data.selectedPath}
      projectName={data.project.name} />
  </div>

  <!-- Main content -->
  <div class="flex-1 p-6 overflow-y-auto">
    {#if mode === "search"}
      <SearchPanel results={data.searchResults} query={data.query}
        projectName={data.project.name} />
    {:else if mode === "new"}
      <EntryEditor projectName={data.project.name} isNew />
    {:else if mode === "edit" && data.entry}
      <EntryEditor entry={data.entry} projectName={data.project.name} />
    {:else if mode === "view" && data.entry}
      <EntryViewer entry={data.entry} projectName={data.project.name} />
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
