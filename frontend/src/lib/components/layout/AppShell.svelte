<script lang="ts">
  import { enhance } from "$app/forms";

  let { user, children } = $props<{
    user: { id: string; email: string };
    children: import("svelte").Snippet;
  }>();
</script>

<div class="min-h-screen" style="background-color: var(--color-bg);">
  <header class="px-6 py-3 flex items-center justify-between"
    style="background-color: var(--color-bg-raised); border-bottom: 1px solid var(--color-border);">
    <a href="/" class="text-lg font-semibold" style="color: var(--color-text);">
      synapse
    </a>
    <div class="flex items-center gap-4">
      <span class="text-sm" style="color: var(--color-text-muted);">{user.email}</span>
      <a href="/account" class="text-sm" style="color: var(--color-link);">Account</a>
      <form method="POST" action="/logout" use:enhance>
        <button type="submit" class="text-sm cursor-pointer"
          style="color: var(--color-text-muted);">
          Sign out
        </button>
      </form>
    </div>
  </header>
  <main>
    {@render children()}
  </main>
</div>
