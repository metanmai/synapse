<script lang="ts">
  import { enhance } from "$app/forms";
  import type { Entry } from "$lib/types";

  let { entry, projectName, isNew = false } = $props<{
    entry?: Entry | null;
    projectName: string;
    isNew?: boolean;
  }>();
</script>

<form method="POST" action="?/saveEntry" use:enhance={() => {
  return async ({ result, update }) => {
    if (result.type === "success" && result.data?.savedPath) {
      window.location.href = `/projects/${encodeURIComponent(projectName)}?path=${encodeURIComponent(result.data.savedPath as string)}`;
    } else {
      await update();
    }
  };
}} class="space-y-4">
  {#if isNew}
    <input type="text" name="path" placeholder="Path (e.g., decisions/chose-svelte.md)"
      required autofocus
      class="w-full rounded-lg px-3 py-2.5 text-sm"
      style="border: 1px solid var(--color-border);"
    />
  {:else}
    <input type="hidden" name="path" value={entry?.path ?? ""} />
    <div class="text-sm font-medium" style="color: var(--color-text-muted);">
      Editing: {entry?.path}
    </div>
  {/if}
  <textarea name="content" placeholder="Content (markdown)"
    class="w-full rounded-lg px-3 py-2.5 text-sm font-mono"
    style="border: 1px solid var(--color-border); min-height: 400px; line-height: 1.6;"
  >{entry?.content ?? ""}</textarea>
  <input type="text" name="tags" placeholder="Tags (comma-separated)"
    value={entry?.tags?.join(", ") ?? ""}
    class="w-full rounded-lg px-3 py-2.5 text-sm"
    style="border: 1px solid var(--color-border);"
  />
  <div class="flex gap-2">
    <button type="submit"
      class="rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
      style="background-color: var(--color-accent); color: var(--color-text);">
      Save
    </button>
    <a href="/projects/{encodeURIComponent(projectName)}{entry ? `?path=${encodeURIComponent(entry.path)}` : ''}"
      class="rounded-lg px-4 py-2.5 text-sm cursor-pointer"
      style="color: var(--color-text-muted);">
      Cancel
    </a>
  </div>
</form>
