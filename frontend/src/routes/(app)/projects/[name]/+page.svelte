<script lang="ts">
  import FolderTree from "$lib/components/workspace/FolderTree.svelte";
  import EntryViewer from "$lib/components/workspace/EntryViewer.svelte";
  import EntryEditor from "$lib/components/workspace/EntryEditor.svelte";
  import PathActivityPanel from "$lib/components/workspace/PathActivityPanel.svelte";
  import PathSharePanel from "$lib/components/workspace/PathSharePanel.svelte";
  import PassphrasePrompt from "$lib/components/PassphrasePrompt.svelte";
  import { hasPassphrase, isEncrypted, decrypt, encrypt } from "$lib/crypto";
  import type { Entry } from "$lib/types";

  let { data, form } = $props();
  let needsPassphrase = $state(false);

  let mode = $state<"view" | "edit" | "new" | "activity" | "share" | "empty">("empty");
  let selectedPath = $state<string | null>(null);
  let entry = $state<Entry | null>(null);
  let loading = $state(false);

  // Context menu state
  let contextPath = $state<string | null>(null);
  let contextIsFolder = $state(false);

  // Client-side entry cache
  const entryCache = new Map<string, Entry>();

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
    mode = "view";

    // Return cached entry instantly if available
    const cached = entryCache.get(path);
    if (cached) {
      entry = cached;
      return;
    }

    loading = true;
    try {
      const res = await fetch(`/projects/${encodeURIComponent(data.project.name)}/api/entry?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const fetched: Entry = await res.json();
        // Decrypt content if encrypted
        if (isEncrypted(fetched.content)) {
          if (!hasPassphrase()) {
            needsPassphrase = true;
            loading = false;
            return;
          }
          fetched.content = await decrypt(fetched.content, data.user.email);
        }
        entryCache.set(path, fetched);
        entry = fetched;
      } else {
        entry = null;
      }
    } catch {
      entry = null;
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

{#if needsPassphrase}
  <PassphrasePrompt onUnlock={() => {
    needsPassphrase = false;
    entryCache.clear();
    if (selectedPath) selectEntry(selectedPath);
  }} />
{/if}

<div class="flex h-full" style={dragging ? "user-select: none; cursor: col-resize;" : ""}>
  <!-- File tree sidebar -->
  <div class="p-2 overflow-y-auto shrink-0"
    style="width: {sidebarWidth}px; border-right: 1px solid var(--color-border); background-color: var(--color-bg-raised);">
    <div class="flex items-center justify-between mb-2 px-1">
      <span class="font-medium uppercase tracking-wide"
        style="color: var(--color-text-muted); font-size: 10px;">Files</span>
      <button onclick={() => startNew()}
        class="cursor-pointer" style="color: var(--color-link); font-size: 10px;">+ New</button>
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
