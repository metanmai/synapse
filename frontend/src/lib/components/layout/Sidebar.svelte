<script lang="ts">
  import { page } from "$app/stores";
  import { enhance } from "$app/forms";

  let { projectName, projects } = $props<{
    projectName: string;
    projects: { id: string; name: string; created_at: string }[];
  }>();

  let showNewProject = $state(false);

  const links = $derived([
    { href: `/projects/${encodeURIComponent(projectName)}`, label: "Workspace", exact: true },
    { href: `/projects/${encodeURIComponent(projectName)}/settings`, label: "Settings" },
    { href: `/projects/${encodeURIComponent(projectName)}/activity`, label: "Activity" },
  ]);
</script>

<nav class="w-48 flex flex-col"
  style="background-color: var(--color-bg-raised); border-right: 1px solid var(--color-border);">

  <!-- Projects section -->
  <div class="p-3 space-y-1" style="border-bottom: 1px solid var(--color-border);">
    <div class="flex items-center justify-between mb-1">
      <span class="text-xs font-medium uppercase tracking-wide"
        style="color: var(--color-accent);">Projects</span>
      <button onclick={() => showNewProject = !showNewProject}
        class="text-xs cursor-pointer" style="color: var(--color-link);">
        + New
      </button>
    </div>

    {#if showNewProject}
      <form method="POST" action="/?/createProject" use:enhance class="flex gap-1">
        <input type="text" name="name" placeholder="Name" required autofocus
          class="flex-1 min-w-0 rounded px-2 py-1 text-xs"
          style="border: 1px solid var(--color-border);"
        />
        <button type="submit"
          class="rounded px-2 py-1 text-xs font-medium cursor-pointer"
          style="background-color: var(--color-accent); color: white;">
          Go
        </button>
      </form>
    {/if}

    {#each projects as project}
      <a href="/projects/{encodeURIComponent(project.name)}"
        class="block px-2 py-1.5 rounded-lg text-sm truncate"
        style={project.name === projectName
          ? `background-color: var(--color-accent); color: white; font-weight: 500;`
          : `color: var(--color-text);`}
      >
        {project.name}
      </a>
    {/each}
  </div>

  <!-- Nav links for current project -->
  <div class="p-3 space-y-1">
    {#each links as link}
      {@const isActive = link.exact
        ? $page.url.pathname === link.href
        : $page.url.pathname.startsWith(link.href)}
      <a href={link.href}
        class="block px-3 py-2 rounded-lg text-sm"
        style={isActive
          ? `background-color: var(--color-pink-dark); color: white; font-weight: 500;`
          : `color: var(--color-text); `}
      >
        {link.label}
      </a>
    {/each}
  </div>
</nav>
