<script lang="ts">
  import { enhance } from "$app/forms";

  let { form } = $props();
</script>

<div class="flex items-center justify-center" style="height: calc(100vh - 49px);">
  <div class="text-center max-w-sm">
    <img src="/logo.svg" alt="Synapse" class="w-16 h-16 mx-auto mb-4 opacity-50" />
    <h1 class="text-xl font-semibold mb-2" style="color: var(--color-accent);">Welcome to Synapse</h1>
    <p class="text-sm mb-6" style="color: var(--color-text-muted);">
      Create your first project to get started.
    </p>
    <form method="POST" action="?/createProject" use:enhance class="flex gap-2">
      <input type="text" name="name" placeholder="Project name" required autofocus
        class="flex-1 rounded-lg px-3 py-2.5 text-sm"
        style="border: 1px solid var(--color-border);"
      />
      <button type="submit"
        class="rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
        style="background-color: var(--color-accent); color: white;">
        Create
      </button>
    </form>
    {#if form?.error}
      <p class="text-sm mt-2" style="color: var(--color-danger);">{form.error}</p>
    {/if}
  </div>
</div>
