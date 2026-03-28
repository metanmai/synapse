<script lang="ts">
import { enhance } from "$app/forms";
import { goto } from "$app/navigation";

let { form } = $props();

$effect(() => {
  if (form?.success) {
    setTimeout(() => goto("/"), 2000);
  }
});
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="max-w-sm w-full p-8 rounded-xl text-center"
    style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
    {#if form?.success}
      <p style="color: var(--color-success);">Joined! Redirecting to dashboard...</p>
    {:else if form?.error}
      <p style="color: var(--color-danger);">{form.error}</p>
      <a href="/" class="inline-block mt-4 text-sm" style="color: var(--color-link);">
        Go to dashboard
      </a>
    {:else}
      <p class="mb-4" style="color: var(--color-text-muted);">
        You've been invited to join a project.
      </p>
      <form method="POST" action="?/join" use:enhance>
        <button type="submit"
          class="rounded-lg px-6 py-2.5 text-sm font-medium cursor-pointer"
          style="background-color: var(--color-accent); color: white;">
          Accept Invite
        </button>
      </form>
    {/if}
  </div>
</div>
