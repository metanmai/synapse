<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();
  let showCreate = $state(false);
</script>

<div class="max-w-3xl mx-auto p-8">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-semibold">Projects</h1>
      <p class="text-sm mt-1" style="color: var(--color-text-muted);">
        {data.projects.length} project{data.projects.length !== 1 ? "s" : ""}
      </p>
    </div>
    <button onclick={() => showCreate = true}
      class="rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
      style="background-color: var(--color-accent); color: white;">
      New Project
    </button>
  </div>

  {#if showCreate}
    <form method="POST" action="?/createProject" use:enhance={() => {
      return async ({ update }) => {
        await update();
        showCreate = false;
      };
    }} class="mb-6 flex gap-2">
      <input type="text" name="name" placeholder="Project name" required autofocus
        class="flex-1 rounded-lg px-3 py-2.5 text-sm"
        style="border: 1px solid var(--color-border);"
      />
      <button type="submit"
        class="rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
        style="background-color: var(--color-accent); color: white;">
        Create
      </button>
      <button type="button" onclick={() => showCreate = false}
        class="text-sm cursor-pointer" style="color: var(--color-text-muted);">
        Cancel
      </button>
    </form>
    {#if form?.error}
      <p class="text-sm mb-4" style="color: var(--color-danger);">{form.error}</p>
    {/if}
  {/if}

  {#if data.error}
    <div class="p-4 rounded-xl mb-4" style="background-color: var(--color-bg-muted); border: 1px solid var(--color-border);">
      <p class="text-sm" style="color: var(--color-danger);">{data.error}</p>
    </div>
  {:else if data.projects.length === 0}
    <p style="color: var(--color-text-muted);">No projects yet. Create one to get started.</p>
  {:else}
    <div class="space-y-2">
      {#each data.projects as project}
        <a href="/projects/{encodeURIComponent(project.name)}"
          class="block p-4 rounded-xl transition-colors"
          style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
          <div class="font-medium">{project.name}</div>
          <div class="text-sm mt-1" style="color: var(--color-text-muted);">
            Created {new Date(project.created_at).toLocaleDateString()}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
