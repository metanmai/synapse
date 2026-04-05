<script lang="ts">
import { goto } from "$app/navigation";
import { navigating } from "$app/stores";
import ConversationList from "$lib/components/conversations/ConversationList.svelte";

let { data } = $props();

const encodedProject = $derived(encodeURIComponent(data.project.name));
let filtering = $state(false);

const loadingConversationId = $derived.by(() => {
  if (!$navigating?.to?.url) return null;
  const match = $navigating.to.url.pathname.match(/\/conversations\/([^/]+)$/);
  return match ? match[1] : null;
});

async function handleStatusChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  const params = new URLSearchParams();
  if (value !== "all") params.set("status", value);
  const qs = params.toString();
  filtering = true;
  await goto(`/projects/${encodedProject}/conversations${qs ? `?${qs}` : ""}`, {
    invalidateAll: true,
  });
  filtering = false;
}

function pageUrl(page: number): string {
  const params = new URLSearchParams();
  if (data.statusFilter !== "all") params.set("status", data.statusFilter);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/projects/${encodedProject}/conversations${qs ? `?${qs}` : ""}`;
}

const emptyLabel = $derived(data.statusFilter === "all" ? null : data.statusFilter);
</script>

{#if data.tier === "free"}
  <div class="teaser-container">
    <div class="teaser-card">
      <div class="teaser-icon">💬</div>
      <h2 class="teaser-title">Conversation Sync</h2>
      <p class="teaser-desc">
        Keep a searchable archive of your agent conversations across Claude Code, ChatGPT, and more.
        Import exports, browse message history, and never lose context between sessions.
      </p>
      <a href="/account" class="upgrade-btn">Upgrade to Plus</a>
    </div>
  </div>
{:else}
  <div class="max-w-4xl p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold" style="color: var(--color-accent);">
        Conversations
      </h1>
      <div class="header-actions">
        <div class="filter-group">
          <label for="status-filter" class="filter-label">Status</label>
          <select
            id="status-filter"
            class="filter-select"
            value={data.statusFilter}
            onchange={handleStatusChange}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <a
          href="/projects/{encodedProject}/conversations/import"
          class="import-btn"
        >
          Import
        </a>
      </div>
    </div>

    {#if filtering}
      <div class="flex items-center gap-2 py-4" style="color: var(--color-text-muted); font-size: 13px;">
        <div class="spinner spinner-sm"></div>
        Loading...
      </div>
    {:else}
      <ConversationList
        conversations={data.conversations}
        projectName={data.project.name}
        {emptyLabel}
        {loadingConversationId}
      />
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
{/if}

<style>
  .teaser-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    padding: 2rem;
  }

  .teaser-card {
    text-align: center;
    max-width: 420px;
    padding: 2.5rem 2rem;
    border-radius: var(--radius-md);
    background-color: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-sm);
  }

  .teaser-icon {
    font-size: 2.5rem;
    margin-bottom: 1rem;
  }

  .teaser-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-accent);
    margin-bottom: 0.75rem;
  }

  .teaser-desc {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    line-height: 1.65;
    margin-bottom: 1.5rem;
  }

  .upgrade-btn {
    display: inline-block;
    font-size: 0.875rem;
    font-weight: 600;
    color: white;
    padding: 10px 28px;
    border-radius: var(--radius-pill);
    background: linear-gradient(135deg, var(--color-pink-dark), var(--color-pink));
    text-decoration: none;
    transition: var(--transition-base);
  }

  .upgrade-btn:hover {
    opacity: 0.9;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(86, 28, 36, 0.25);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .filter-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .filter-select {
    font-size: 0.8125rem;
    padding: 5px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-bg-muted);
    color: var(--color-text);
    outline: none;
    cursor: pointer;
    transition: var(--transition-base);
  }

  .filter-select:focus {
    border-color: var(--color-pink);
    box-shadow: 0 0 0 2px rgba(86, 28, 36, 0.08);
  }

  .import-btn {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-pink-dark);
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-pink);
    background: transparent;
    text-decoration: none;
    transition: var(--transition-base);
  }

  .import-btn:hover {
    background: rgba(86, 28, 36, 0.06);
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
    transition: var(--transition-base);
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
