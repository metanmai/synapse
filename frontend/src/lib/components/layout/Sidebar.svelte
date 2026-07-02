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
  style="background: rgba(255, 253, 248, 0.5); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 4px 0 24px rgba(86, 28, 36, 0.04);">
  {#each links as link}
    {@const isActive = link.exact
      ? $page.url.pathname === link.href
      : $page.url.pathname.startsWith(link.href)}
    <a href={link.href}
      class="block px-3 py-2.5"
      style="font-size: 14px; border-radius: 12px; transition: var(--transition-base); {isActive
        ? `background: rgba(86, 28, 36, 0.12); border-left: 3px solid var(--color-pink-dark); color: var(--color-text); font-weight: 600;`
        : `color: var(--color-text);`}"
    >
      {link.label}
    </a>
  {/each}
</nav>
