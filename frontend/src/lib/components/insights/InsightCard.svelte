<script lang="ts">
import { enhance } from "$app/forms";
import type { InsightListItem } from "$lib/types";

let { insight, ondelete } = $props<{
  insight: InsightListItem;
  ondelete?: boolean;
}>();

const badgeColors: Record<string, { bg: string; text: string }> = {
  decision: { bg: "rgba(37, 99, 235, 0.12)", text: "#2563eb" },
  learning: { bg: "rgba(22, 163, 74, 0.12)", text: "#16a34a" },
  preference: { bg: "rgba(147, 51, 234, 0.12)", text: "#9333ea" },
  architecture: { bg: "rgba(234, 88, 12, 0.12)", text: "#ea580c" },
  action_item: { bg: "rgba(220, 38, 38, 0.12)", text: "#dc2626" },
};

const badge = $derived(badgeColors[insight.type] ?? { bg: "rgba(0,0,0,0.08)", text: "inherit" });

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
</script>

<div class="insight-card">
  <div class="flex items-center gap-2 mb-2">
    <span class="badge" style="background: {badge.bg}; color: {badge.text};">
      {insight.type.replace("_", " ")}
    </span>
    <span class="date">{formatDate(insight.created_at)}</span>
  </div>

  <p class="summary">{insight.summary}</p>

  {#if insight.source}
    <div class="source">
      via {insight.source.type}{#if insight.source.agent} ({insight.source.agent}){/if}
    </div>
  {/if}

  {#if ondelete}
    <form method="POST" action="?/delete" use:enhance class="mt-3">
      <input type="hidden" name="insightId" value={insight.id} />
      <button type="submit" class="delete-btn cursor-pointer">Delete</button>
    </form>
  {/if}
</div>

<style>
  .insight-card {
    padding: 1rem;
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    transition: var(--transition-base);
  }

  .insight-card:hover {
    box-shadow: var(--shadow-sm);
    transform: translateY(-1px);
  }

  .badge {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }

  .date {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-left: auto;
  }

  .summary {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text);
  }

  .source {
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    margin-top: 0.5rem;
  }

  .delete-btn {
    font-size: 0.75rem;
    color: var(--color-danger);
    background: none;
    border: 1px solid transparent;
    padding: 2px 8px;
    border-radius: 6px;
    transition: var(--transition-base);
  }

  .delete-btn:hover {
    border-color: var(--color-danger);
    background: rgba(139, 0, 0, 0.06);
  }
</style>
