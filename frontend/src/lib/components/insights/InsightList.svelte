<script lang="ts">
import type { InsightListItem } from "$lib/types";
import InsightCard from "./InsightCard.svelte";

let { insights } = $props<{ insights: InsightListItem[] }>();
</script>

{#if insights.length === 0}
  <div class="empty-state">
    <p class="empty-title">No insights yet</p>
    <p class="empty-desc">
      Insights are decisions, learnings, and preferences extracted from your sessions.
      Add one manually or let your agents create them automatically.
    </p>
  </div>
{:else}
  <div class="insight-grid">
    {#each insights as insight (insight.id)}
      <InsightCard {insight} ondelete={true} />
    {/each}
  </div>
{/if}

<style>
  .insight-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 0.75rem;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
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
    margin: 0 auto;
    line-height: 1.6;
  }
</style>
