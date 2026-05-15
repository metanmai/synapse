<script lang="ts">
import MessageThread from "$lib/components/conversations/MessageThread.svelte";

let { data } = $props();

let showTools = $state(false);

const conv = $derived(data.conversation);
const messages = $derived(data.messages);

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
</script>

<div class="max-w-4xl p-6">
  <!-- Header -->
  <div class="conv-header">
    <div class="header-top">
      <a href="/projects/{encodeURIComponent(data.project.name)}/conversations" class="back-link">
        &larr; Conversations
      </a>
    </div>

    <h1 class="conv-title">{conv.title || "Untitled Conversation"}</h1>

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

  .conv-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-accent);
    margin-bottom: 0.5rem;
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
</style>
