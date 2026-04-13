<script lang="ts">
import { enhance } from "$app/forms";
import { page } from "$app/stores";
import { encrypt, hasPassphrase } from "$lib/crypto";
import type { Entry } from "$lib/types";

let {
  entry,
  projectName,
  isNew = false,
  onCancel,
  pathPrefix = "",
} = $props<{
  entry?: Entry | null;
  projectName: string;
  isNew?: boolean;
  onCancel?: () => void;
  pathPrefix?: string;
}>();
</script>

<form method="POST" action="?/saveEntry" use:enhance={({ formData }) => {
  // Encrypt content client-side before sending to server
  const content = formData.get("content") as string;
  const userEmail = $page.data.user?.email;
  if (hasPassphrase() && userEmail && content) {
    // Replace form submission with async encryption
    return async ({ result, update }) => {
      const encrypted = await encrypt(content, userEmail);
      formData.set("content", encrypted);
      // Re-submit with encrypted content via fetch
      const res = await fetch("?/saveEntry", {
        method: "POST",
        body: formData,
      });
      const savedPath = (formData.get("path") as string)?.trim();
      if (res.ok && savedPath) {
        window.location.href = `/projects/${encodeURIComponent(projectName)}?path=${encodeURIComponent(savedPath)}`;
      } else {
        await update();
      }
    };
  }
  return async ({ result, update }) => {
    if (result.type === "success" && result.data?.savedPath) {
      window.location.href = `/projects/${encodeURIComponent(projectName)}?path=${encodeURIComponent(result.data.savedPath as string)}`;
    } else {
      await update();
    }
  };
}} class="glass space-y-4 editor-form">
  {#if isNew}
    <label for="editor-path" class="sr-only">File path</label>
    <input id="editor-path" type="text" name="path" placeholder="Path (e.g., decisions/chose-svelte.md)"
      required autofocus
      value={pathPrefix}
      class="w-full text-sm editor-input"
    />
  {:else}
    <input type="hidden" name="path" value={entry?.path ?? ""} />
    <div class="text-sm font-medium editor-label">
      Editing: {entry?.path}
    </div>
  {/if}
  <label for="editor-content" class="sr-only">Content (markdown)</label>
  <textarea id="editor-content" name="content" placeholder="Content (markdown)"
    class="w-full text-sm font-mono editor-input editor-textarea"
  >{entry?.content ?? ""}</textarea>
  <label for="editor-tags" class="sr-only">Tags (comma-separated)</label>
  <input id="editor-tags" type="text" name="tags" placeholder="Tags (comma-separated)"
    value={entry?.tags?.join(", ") ?? ""}
    class="w-full text-sm editor-input"
  />
  <div class="flex gap-2 items-center">
    <button type="submit" class="btn-primary cursor-pointer">
      Save
    </button>
    <button type="button" class="btn-secondary cursor-pointer"
      onclick={() => onCancel?.()}>
      Cancel
    </button>
  </div>
</form>

<style>
  .editor-form {
    padding: 2rem;
  }

  .editor-label {
    color: var(--color-text-muted);
  }

  .editor-input {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 12px 16px;
    transition: var(--transition-base);
    outline: none;
  }

  .editor-input:focus {
    border-color: var(--color-pink) !important;
    box-shadow: inset 0 2px 4px rgba(86, 28, 36, 0.06);
  }

  .editor-textarea {
    min-height: 400px;
    line-height: 1.6;
  }
</style>
