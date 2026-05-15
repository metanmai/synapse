<script lang="ts">
import { enhance } from "$app/forms";
import { invalidateAll } from "$app/navigation";
import MessageThread from "$lib/components/conversations/MessageThread.svelte";
import type { Conversation, ConversationMessage, ConversationMediaRecord } from "$lib/types";

let { data, form } = $props();

let loading = $state(true);
let errorMsg = $state("");
let conv = $state<Conversation | null>(null);
let messages = $state<ConversationMessage[]>([]);
let context = $state<Record<string, unknown>[]>([]);
let media = $state<ConversationMediaRecord[]>([]);

let showTools = $state(false);
let showExportMenu = $state(false);
let confirmDelete = $state(false);
let actionLoading = $state("");

const projectName = $derived(data.project.name);
const encodedProject = $derived(encodeURIComponent(projectName));

async function loadConversation() {
  loading = true;
  errorMsg = "";
  try {
    const res = await fetch(
      `/projects/${encodedProject}/conversations/${data.conversationId}/api`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message || `Failed to load (${res.status})`);
    }
    const result = await res.json();
    conv = result.conversation;
    messages = result.messages ?? [];
    context = result.context ?? [];
    media = result.media ?? [];
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "Failed to load conversation";
  } finally {
    loading = false;
  }
}

$effect(() => {
  // Re-fetch when conversationId changes (e.g. navigating between conversations)
  data.conversationId;
  loadConversation();
});

function fidelityLabel(mode: string): string {
  switch (mode) {
    case "full":
      return "Full fidelity";
    case "summary":
      return "Summary mode";
    default:
      return mode;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function toggleExportMenu() {
  showExportMenu = !showExportMenu;
}

function closeExportMenu() {
  showExportMenu = false;
}

function handleExportResult({ formData }: { formData: FormData }) {
  actionLoading = `export-${formData.get("format")}`;
  showExportMenu = false;
  return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
    actionLoading = "";
    if (result.type === "success" && result.data?.exportData) {
      const blob = new Blob([result.data.exportData as string], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const title = conv?.title?.replace(/[^a-zA-Z0-9_-]/g, "_") || "conversation";
      a.download = `${title}_${result.data.exportFormat}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };
}

function handleActionResult(label: string) {
  return () => {
    actionLoading = label;
    return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
      actionLoading = "";
      await update();
      confirmDelete = false;
      // Re-fetch to get updated status
      await loadConversation();
    };
  };
}
</script>

<svelte:window onclick={closeExportMenu} />

<div class="max-w-4xl p-6">
  {#if loading}
    <!-- Loading skeleton -->
    <div class="conv-header">
      <div class="header-top">
        <a href="/projects/{encodedProject}/conversations" class="back-link">
          &larr; Conversations
        </a>
      </div>
      <div class="skeleton-row">
        <div class="skeleton skeleton-title"></div>
      </div>
      <div class="skeleton-row">
        <div class="skeleton skeleton-meta"></div>
        <div class="skeleton skeleton-meta-sm"></div>
        <div class="skeleton skeleton-meta-sm"></div>
      </div>
    </div>

    <div class="skeleton-messages">
      {#each { length: 5 } as _}
        <div class="skeleton-message">
          <div class="skeleton-row">
            <div class="skeleton skeleton-badge"></div>
            <div class="skeleton skeleton-meta-sm"></div>
          </div>
          <div class="skeleton skeleton-content"></div>
          <div class="skeleton skeleton-content-short"></div>
        </div>
      {/each}
    </div>
  {:else if errorMsg}
    <div class="conv-header">
      <div class="header-top">
        <a href="/projects/{encodedProject}/conversations" class="back-link">
          &larr; Conversations
        </a>
      </div>
    </div>
    <div class="error-msg">{errorMsg}</div>
  {:else if conv}
    <!-- Header -->
    <div class="conv-header">
      <div class="header-top">
        <a href="/projects/{encodedProject}/conversations" class="back-link">
          &larr; Conversations
        </a>
      </div>

      <div class="title-row">
        <h1 class="conv-title">{conv.title || "Untitled Conversation"}</h1>

        <div class="action-buttons">
          <!-- Export dropdown -->
          <div class="dropdown" role="group">
            <button
              type="button"
              class="action-btn"
              aria-haspopup="true"
              aria-expanded={showExportMenu}
              aria-label="Export conversation"
              onclick={(e: MouseEvent) => { e.stopPropagation(); toggleExportMenu(); }}
            >
              Export
            </button>
            {#if showExportMenu}
              <div class="dropdown-menu" role="menu" tabindex="-1" onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') showExportMenu = false; }} onclick={(e: MouseEvent) => e.stopPropagation()}>
                <form method="POST" action="?/export" use:enhance={handleExportResult}>
                  <input type="hidden" name="format" value="raw" />
                  <button type="submit" class="dropdown-item" role="menuitem">Raw JSON</button>
                </form>
                <form method="POST" action="?/export" use:enhance={handleExportResult}>
                  <input type="hidden" name="format" value="anthropic" />
                  <button type="submit" class="dropdown-item" role="menuitem">Anthropic</button>
                </form>
                <form method="POST" action="?/export" use:enhance={handleExportResult}>
                  <input type="hidden" name="format" value="openai" />
                  <button type="submit" class="dropdown-item" role="menuitem">OpenAI</button>
                </form>
              </div>
            {/if}
          </div>

          <!-- Archive / Restore -->
          {#if conv.status === "active"}
            <form method="POST" action="?/archive" use:enhance={handleActionResult("archive")}>
              <button type="submit" class="action-btn" disabled={!!actionLoading} aria-label="Archive conversation">
                {actionLoading === "archive" ? "Archiving..." : "Archive"}
              </button>
            </form>
          {:else if conv.status === "archived"}
            <form method="POST" action="?/restore" use:enhance={handleActionResult("restore")}>
              <button type="submit" class="action-btn action-btn-restore" disabled={!!actionLoading} aria-label="Restore conversation">
                {actionLoading === "restore" ? "Restoring..." : "Restore"}
              </button>
            </form>
          {/if}

          <!-- Delete -->
          {#if conv.status !== "deleted"}
            {#if confirmDelete}
              <form method="POST" action="?/delete" use:enhance>
                <button type="submit" class="action-btn action-btn-danger" aria-label="Confirm delete">
                  Confirm Delete
                </button>
              </form>
              <button
                type="button"
                class="action-btn"
                onclick={() => { confirmDelete = false; }}
                aria-label="Cancel delete"
              >
                Cancel
              </button>
            {:else}
              <button
                type="button"
                class="action-btn action-btn-danger"
                onclick={() => { confirmDelete = true; }}
                aria-label="Delete conversation"
              >
                Delete
              </button>
            {/if}
          {/if}
        </div>
      </div>

      {#if form?.error}
        <div class="error-msg">{form.error}</div>
      {/if}

      <div class="conv-meta">
        <span class="meta-item">{conv.message_count} message{conv.message_count === 1 ? "" : "s"}</span>
        <span class="meta-sep">&middot;</span>
        <span class="meta-item">{fidelityLabel(conv.fidelity_mode)}</span>
        <span class="meta-sep">&middot;</span>
        <span class="meta-item">{formatDate(conv.created_at)}</span>
        {#if conv.status !== "active"}
          <span class="meta-sep">&middot;</span>
          <span class="status-badge status-{conv.status}">{conv.status}</span>
        {/if}
      </div>
    </div>

    <!-- System prompt -->
    {#if conv.system_prompt}
      <div class="system-prompt-box">
        <div class="system-prompt-label">System Prompt</div>
        <pre class="system-prompt-content">{conv.system_prompt}</pre>
      </div>
    {/if}

    <!-- Controls -->
    <div class="controls">
      <label class="toggle-label">
        <input type="checkbox" bind:checked={showTools} class="toggle-checkbox" />
        <span>Show tool details</span>
      </label>
    </div>

    <!-- Messages -->
    <MessageThread {messages} {showTools} />
  {/if}
</div>

<style>
  .conv-header {
    margin-bottom: 1.5rem;
  }

  .header-top {
    margin-bottom: 0.75rem;
  }

  .back-link {
    font-size: 0.8125rem;
    color: var(--color-link);
    text-decoration: none;
    transition: var(--transition-base);
  }

  .back-link:hover {
    text-decoration: underline;
  }

  .title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  .conv-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-accent);
    min-width: 0;
    word-break: break-word;
  }

  .action-buttons {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .action-btn {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-pink-dark);
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: transparent;
    cursor: pointer;
    transition: var(--transition-base);
    white-space: nowrap;
  }

  .action-btn:hover {
    background: rgba(86, 28, 36, 0.06);
    border-color: var(--color-pink);
  }

  .action-btn-restore {
    color: var(--color-success);
    border-color: var(--color-success);
  }

  .action-btn-restore:hover {
    background: rgba(45, 80, 22, 0.06);
    border-color: var(--color-success);
  }

  .action-btn-danger {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }

  .action-btn-danger:hover {
    background: rgba(139, 0, 0, 0.06);
    border-color: var(--color-danger);
  }

  .dropdown {
    position: relative;
  }

  .dropdown-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 140px;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md);
    z-index: 20;
    overflow: hidden;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    padding: 8px 14px;
    font-size: 0.8125rem;
    color: var(--color-text);
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: var(--transition-base);
  }

  .dropdown-item:hover {
    background: var(--color-bg-muted);
  }

  .error-msg {
    font-size: 0.8125rem;
    color: var(--color-danger);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(139, 0, 0, 0.2);
    background: rgba(139, 0, 0, 0.06);
    margin-bottom: 0.75rem;
  }

  .conv-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .meta-item {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .meta-sep {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    opacity: 0.5;
  }

  .status-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 8px;
    border-radius: var(--radius-pill);
  }

  .status-archived {
    background: rgba(107, 114, 128, 0.12);
    color: #6b7280;
  }

  .status-deleted {
    background: rgba(139, 0, 0, 0.1);
    color: var(--color-danger);
  }

  .system-prompt-box {
    margin-bottom: 1.25rem;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    background: var(--color-bg-muted);
    border: 1px solid var(--color-border);
  }

  .system-prompt-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .system-prompt-content {
    font-size: 0.8125rem;
    line-height: 1.6;
    color: var(--color-text);
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: inherit;
    margin: 0;
    background: none;
    border: none;
    padding: 0;
    opacity: 0.8;
  }

  .controls {
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    cursor: pointer;
    user-select: none;
  }

  .toggle-checkbox {
    accent-color: var(--color-accent);
    cursor: pointer;
  }

  /* Skeleton loading styles */
  .skeleton {
    background: linear-gradient(90deg, var(--color-bg-muted) 25%, var(--color-border) 50%, var(--color-bg-muted) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    border-radius: 6px;
  }

  .skeleton-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .skeleton-title {
    height: 1.5rem;
    width: 60%;
  }

  .skeleton-meta {
    height: 0.875rem;
    width: 100px;
  }

  .skeleton-meta-sm {
    height: 0.875rem;
    width: 70px;
  }

  .skeleton-badge {
    height: 1rem;
    width: 60px;
  }

  .skeleton-content {
    height: 0.875rem;
    width: 100%;
    margin-bottom: 0.5rem;
  }

  .skeleton-content-short {
    height: 0.875rem;
    width: 70%;
  }

  .skeleton-messages {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  .skeleton-message {
    padding: 0.875rem 1rem;
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-left: 4px solid var(--color-border);
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
