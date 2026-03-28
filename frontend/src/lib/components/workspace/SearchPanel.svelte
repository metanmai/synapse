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
      class="flex-1 rounded-lg px-3 py-2.5 text-sm"
      style="border: 1px solid var(--color-border);"
    />
    <button type="submit"
      class="rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
      style="background-color: var(--color-accent); color: var(--color-text);">
      Search
    </button>
  </form>

  {#if results}
    {#each results as entry}
      <a href="/projects/{encodeURIComponent(projectName)}?path={encodeURIComponent(entry.path)}"
        class="block rounded-xl p-3 text-sm transition-colors"
        style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
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
