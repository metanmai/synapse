<script lang="ts">
  import { page } from "$app/stores";

  let { projectName } = $props<{ projectName: string }>();

  const links = $derived([
    { href: `/projects/${encodeURIComponent(projectName)}`, label: "Workspace", exact: true },
    { href: `/projects/${encodeURIComponent(projectName)}/settings`, label: "Settings" },
    { href: `/projects/${encodeURIComponent(projectName)}/activity`, label: "Activity" },
  ]);
</script>

<nav class="w-48 p-4 space-y-1"
  style="background-color: var(--color-bg-raised); border-right: 1px solid var(--color-border);">
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
</nav>
