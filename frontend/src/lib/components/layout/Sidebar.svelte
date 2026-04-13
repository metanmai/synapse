<script lang="ts">
import { page } from "$app/stores";

let { projectName } = $props<{ projectName: string }>();

const navSections = $derived([
  {
    heading: "Feed",
    items: [{ href: `/projects/${encodeURIComponent(projectName)}/activity`, label: "Activity", icon: "📋" }],
  },
  {
    heading: "Sessions",
    items: [{ href: `/projects/${encodeURIComponent(projectName)}/conversations`, label: "Sessions", icon: "💬" }],
  },
  {
    heading: "Knowledge",
    items: [
      { href: `/projects/${encodeURIComponent(projectName)}/insights`, label: "Insights", icon: "💡" },
      { href: `/projects/${encodeURIComponent(projectName)}`, label: "Workspace", icon: "📁", exact: true },
    ],
  },
  {
    heading: "Project",
    items: [{ href: `/projects/${encodeURIComponent(projectName)}/settings`, label: "Settings", icon: "⚙️" }],
  },
]);
</script>

<nav class="sidebar">
  {#each navSections as section}
    <div class="sidebar-section">
      <div class="sidebar-heading">{section.heading}</div>
      {#each section.items as link}
        {@const isActive = link.exact
          ? $page.url.pathname === link.href
          : $page.url.pathname.startsWith(link.href)}
        <a href={link.href} class="sidebar-item" class:active={isActive}>
          <span class="item-icon">{link.icon}</span>
          <span class="item-text">{link.label}</span>
        </a>
      {/each}
    </div>
  {/each}
</nav>

<style>
  .sidebar {
    width: 11rem;
    min-width: 0;
    padding: 0.75rem;
    background: rgba(232, 216, 196, 0.15);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-right: 1px solid rgba(199, 183, 163, 0.2);
    flex-shrink: 0;
    overflow: hidden;
  }

  @media (max-width: 768px) {
    .sidebar {
      width: 100%;
      border-right: none;
      border-bottom: 1px solid rgba(199, 183, 163, 0.2);
    }
  }

  .sidebar-section {
    margin-bottom: 1.25rem;
  }

  .sidebar-heading {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
    padding-left: 0.5rem;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
    border-radius: 8px;
    font-size: 0.8125rem;
    color: var(--color-text);
    opacity: 0.65;
    text-decoration: none;
    transition: background 0.15s, opacity 0.15s, transform 0.15s;
  }

  .sidebar-item:hover {
    background: rgba(86, 28, 36, 0.05);
    opacity: 0.85;
    transform: scale(1.02);
  }

  .sidebar-item.active {
    background: rgba(86, 28, 36, 0.08);
    opacity: 1;
    font-weight: 600;
  }

  .item-icon {
    font-size: 0.875rem;
    line-height: 1;
  }

  .item-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
