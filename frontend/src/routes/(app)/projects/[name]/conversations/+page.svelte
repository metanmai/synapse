<script lang="ts">
import ConversationList from "$lib/components/conversations/ConversationList.svelte";

let { data } = $props();

const encodedProject = $derived(encodeURIComponent(data.project.name));
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
      <a
        href="/projects/{encodedProject}/conversations/import"
        class="import-btn"
      >
        Import
      </a>
    </div>

    <ConversationList conversations={data.conversations} projectName={data.project.name} />
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
</style>
