<script lang="ts">
  import { enhance } from "$app/forms";
  import type { ProjectMember } from "$lib/types";

  let { members, projectId } = $props<{ members: ProjectMember[]; projectId: string }>();
</script>

<div class="space-y-2">
  {#each members as member}
    <div class="flex items-center justify-between p-3 rounded-xl"
      style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
      <div>
        <span class="text-sm">{member.email ?? member.user_id}</span>
        <span class="ml-2 text-xs rounded-full px-2 py-0.5"
          style="background-color: var(--color-accent); color: white;">
          {member.role}
        </span>
      </div>
      {#if member.role !== "owner"}
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
  {/each}
</div>
