<script lang="ts">
import { enhance } from "$app/forms";
import PassphrasePrompt from "$lib/components/PassphrasePrompt.svelte";
import EntryEditor from "$lib/components/workspace/EntryEditor.svelte";
import EntryViewer from "$lib/components/workspace/EntryViewer.svelte";
import FolderTree from "$lib/components/workspace/FolderTree.svelte";
import PathActivityPanel from "$lib/components/workspace/PathActivityPanel.svelte";
import PathSharePanel from "$lib/components/workspace/PathSharePanel.svelte";
import { decrypt, encrypt, hasPassphrase, isEncrypted } from "$lib/crypto";
import type { Entry } from "$lib/types";

let { data, form } = $props();
const projectSlug: string =
  data.project.role === "owner" ? data.project.name : `${data.project.owner_email}~${data.project.name}`;
const canEdit = data.project.role !== "viewer";
let needsPassphrase = $state(false);
let importInput: HTMLInputElement;
let importForm: HTMLFormElement;

let mode = $state<"view" | "edit" | "new" | "activity" | "share" | "empty">("empty");
let selectedPath = $state<string | null>(null);
let entry = $state<Entry | null>(null);
let loading = $state(false);

// Context menu state
let contextPath = $state<string | null>(null);
let contextIsFolder = $state(false);

// Client-side entry cache — invalidate when entries list changes (project switch, save, etc.)
const entryCache = new Map<string, Entry>();
let prevEntriesRef: typeof data.entries | undefined;
$effect(() => {
  const current = data.entries;
  if (prevEntriesRef !== undefined && current !== prevEntriesRef) {
    entryCache.clear();
  }
  prevEntriesRef = current;
});

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
    const res = await fetch(`/projects/${encodeURIComponent(projectSlug)}/api/entry?path=${encodeURIComponent(path)}`);
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
  } catch (err) {
    console.error("[selectEntry] failed for", path, err);
    entry = null;
  }
  loading = false;
}

let newFolderPrefix = $state("");

function startNew() {
  mode = "new";
  entry = null;
  selectedPath = null;
  newFolderPrefix = "";
}

function startNewInFolder(folderPath: string) {
  mode = "new";
  entry = null;
  selectedPath = null;
  newFolderPrefix = folderPath + "/";
}

function startEdit() {
  mode = "edit";
}

function handleAction(action: "activity" | "share" | "delete" | "export", path: string, isFolder: boolean) {
  contextPath = path;
  contextIsFolder = isFolder;
  if (action === "activity") {
    mode = "activity";
  } else if (action === "share") {
    mode = "share";
  } else if (action === "export") {
    // Export is triggered from FolderTree via `<a download>`; no-op if routed here.
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

<div class="workspace-layout" style={dragging ? "user-select: none; cursor: col-resize;" : ""}>
  <!-- File tree sidebar -->
  <div class="glass p-3 overflow-y-auto file-tree-sidebar"
    style="width: {sidebarWidth}px; border-radius: 0;">
    <div class="flex items-center justify-between mb-2 px-1">
      <span class="font-medium uppercase tracking-wide"
        style="color: var(--color-text-muted); font-size: 10px;">Files</span>
      {#if canEdit}
        <div class="flex items-center gap-2">
          <button onclick={() => startNew()}
            aria-label="New file"
            class="cursor-pointer"
            style="font-size: 14px; width: 24px; height: 24px; border-radius: 6px; border: none; background: transparent; color: var(--color-text-muted); cursor: pointer; transition: all 150ms ease; display: flex; align-items: center; justify-content: center; line-height: 1;"
            onmouseenter={(e) => (e.currentTarget.style.background = 'rgba(86, 28, 36, 0.08)')}
            onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
            title="New file">+</button>
          <button onclick={() => importInput?.click()}
            aria-label="Import zip"
            class="cursor-pointer"
            style="font-size: 12px; width: 24px; height: 24px; border-radius: 6px; border: none; background: transparent; color: var(--color-text-muted); cursor: pointer; transition: all 150ms ease; display: flex; align-items: center; justify-content: center; line-height: 1;"
            onmouseenter={(e) => (e.currentTarget.style.background = 'rgba(86, 28, 36, 0.08)')}
            onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
            title="Import zip">↑</button>
        </div>
      {/if}
    </div>
    <FolderTree entries={data.entries} {selectedPath}
      projectName={projectSlug} onSelect={selectEntry} onAction={handleAction}
      onNewInFolder={canEdit ? startNewInFolder : undefined} {canEdit} />
  </div>

  <!-- Resize handle -->
  <div
    role="separator"
    aria-label="Resize sidebar"
    aria-orientation="vertical"
    tabindex="0"
    onmousedown={onDragStart}
    onkeydown={(e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); sidebarWidth = Math.max(sidebarWidth - 10, 140); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); sidebarWidth = Math.min(sidebarWidth + 10, 500); }
    }}
    class="w-1.5 rounded-full shrink-0 cursor-col-resize hover:opacity-100 transition-opacity"
    style="background-color: {dragging ? 'var(--color-pink)' : 'transparent'}; opacity: {dragging ? 1 : 0.5};"
    onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-pink)'}
    onmouseleave={(e) => { if (!dragging) e.currentTarget.style.backgroundColor = 'transparent'; }}>
  </div>

  <!-- Main content -->
  <div class="flex-1 p-8 overflow-y-auto min-w-0 relative">
    {#if loading}
      <div class="loading-bar"></div>
    {/if}
    {#if mode === "activity" && contextPath}
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
      <EntryEditor projectName={projectSlug} isNew onCancel={closePanel} pathPrefix={newFolderPrefix} />
    {:else if mode === "edit" && entry}
      <EntryEditor {entry} projectName={projectSlug} onCancel={closePanel} />
    {:else if mode === "view" && entry}
      <EntryViewer {entry} projectName={projectSlug} onEdit={canEdit ? startEdit : undefined} />
    {:else}
      <div class="text-center mt-20" style="color: var(--color-text-muted); font-size: 14px;">
        Select a file or create a new one
      </div>
    {/if}

    {#if form?.error}
      <p class="mt-4 text-sm" role="alert" style="color: var(--color-danger);">{form.error}</p>
    {/if}

    {#if form?.importResult}
      <div class="rounded-lg p-3 text-sm mt-4" role="status"
        style="background-color: var(--color-success-bg); color: var(--color-success);">
        Import complete: {form.importResult.imported} new, {form.importResult.updated} updated, {form.importResult.skipped} skipped
      </div>
    {/if}
  </div>
</div>

<!-- Hidden import form -->
<form method="POST" action="?/importProject" enctype="multipart/form-data" use:enhance
  class="hidden" bind:this={importForm}>
  <input type="hidden" name="projectId" value={data.project.id} />
  <input type="file" name="file" accept=".zip" bind:this={importInput}
    onchange={() => importForm?.requestSubmit()} />
</form>

<style>
  .workspace-layout {
    display: flex;
    height: 100%;
  }

  .file-tree-sidebar {
    flex-shrink: 0;
    min-width: 0;
  }

  .loading-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    background: linear-gradient(90deg, #e8a04e, #d4782f, #e8a04e);
    background-size: 200% 100%;
    animation: loading-slide 1.2s ease-in-out infinite;
    border-radius: 0 0 2px 2px;
    z-index: 10;
  }

  @keyframes loading-slide {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (max-width: 768px) {
    .workspace-layout {
      flex-direction: column;
    }

    .file-tree-sidebar {
      width: 100% !important;
      max-height: 40vh;
      border-right: none !important;
      border-bottom: 1px solid var(--color-border);
    }
  }
</style>
