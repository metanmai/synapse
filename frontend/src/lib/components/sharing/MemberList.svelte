<script lang="ts">
import { enhance } from "$app/forms";
import type { ProjectMember } from "$lib/types";

let { members, projectId } = $props<{ members: ProjectMember[]; projectId: string }>();
</script>

<div class="space-y-2">
  {#each members as member}
    <div class="flex items-center justify-between p-3 rounded-xl"
      style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
      <span class="text-sm">{member.email ?? member.user_id}</span>
      <div class="flex items-center gap-3">
        {#if member.role === "owner"}
          <span class="text-xs rounded-full px-2 py-0.5"
            style="background-color: var(--color-accent); color: white;">
            owner
          </span>
        {:else}
          <form method="POST" action="?/updateRole" use:enhance>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="email" value={member.email ?? ""} />
            <select name="role"
              class="text-xs rounded-lg px-2 py-1 cursor-pointer"
              style="border: 1px solid var(--color-border); background: var(--color-bg);"
              onchange={(e) => e.currentTarget.form?.requestSubmit()}>
              <option value="editor" selected={member.role === "editor"}>Editor</option>
              <option value="viewer" selected={member.role === "viewer"}>Viewer</option>
            </select>
          </form>
          <form method="POST" action="?/removeMember" use:enhance>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="email" value={member.email ?? ""} />
            <button type="submit" class="text-xs cursor-pointer"
              style="color: var(--color-danger);">
              Remove
            </button>
          </form>
        {/if}
      </div>
    </div>
  {/each}
</div>
