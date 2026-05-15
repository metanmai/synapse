<script lang="ts">
import { formatRelativeDate } from "$lib/components/conversations/conversation-helpers";

let { data } = $props();

const encodedProject = $derived(encodeURIComponent(data.project.name));

function pageUrl(page: number): string {
  const params = new URLSearchParams();
  if (data.statusFilter !== "all") params.set("status", data.statusFilter);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/projects/${encodedProject}/conversations${qs ? `?${qs}` : ""}`;
}
</script>

<div class="conversations-container">
  <h1 class="page-title">Conversations</h1>

  {#if data.conversations.length === 0}
    <div class="empty-state">
      <p class="empty-text">No conversations yet.</p>
    </div>
  {:else}
    <div class="conversation-list">
      {#each data.conversations as convo (convo.id)}
        <a
          href="/projects/{encodedProject}/conversations/{convo.id}"
          class="conversation-card"
        >
          <div class="card-header">
            <span class="card-title">{convo.title || "Untitled conversation"}</span>
          </div>
          <div class="card-meta">
            <span class="meta-item">
              {convo.message_count} message{convo.message_count === 1 ? "" : "s"}
            </span>
            <span class="meta-separator"></span>
            <span class="meta-item">
              {formatRelativeDate(convo.updated_at)}
            </span>
          </div>
        </a>
      {/each}
    </div>
  {/if}

  {#if data.totalPages > 1}
    <nav class="pagination" aria-label="Conversations pagination">
      {#if data.page > 1}
        <a href={pageUrl(data.page - 1)} class="page-link">
          &larr; Previous
        </a>
      {:else}
        <span class="page-link page-disabled">&larr; Previous</span>
      {/if}

      <span class="page-info">
        Page {data.page} of {data.totalPages}
      </span>

      {#if data.page < data.totalPages}
        <a href={pageUrl(data.page + 1)} class="page-link">
          Next &rarr;
        </a>
      {:else}
        <span class="page-link page-disabled">Next &rarr;</span>
      {/if}
    </nav>
  {/if}
</div>

<style>
  .conversations-container {
    padding: 1.5rem;
    max-width: 48rem;
  }

  .page-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-accent);
    margin-bottom: 1.5rem;
  }

  .conversation-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .conversation-card {
    display: block;
    padding: 1rem;
    border-radius: 12px;
    background: rgba(255, 253, 248, 0.5);
    border: 1px solid rgba(199, 183, 163, 0.25);
    text-decoration: none;
    color: inherit;
    transition: background 0.15s ease, transform 0.15s ease;
  }

  .conversation-card:hover {
    background: rgba(255, 253, 248, 0.8);
    transform: translateY(-1px);
  }

  .card-header {
    margin-bottom: 0.375rem;
  }

  .card-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
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

  .empty-text {
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

  .page-link {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-link);
    text-decoration: none;
    padding: 6px 12px;
    border-radius: 8px;
    transition: background 0.15s ease;
  }

  .page-link:hover:not(.page-disabled) {
    background: rgba(86, 28, 36, 0.06);
  }

  .page-disabled {
    color: var(--color-text-muted);
    opacity: 0.4;
    cursor: default;
  }

  .page-info {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }
</style>
