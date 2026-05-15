<script lang="ts">
  import type { Entry } from "$lib/types";

  let { entry, projectName } = $props<{
    entry: Entry;
    projectName: string;
  }>();
</script>

<div>
  <div class="flex items-center justify-between mb-4">
    <div>
      <h2 class="text-lg font-medium">{entry.path}</h2>
      <div class="text-xs mt-1" style="color: var(--color-text-muted);">
        <span class="inline-block rounded-full px-2 py-0.5 text-xs"
          style="background-color: var(--color-bg-muted);">
          {entry.source}
        </span>
        <span class="ml-2">{new Date(entry.updated_at).toLocaleString()}</span>
        {#each entry.tags as tag}
          <span class="ml-1 inline-block rounded-full px-2 py-0.5"
            style="background-color: var(--color-bg-muted);">
            {tag}
          </span>
        {/each}
      </div>
    </div>
    <div class="flex gap-3">
      <a href="/projects/{encodeURIComponent(projectName)}/history/{encodeURIComponent(entry.path)}"
        class="text-sm" style="color: var(--color-text-muted);">
        History
      </a>
      <a href="/projects/{encodeURIComponent(projectName)}?path={encodeURIComponent(entry.path)}&edit"
        class="text-sm" style="color: var(--color-accent);">
        Edit
      </a>
    </div>
  </div>
  <div class="rounded-xl p-4 whitespace-pre-wrap font-mono text-sm"
    style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border); line-height: 1.6;">
    {entry.content}
  </div>
</div>
