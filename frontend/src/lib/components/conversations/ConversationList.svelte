<script lang="ts">
import type { ConversationListItem } from "$lib/types";

let { conversations, projectName } = $props<{
  conversations: ConversationListItem[];
  projectName: string;
}>();

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: "rgba(22, 163, 74, 0.12)", text: "#16a34a" },
  archived: { bg: "rgba(107, 114, 128, 0.12)", text: "#6b7280" },
  deleted: { bg: "rgba(220, 38, 38, 0.12)", text: "#dc2626" },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

const encodedProject = $derived(encodeURIComponent(projectName));
</script>

{#if conversations.length === 0}
  <div class="empty-state">
    <div class="empty-icon">💬</div>
    <p class="empty-title">No conversations yet</p>
    <p class="empty-desc">
      Sync your agent conversations to keep a searchable history across tools.
      Import a Claude Code or ChatGPT export to get started.
    </p>
    <a href="/projects/{encodedProject}/conversations/import" class="import-link">
      Import Conversations
    </a>
  </div>
{:else}
  <div class="conversation-list">
    {#each conversations as convo (convo.id)}
      {@const badge = statusColors[convo.status] ?? { bg: "rgba(0,0,0,0.08)", text: "inherit" }}
      <a
        href="/projects/{encodedProject}/conversations/{convo.id}"
        class="conversation-card"
      >
        <div class="card-header">
          <span class="card-title">{convo.title || "Untitled conversation"}</span>
          <span class="status-badge" style="background: {badge.bg}; color: {badge.text};">
            {convo.status}
          </span>
        </div>
        <div class="card-meta">
          <span class="meta-item">
            <span class="meta-icon">💬</span>
            {convo.message_count} message{convo.message_count === 1 ? "" : "s"}
          </span>
          <span class="meta-separator"></span>
          <span class="meta-item">
            {formatDate(convo.updated_at)}
          </span>
        </div>
      </a>
    {/each}
  </div>
{/if}

<style>
  .conversation-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .conversation-card {
    display: block;
    padding: 1rem 1.125rem;
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    text-decoration: none;
    color: inherit;
    transition: var(--transition-base);
  }

  .conversation-card:hover {
    box-shadow: var(--shadow-sm);
    transform: translateY(-1px);
    border-color: var(--color-pink);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.375rem;
  }

  .card-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .status-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .meta-icon {
    font-size: 0.75rem;
    line-height: 1;
  }

  .meta-separator::after {
    content: "\00b7";
    color: var(--color-text-muted);
    font-weight: 700;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
  }

  .empty-icon {
    font-size: 2rem;
    margin-bottom: 0.75rem;
  }

  .empty-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .empty-desc {
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    max-width: 400px;
    margin: 0 auto 1.25rem;
    line-height: 1.6;
  }

  .import-link {
    font-size: 0.8125rem;
    font-weight: 600;
    color: white;
    padding: 8px 20px;
    border-radius: 8px;
    background: var(--color-accent);
    text-decoration: none;
    display: inline-block;
    transition: var(--transition-base);
  }

  .import-link:hover {
    background: var(--color-accent-hover);
  }
</style>
