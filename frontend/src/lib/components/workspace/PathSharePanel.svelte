<script lang="ts">
import { enhance } from "$app/forms";
import type { ShareLink } from "$lib/types";

let { path, isFolder, projectId, shareLinks, onClose } = $props<{
  path: string;
  isFolder: boolean;
  projectId: string;
  shareLinks: ShareLink[];
  onClose: () => void;
}>();

let copied = $state<string | null>(null);

function copyLink(token: string) {
  navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
  copied = token;
  setTimeout(() => (copied = null), 2000);
}
</script>

<div class="glass" style="padding: 2rem;">
  <div class="flex items-center justify-between mb-4">
    <div>
      <h2 class="text-lg font-medium" style="color: var(--color-accent);">Share</h2>
      <p class="text-xs mt-0.5 font-mono" style="color: var(--color-text-muted);">
        {path}{isFolder ? "/ (and all children)" : ""}
      </p>
    </div>
    <button onclick={onClose} class="btn-secondary cursor-pointer">
      Close
    </button>
  </div>

  <!-- Invite by email -->
  <div class="mb-6">
    <h3 class="text-xs font-medium uppercase tracking-wide mb-2"
      style="color: var(--color-accent);">Invite people</h3>
    <form method="POST" action="?/addMember" use:enhance class="flex gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="path" value={path} />
      <input type="email" name="email" placeholder="Email address" aria-label="Email address" required
        class="flex-1 rounded-lg px-2.5 py-2 text-xs"
        style="border: 1px solid var(--color-border);"
      />
      <select name="role" aria-label="Member role"
        class="rounded-lg px-2 py-2 text-xs"
        style="border: 1px solid var(--color-border);">
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      <button type="submit"
        class="rounded-lg px-3 py-2 text-xs font-medium cursor-pointer"
        style="background-color: var(--color-accent); color: white;">
        Invite
      </button>
    </form>
  </div>

  <!-- Share links -->
  <div>
    <h3 class="text-xs font-medium uppercase tracking-wide mb-2"
      style="color: var(--color-accent);">Share links</h3>
    <div class="flex gap-2 mb-3">
      <form method="POST" action="?/createLink" use:enhance>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="role" value="viewer" />
        <input type="hidden" name="path" value={path} />
        <button type="submit" class="rounded-lg px-2.5 py-1.5 text-xs cursor-pointer"
          style="border: 1px solid var(--color-pink); color: var(--color-pink-dark);">
          Viewer link
        </button>
      </form>
      <form method="POST" action="?/createLink" use:enhance>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="role" value="editor" />
        <input type="hidden" name="path" value={path} />
        <button type="submit" class="rounded-lg px-2.5 py-1.5 text-xs cursor-pointer"
          style="border: 1px solid var(--color-pink); color: var(--color-pink-dark);">
          Editor link
        </button>
      </form>
    </div>

    {#if shareLinks.length === 0}
      <p class="text-xs" style="color: var(--color-text-muted);">No share links yet</p>
    {:else}
      <div class="space-y-2">
        {#each shareLinks as link}
          <div class="flex items-center justify-between p-2 rounded-lg text-xs"
            style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
            <div class="flex items-center gap-2">
              <span class="font-mono">{link.token.slice(0, 10)}...</span>
              <span class="rounded-full px-2 py-0.5"
                style="background-color: var(--color-accent); color: white; font-size: 10px;">
                {link.role}
              </span>
            </div>
            <div class="flex gap-2">
              <button onclick={() => copyLink(link.token)}
                class="cursor-pointer" style="color: var(--color-link); font-size: 10px;">
                {copied === link.token ? "Copied!" : "Copy"}
              </button>
              <form method="POST" action="?/revokeLink" use:enhance class="inline">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="token" value={link.token} />
                <button type="submit" class="cursor-pointer"
                  style="color: var(--color-danger); font-size: 10px;">
                  Revoke
                </button>
              </form>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
