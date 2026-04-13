<script lang="ts">
import type { Entry } from "$lib/types";
import DOMPurify from "dompurify";
import { marked } from "marked";

let { entry, projectName, onEdit } = $props<{
  entry: Entry;
  projectName: string;
  onEdit?: () => void;
}>();

let html = $derived(DOMPurify.sanitize(marked.parse(entry.content, { async: false }) as string));
</script>

<div class="glass" style="padding: 2rem;">
  <div class="flex items-center justify-between mb-4">
    <div>
      <h2 style="font-size: 16px; font-weight: 600;">{entry.path}</h2>
      <div class="text-xs mt-1" style="color: var(--color-text-muted);">
        <span class="inline-block px-3 py-1"
          style="background-color: var(--color-pink); color: white; border-radius: 9999px; padding: 4px 12px;">
          {entry.source}
        </span>
        <span class="ml-2">{new Date(entry.updated_at).toLocaleString()}</span>
        {#each entry.tags as tag}
          <span class="ml-1 inline-block"
            style="background-color: var(--color-accent); color: white; border-radius: 9999px; padding: 4px 12px;">
            {tag}
          </span>
        {/each}
      </div>
    </div>
    <div class="flex items-center gap-2">
      <a href="/projects/{encodeURIComponent(projectName)}/history/{encodeURIComponent(entry.path)}"
        class="btn-secondary cursor-pointer" style="text-decoration: none;">
        History
      </a>
      {#if onEdit}
        <button onclick={() => onEdit()}
          class="btn-secondary cursor-pointer">
          Edit
        </button>
      {/if}
    </div>
  </div>
  <article class="prose rounded-xl p-5 text-sm"
    style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border); line-height: 1.7;">
    {@html html}
  </article>
</div>
