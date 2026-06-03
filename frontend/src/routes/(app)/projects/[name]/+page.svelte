<script lang="ts">
let { data } = $props();

const projectSlug = $derived(
  data.project.role === "owner" ? data.project.name : `${data.project.owner_email}~${data.project.name}`,
);

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function insightTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    decision: "Decision",
    architecture: "Architecture",
    preference: "Preference",
    learning: "Learning",
    bug: "Bug",
    pattern: "Pattern",
  };
  return labels[type] || type;
}
</script>

<div class="overview-container">
  <!-- Insights section -->
  <section class="overview-section">
    <div class="section-header">
      <h2 class="section-title">Insights ({data.insightTotal})</h2>
      {#if data.insightTotal > data.insights.length}
        <a href="/projects/{encodeURIComponent(projectSlug)}/insights" class="section-link">
          Show all {data.insightTotal} &rarr;
        </a>
      {/if}
    </div>

    {#if data.insights.length === 0}
      <p class="empty-text">No insights yet. Insights are extracted automatically from your conversations.</p>
    {:else}
      <div class="insight-list">
        {#each data.insights as insight (insight.id)}
          <div class="insight-card">
            <span class="insight-type">{insightTypeLabel(insight.type)}</span>
            <p class="insight-summary">{insight.summary}</p>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <hr class="divider" />

  <!-- Recent Conversations section -->
  <section class="overview-section">
    <div class="section-header">
      <h2 class="section-title">Recent Conversations ({data.conversationTotal})</h2>
      {#if data.conversationTotal > 0}
        <a href="/projects/{encodeURIComponent(projectSlug)}/conversations" class="section-link">
          View all conversations &rarr;
        </a>
      {/if}
    </div>

    {#if data.conversations.length === 0}
      <p class="empty-text">No conversations yet. Sync a conversation from your AI coding tool to get started.</p>
    {:else}
      <div class="conversation-list">
        {#each data.conversations as conversation (conversation.id)}
          <a
            href="/projects/{encodeURIComponent(projectSlug)}/conversations/{conversation.id}"
            class="conversation-card"
          >
            <div class="conversation-header">
              <span class="conversation-title">{conversation.title || "Untitled conversation"}</span>
              <span class="conversation-time">{relativeTime(conversation.updated_at)}</span>
            </div>
            <div class="conversation-meta">
              {conversation.message_count} message{conversation.message_count === 1 ? "" : "s"}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .overview-container {
    padding: 1.5rem;
    max-width: 720px;
  }

  .overview-section {
    margin-bottom: 1rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .section-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--color-text);
    margin: 0;
  }

  .section-link {
    color: var(--color-link);
    font-weight: 600;
    font-size: 13px;
    text-decoration: none;
  }

  .section-link:hover {
    text-decoration: underline;
  }

  .empty-text {
    font-size: 13px;
    color: var(--color-text-muted);
    margin: 0;
    padding: 1rem 0;
  }

  .divider {
    border: none;
    border-top: 1px solid rgba(199, 183, 163, 0.25);
    margin: 1.25rem 0;
  }

  /* Insight cards */
  .insight-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .insight-card {
    background: rgba(255, 253, 248, 0.5);
    border: 1px solid rgba(199, 183, 163, 0.25);
    border-radius: 12px;
    padding: 0.75rem 1rem;
  }

  .insight-type {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .insight-summary {
    font-size: 13px;
    color: var(--color-text);
    margin: 0.25rem 0 0;
    line-height: 1.5;
  }

  /* Conversation cards */
  .conversation-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .conversation-card {
    display: block;
    background: rgba(255, 253, 248, 0.5);
    border: 1px solid rgba(199, 183, 163, 0.25);
    border-radius: 12px;
    padding: 0.75rem 1rem;
    text-decoration: none;
    color: inherit;
    transition:
      transform 150ms ease,
      border-color 150ms ease;
  }

  .conversation-card:hover {
    transform: translateY(-1px);
    border-color: rgba(199, 183, 163, 0.5);
  }

  .conversation-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .conversation-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .conversation-time {
    font-size: 11px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .conversation-meta {
    font-size: 12px;
    color: var(--color-text-muted);
    margin-top: 0.25rem;
  }
</style>
