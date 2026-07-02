<script lang="ts">
  import { enhance } from "$app/forms";
  import type { ShareLink } from "$lib/types";

  let { links, projectId } = $props<{ links: ShareLink[]; projectId: string }>();
  let copied = $state<string | null>(null);

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
    copied = token;
    setTimeout(() => (copied = null), 2000);
  }
</script>

<div>
  <div class="flex gap-2 mb-4">
    <form method="POST" action="?/createLink" use:enhance>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="role" value="viewer" />
      <button type="submit" class="rounded-lg px-3 py-2 text-sm cursor-pointer"
        style="border: 1px solid var(--color-border);">
        Create viewer link
      </button>
    </form>
    <form method="POST" action="?/createLink" use:enhance>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="role" value="editor" />
      <button type="submit" class="rounded-lg px-3 py-2 text-sm cursor-pointer"
        style="border: 1px solid var(--color-border);">
        Create editor link
      </button>
    </form>
  </div>

  <div class="space-y-2">
    {#each links as link}
      <div class="flex items-center justify-between p-3 rounded-xl text-sm"
        style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
        <div>
          <span class="font-mono text-xs">{link.token.slice(0, 12)}...</span>
          <span class="ml-2 text-xs rounded-full px-2 py-0.5"
            style="background-color: var(--color-bg-muted);">
            {link.role}
          </span>
        </div>
        <div class="flex gap-3">
          <button onclick={() => copyLink(link.token)}
            class="text-xs cursor-pointer" style="color: var(--color-accent);">
            {copied === link.token ? "Copied!" : "Copy"}
          </button>
          <form method="POST" action="?/revokeLink" use:enhance class="inline">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="token" value={link.token} />
            <button type="submit" class="text-xs cursor-pointer"
              style="color: var(--color-danger);">
              Revoke
            </button>
          </form>
        </div>
      </div>
    {/each}
    {#if links.length === 0}
      <p class="text-sm" style="color: var(--color-text-muted);">No share links yet</p>
    {/if}
  </div>
</div>
