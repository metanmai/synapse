<script lang="ts">
import type { Entry } from "$lib/types";
import { marked } from "marked";

let { entry, projectName, onEdit } = $props<{
  entry: Entry;
  projectName: string;
  onEdit: () => void;
}>();

let html = $derived(marked.parse(entry.content, { async: false }) as string);
</script>

<div>
  <div class="flex items-center justify-between mb-4">
    <div>
      <h2 class="text-lg font-medium">{entry.path}</h2>
      <div class="text-xs mt-1" style="color: var(--color-text-muted);">
        <span class="inline-block rounded-full px-2 py-0.5 text-xs"
          style="background-color: var(--color-pink); color: white;">
          {entry.source}
        </span>
        <span class="ml-2">{new Date(entry.updated_at).toLocaleString()}</span>
        {#each entry.tags as tag}
          <span class="ml-1 inline-block rounded-full px-2 py-0.5"
            style="background-color: var(--color-accent); color: white;">
            {tag}
          </span>
        {/each}
      </div>
    </div>
    <button onclick={() => onEdit()}
      class="text-sm cursor-pointer" style="color: var(--color-link);">
      Edit
    </button>
  </div>
  <div class="prose rounded-xl p-5 text-sm"
    style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border); line-height: 1.7;">
    {@html html}
  </div>
</div>
