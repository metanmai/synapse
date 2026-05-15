<script lang="ts">
  import { enhance } from "$app/forms";

  let { user, children } = $props<{
    user: { id: string; email: string };
    children: import("svelte").Snippet;
  }>();
</script>

<div class="min-h-screen" style="background-color: var(--color-bg);">
  <header class="px-6 py-3 flex items-center justify-between"
    style="background-color: var(--color-accent);">
    <a href="/" class="text-lg font-semibold" style="color: white;">
      synapse
    </a>
    <div class="flex items-center gap-4">
      <span class="text-sm" style="color: rgba(255,255,255,0.75);">{user.email}</span>
      <a href="/account" class="text-sm font-medium" style="color: white;">Account</a>
      <form method="POST" action="/logout" use:enhance>
        <button type="submit" class="text-sm cursor-pointer"
          style="color: rgba(255,255,255,0.75);">
          Sign out
        </button>
      </form>
    </div>
  </header>
  <main>
    {@render children()}
  </main>
</div>
