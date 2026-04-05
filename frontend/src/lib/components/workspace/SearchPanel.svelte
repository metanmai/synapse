<script lang="ts">
import type { Entry } from "$lib/types";

let { results, query, projectName } = $props<{
  results: Entry[] | null;
  query: string | null;
  projectName: string;
}>();
</script>

<div class="space-y-3">
  <form method="GET" class="flex gap-2">
    <input type="text" name="q" placeholder="Search context..." autofocus
      value={query ?? ""}
      class="flex-1 text-sm"
      style="border: 1px solid var(--color-border); border-radius: 12px; padding: 12px 16px;
        outline: none; transition: var(--transition-base);"
      onfocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-pink)'; }}
      onblur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
    />
    <button type="submit" class="btn-primary cursor-pointer">
      Search
    </button>
  </form>

  {#if results}
    {#each results as entry}
      <a href="/projects/{encodeURIComponent(projectName)}?path={encodeURIComponent(entry.path)}"
        class="block rounded-xl p-3 text-sm"
        style="border: 1px solid var(--color-border); border-radius: 12px; transition: all 150ms ease;"
        onmouseenter={(e) => { e.currentTarget.style.background = 'rgba(86, 28, 36, 0.04)'; }}
        onmouseleave={(e) => { e.currentTarget.style.background = ''; }}>
        <div class="font-medium">{entry.path}</div>
        <div class="text-xs mt-1 line-clamp-2" style="color: var(--color-text-muted);">
          {entry.content.slice(0, 150)}
        </div>
      </a>
    {/each}
    {#if results.length === 0}
      <p class="text-sm" style="color: var(--color-text-muted);">No results found</p>
    {/if}
  {/if}
</div>
