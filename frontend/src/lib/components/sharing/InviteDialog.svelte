<script lang="ts">
  import { enhance } from "$app/forms";

  let { error, projectId } = $props<{ error?: string | null; projectId: string }>();
</script>

<form method="POST" action="?/addMember" use:enhance class="flex gap-2 items-end">
  <input type="hidden" name="projectId" value={projectId} />
  <input type="email" name="email" placeholder="Email address" required
    class="flex-1 rounded-lg px-3 py-2.5 text-sm"
    style="border: 1px solid var(--color-border);"
  />
  <select name="role"
    class="rounded-lg px-3 py-2.5 text-sm"
    style="border: 1px solid var(--color-border);">
    <option value="editor">Editor</option>
    <option value="viewer">Viewer</option>
  </select>
  <button type="submit"
    class="rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
    style="background-color: var(--color-accent); color: var(--color-text);">
    Invite
  </button>
</form>
{#if error}
  <p class="mt-2 text-sm" style="color: var(--color-danger);">{error}</p>
{/if}
