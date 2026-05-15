<script lang="ts">
let { data } = $props();

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
</script>

<div class="context-container">
  <div class="context-header">
    <h1 class="context-title">Project Context</h1>
    <p class="context-subtitle">
      {data.conversationCount} conversation{data.conversationCount === 1 ? "" : "s"}
      {#if data.context?.updated_at}
        &middot; updated {relativeTime(data.context.updated_at)}
      {/if}
      {#if data.context?.model}
        &middot; {data.context.model}
      {/if}
    </p>
  </div>

  {#if data.tier === "free"}
    <div class="glass-card">
      <p class="card-text">
        Project context summaries are generated automatically on the Plus plan. Your conversations
        and insights are still browsable on the free tier.
      </p>
      <a href="/settings" class="upgrade-button">Upgrade to Plus</a>
    </div>
  {:else if data.context?.summary}
    <div class="glass-card">
      <pre class="context-content">{data.context.summary}</pre>
      {#if data.context.conversation_count}
        <p class="context-source">
          Generated from {data.context.conversation_count} conversation{data.context.conversation_count === 1 ? "" : "s"}
          {#if data.context.source === "recent_summaries"}
            (recent summaries)
          {/if}
        </p>
      {/if}
    </div>
  {:else}
    <div class="glass-card">
      <p class="card-text">
        No project context yet. Context will appear automatically as your conversations
        are captured and compacted.
      </p>
    </div>
  {/if}
</div>

<style>
  .context-container { padding: 1.5rem; max-width: 720px; }
  .context-header { margin-bottom: 1.25rem; }
  .context-title { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-text); margin: 0 0 0.25rem; }
  .context-subtitle { font-size: 13px; color: var(--color-text-muted); margin: 0; }
  .glass-card { background: rgba(255, 253, 248, 0.5); border: 1px solid rgba(199, 183, 163, 0.25); border-radius: 12px; padding: 1.25rem 1.5rem; backdrop-filter: blur(8px); }
  .card-text { font-size: 14px; line-height: 1.6; color: var(--color-text); margin: 0; }
  .context-content { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 14px; line-height: 1.7; color: var(--color-text); margin: 0; }
  .context-source { font-size: 12px; color: var(--color-text-muted); margin: 0.75rem 0 0; }
  .upgrade-button { display: inline-block; margin-top: 1rem; background: rgba(86, 28, 36, 0.06); color: var(--color-pink-dark); border: 1px solid var(--color-pink); border-radius: 9999px; padding: 0.5rem 1.25rem; font-size: 13px; font-weight: 600; text-decoration: none; transition: background 150ms ease, transform 150ms ease; }
  .upgrade-button:hover { background: rgba(86, 28, 36, 0.1); transform: translateY(-1px); }
</style>
