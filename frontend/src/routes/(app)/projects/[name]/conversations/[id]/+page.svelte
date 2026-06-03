<script lang="ts">
import { enhance } from "$app/forms";
import Markdown from "$lib/components/Markdown.svelte";
import {
  formatMessageTime,
  getToolBadge,
  getToolLabel,
  toolSummary,
} from "$lib/components/conversations/conversation-helpers";
import type { Conversation, ConversationMediaRecord, ConversationMessage } from "$lib/types";

let { data, form } = $props();

let loading = $state(true);
let errorMsg = $state("");
let conv = $state<Conversation | null>(null);
let messages = $state<ConversationMessage[]>([]);
let context = $state<Record<string, unknown>[]>([]);
let media = $state<ConversationMediaRecord[]>([]);

let viewMode = $state<"compact" | "full">("full");
let compacting = $state(false);
let showExportMenu = $state(false);
let confirmDelete = $state(false);
let actionLoading = $state("");

const projectName = $derived(data.project.name);
// Shared projects use `<owner_email>~<name>` as the URL slug; bare name only
// works for owner-role projects. `projectName` stays as the display name; the
// encoded slug is what we put in /projects/<...> URLs.
const projectSlug = $derived(
  data.project.role === "owner" ? data.project.name : `${data.project.owner_email}~${data.project.name}`,
);
const encodedProject = $derived(encodeURIComponent(projectSlug));

const sourceTool = $derived(
  (conv?.metadata?.source_tool as string | undefined) ?? (messages.length > 0 ? messages[0].source_agent : undefined),
);

const totalTokens = $derived(
  messages.reduce((sum, m) => {
    if (!m.token_count) return sum;
    return sum + (m.token_count.input ?? 0) + (m.token_count.output ?? 0);
  }, 0),
);

async function loadConversation() {
  loading = true;
  errorMsg = "";
  try {
    const res = await fetch(`/projects/${encodedProject}/conversations/${data.conversationId}/api`);
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
  data.conversationId;
  loadConversation();
});

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

function formatTokenEstimate(tokens: number): string {
  if (tokens === 0) return "0 tokens";
  if (tokens < 1000) return `${tokens} tokens`;
  return `${(tokens / 1000).toFixed(1)}k tokens`;
}

function roleInitial(role: string): string {
  switch (role) {
    case "user":
      return "U";
    case "assistant":
      return "A";
    case "system":
      return "S";
    case "tool":
      return "T";
    default:
      return "?";
  }
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
      await loadConversation();
    };
  };
}
</script>

<svelte:window onclick={closeExportMenu} />

<div class="page-container">
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
            <div class="skeleton skeleton-avatar"></div>
            <div class="skeleton skeleton-meta"></div>
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
        {#if sourceTool}
          {@const badge = getToolBadge(sourceTool)}
          <span class="source-badge" style="background: {badge.bg}; color: {badge.text};">
            {getToolLabel(sourceTool)}
          </span>
          <span class="meta-sep">&middot;</span>
        {/if}
        <span class="meta-item">{conv.message_count} message{conv.message_count === 1 ? "" : "s"}</span>
        <span class="meta-sep">&middot;</span>
        <span class="meta-item">{formatTokenEstimate(totalTokens)}</span>
        <span class="meta-sep">&middot;</span>
        <span class="meta-item">{formatDate(conv.created_at)}</span>
        {#if conv.status !== "active"}
          <span class="meta-sep">&middot;</span>
          <span class="status-badge status-{conv.status}">{conv.status}</span>
        {/if}
      </div>
    </div>

    <!-- View toggle -->
    <div class="view-toggle">
      <button
        type="button"
        class="toggle-btn toggle-btn-left"
        class:toggle-active={viewMode === "compact"}
        onclick={() => { viewMode = "compact"; }}
      >
        Compact
      </button>
      <button
        type="button"
        class="toggle-btn toggle-btn-right"
        class:toggle-active={viewMode === "full"}
        onclick={() => { viewMode = "full"; }}
      >
        Full transcript
      </button>
    </div>

    <!-- Transcript container -->
    <div class="transcript-container glass">
      {#if viewMode === "compact"}
        {#if conv?.compacted_summary}
          <div class="compact-summary">
            <pre class="compact-content">{conv.compacted_summary}</pre>
            <div class="compact-meta">
              Compacted {conv.compacted_at ? formatDate(conv.compacted_at) : ""}
              {#if conv.compaction_model}
                &middot; {conv.compaction_model}
              {/if}
            </div>
          </div>
        {:else if data.tier === "plus"}
          <div class="compact-placeholder">
            <p>No compacted summary yet.</p>
            <form method="POST" action="?/compact" use:enhance={() => {
              compacting = true;
              return async ({ update }) => {
                compacting = false;
                await update();
                await loadConversation();
              };
            }}>
              <button type="submit" class="compact-btn" disabled={compacting}>
                {compacting ? "Compacting..." : "Compact now"}
              </button>
            </form>
          </div>
        {:else}
          <div class="compact-placeholder">
            <p>Compact summaries are available on the Plus plan.</p>
            <a href="/settings" class="upgrade-link">Upgrade to Plus</a>
          </div>
        {/if}
      {:else}
        <!-- Full transcript: chat-style messages -->
        {#if messages.length === 0}
          <div class="empty-state">No messages in this conversation.</div>
        {:else}
          <div class="chat-thread">
            {#each messages as msg (msg.id)}
              <div class="chat-row chat-row-{msg.role}">
                <div class="avatar avatar-{msg.role}">
                  {roleInitial(msg.role)}
                </div>
                <div class="chat-bubble">
                  <div class="chat-header">
                    <span class="chat-role">{msg.role}</span>
                    {#if msg.source_agent && msg.source_agent !== "claude-code"}
                      <span class="chat-agent">{msg.source_agent}</span>
                    {/if}
                    {#if msg.source_model}
                      <span class="chat-model">{msg.source_model}</span>
                    {/if}
                    <span class="chat-time">{formatMessageTime(msg.created_at)}</span>
                  </div>

                  {#if msg.content}
                    <div class="chat-content">
                      <Markdown text={msg.content} />
                    </div>
                  {/if}

                  {#if msg.tool_interaction}
                    <div class="tool-card">
                      <span class="tool-name">{msg.tool_interaction.name}</span>
                      <span class="tool-desc">{toolSummary(msg)}</span>
                    </div>
                  {/if}

                  {#if msg.attachments_summary}
                    <div class="chat-attachments">{msg.attachments_summary}</div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <!-- Footer -->
    <div class="conv-footer">
      <span class="footer-item">
        {#if sourceTool}
          Source: {getToolLabel(sourceTool)}
        {:else}
          Source: Unknown
        {/if}
      </span>
      <span class="footer-sep">&middot;</span>
      <span class="footer-item">{conv.message_count} message{conv.message_count === 1 ? "" : "s"}</span>
      <span class="footer-sep">&middot;</span>
      <span class="footer-item">{formatTokenEstimate(totalTokens)}</span>
    </div>
  {/if}
</div>

<style>
  .page-container {
    max-width: 56rem;
    padding: 1.5rem;
  }

  /* ---------- Header ---------- */
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

  .source-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 1px 8px;
    border-radius: var(--radius-pill);
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

  /* ---------- Action buttons ---------- */
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

  /* ---------- View toggle ---------- */
  .view-toggle {
    display: flex;
    margin-bottom: 1rem;
  }

  .toggle-btn {
    font-size: 0.8125rem;
    font-weight: 500;
    padding: 6px 16px;
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: var(--transition-base);
  }

  .toggle-btn-left {
    border-radius: 8px 0 0 8px;
  }

  .toggle-btn-right {
    border-radius: 0 8px 8px 0;
    border-left: none;
  }

  .toggle-active {
    background: rgba(86, 28, 36, 0.08);
    color: var(--color-text);
    font-weight: 600;
  }

  /* ---------- Transcript container ---------- */
  .transcript-container {
    min-height: 200px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  /* ---------- Compact view ---------- */
  .compact-placeholder {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--color-text-muted);
    font-size: 0.875rem;
    line-height: 1.6;
  }

  .compact-hint {
    font-size: 0.75rem;
    margin-top: 0.5rem;
    opacity: 0.7;
  }

  .compact-summary {
    padding: 1rem;
  }

  .compact-content {
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.7;
    color: var(--color-text);
    margin: 0;
  }

  .compact-meta {
    margin-top: 0.75rem;
    font-size: 12px;
    color: var(--color-text-muted);
  }

  .compact-btn {
    margin-top: 0.75rem;
    background: rgba(86, 28, 36, 0.06);
    color: var(--color-pink-dark);
    border: 1px solid var(--color-pink);
    border-radius: 9999px;
    padding: 0.4rem 1rem;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 150ms ease, transform 150ms ease;
  }

  .compact-btn:hover:not(:disabled) {
    background: rgba(86, 28, 36, 0.1);
    transform: translateY(-1px);
  }

  .compact-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .upgrade-link {
    display: inline-block;
    margin-top: 0.5rem;
    color: var(--color-pink-dark);
    text-decoration: underline;
    font-size: 13px;
  }

  /* ---------- Chat thread ---------- */
  .chat-thread {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .chat-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }

  .avatar-user {
    background: linear-gradient(135deg, #e8d8c4, #c7b7a3);
    color: var(--color-accent);
  }

  .avatar-assistant {
    background: linear-gradient(135deg, var(--color-pink-dark), var(--color-pink));
    color: white;
  }

  .avatar-system {
    background: linear-gradient(135deg, #d1d5db, #9ca3af);
    color: white;
  }

  .avatar-tool {
    background: linear-gradient(135deg, #c084fc, #9333ea);
    color: white;
  }

  .chat-bubble {
    flex: 1;
    min-width: 0;
  }

  .chat-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
    flex-wrap: wrap;
  }

  .chat-role {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }

  .chat-agent {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-text-muted);
    background: var(--color-bg-muted);
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border);
  }

  .chat-model {
    font-size: 0.625rem;
    color: var(--color-text-muted);
    font-family: "SF Mono", "Fira Code", "Fira Mono", monospace;
  }

  .chat-time {
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    margin-left: auto;
  }

  .chat-content {
    font-size: 0.875rem;
    line-height: 1.65;
    color: var(--color-text);
    word-wrap: break-word;
    overflow-wrap: anywhere;
    margin: 0;
  }

  /* ---------- Tool card ---------- */
  .tool-card {
    background: var(--color-bg-muted);
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    font-size: 12px;
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .tool-name {
    font-weight: 600;
    color: #9333ea;
  }

  .tool-desc {
    color: var(--color-text-muted);
  }

  .chat-attachments {
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    margin-top: 0.375rem;
    font-style: italic;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  /* ---------- Footer ---------- */
  .conv-footer {
    background: var(--color-bg-muted);
    border-radius: 12px;
    padding: 0.75rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .footer-item {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .footer-sep {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    opacity: 0.5;
  }

  /* ---------- Skeleton loading ---------- */
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

  .skeleton-avatar {
    height: 32px;
    width: 32px;
    border-radius: 50%;
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
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .skeleton-message {
    padding: 0.875rem 1rem;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
