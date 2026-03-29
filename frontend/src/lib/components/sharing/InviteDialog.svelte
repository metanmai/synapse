<script lang="ts">
import { enhance } from "$app/forms";

let { error, projectId } = $props<{ error?: string | null; projectId: string }>();
</script>

<form method="POST" action="?/addMember" use:enhance class="flex gap-2 items-end">
  <input type="hidden" name="projectId" value={projectId} />
  <div class="flex-1">
    <label for="invite-email" class="sr-only">Email address</label>
    <input id="invite-email" type="email" name="email" placeholder="Email address" required
      class="w-full rounded-lg px-3 py-2.5 text-sm"
      style="border: 1px solid var(--color-border);"
    />
  </div>
  <div>
    <label for="invite-role" class="sr-only">Role</label>
    <select id="invite-role" name="role"
      class="rounded-lg px-3 py-2.5 text-sm"
      style="border: 1px solid var(--color-border);">
      <option value="editor">Editor</option>
      <option value="viewer">Viewer</option>
    </select>
  </div>
  <button type="submit"
    class="rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
    style="background-color: var(--color-accent); color: white;">
    Invite
  </button>
</form>
{#if error}
  <p class="mt-2 text-sm" role="alert" style="color: var(--color-danger);">{error}</p>
{/if}
