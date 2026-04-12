<script lang="ts">
  import { page } from "$app/stores";

  let { projectName } = $props<{ projectName: string }>();

  const links = $derived([
    { href: `/projects/${encodeURIComponent(projectName)}`, label: "Workspace", exact: true },
    { href: `/projects/${encodeURIComponent(projectName)}/settings`, label: "Settings" },
    { href: `/projects/${encodeURIComponent(projectName)}/activity`, label: "Activity" },
  ]);
</script>

<nav class="w-40 p-3 space-y-0.5"
  style="background-color: var(--color-bg-raised); border-right: 1px solid var(--color-border);">
  {#each links as link}
    {@const isActive = link.exact
      ? $page.url.pathname === link.href
      : $page.url.pathname.startsWith(link.href)}
    <a href={link.href}
      class="block px-2.5 py-1.5 rounded-lg"
      style="font-size: 12px; {isActive
        ? `background-color: var(--color-pink-dark); color: white; font-weight: 500;`
        : `color: var(--color-text);`}"
    >
      {link.label}
    </a>
  {/each}
</nav>
