<script lang="ts">
import { enhance } from "$app/forms";
import { page } from "$app/stores";
import type { Project } from "$lib/types";

let {
  user,
  projects = [],
  children,
} = $props<{
  user: { id: string; email: string };
  projects?: Project[];
  children: import("svelte").Snippet;
}>();

let switcherOpen = $state(false);

let ownProjects = $derived(projects.filter((p: Project) => p.role === "owner"));
let sharedProjects = $derived(projects.filter((p: Project) => p.role !== "owner"));

let currentProjectName = $derived.by(() => {
  const match = $page.url.pathname.match(/^\/projects\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
});

let currentProject = $derived(
  projects.find((p: Project) => {
    if (p.role === "owner") return p.name === currentProjectName;
    return `${p.owner_email}~${p.name}` === currentProjectName;
  }),
);

function projectSlug(p: Project): string {
  return p.role === "owner" ? p.name : `${p.owner_email}~${p.name}`;
}

function projectLabel(p: Project): string {
  if (p.role === "owner") return p.name;
  const ownerName = p.owner_email?.split("@")[0] ?? "shared";
  return `${ownerName}'s ${p.name}`;
}
</script>

<svelte:window onclick={() => { if (switcherOpen) switcherOpen = false; }} />

<div class="min-h-screen" style="background-color: var(--color-bg); overflow-x: hidden;">
  <!-- Floating background orbs -->
  <div style="position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;">
    <div style="position: absolute; top: 10%; left: 15%; width: 400px; height: 400px; border-radius: 50%; background: rgba(86, 28, 36, 0.04); filter: blur(80px); animation: float-orb 20s ease-in-out infinite;"></div>
    <div style="position: absolute; bottom: 20%; right: 10%; width: 300px; height: 300px; border-radius: 50%; background: rgba(199, 183, 163, 0.08); filter: blur(60px); animation: float-orb 22s ease-in-out infinite reverse;"></div>
  </div>
  <header class="flex items-center justify-between"
    style="background: rgba(86, 28, 36, 0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: 0 4px 24px rgba(86, 28, 36, 0.15); padding: 1rem 1.5rem; position: sticky; top: 0; z-index: 50;">
    <div class="flex items-center gap-3">
      <a href="/dashboard" class="flex items-center gap-2" style="color: white; font-size: 18px; font-weight: 800; text-decoration: none;">
        <img src="/logo.svg" alt="Synapse logo" class="w-7 h-7" />
        synapse
      </a>
      {#if projects.length > 0}
        <div class="switcher-wrapper" onclick={(e) => e.stopPropagation()}>
          <button class="switcher-btn cursor-pointer"
            onclick={() => { switcherOpen = !switcherOpen; }}>
            <span class="switcher-label">{currentProject ? projectLabel(currentProject) : "Select workspace"}</span>
            <span class="switcher-chevron">{switcherOpen ? "▲" : "▼"}</span>
          </button>
          {#if switcherOpen}
            <div class="switcher-dropdown">
              {#if ownProjects.length > 0}
                <div class="switcher-group-label">My Workspaces</div>
                {#each ownProjects as p}
                  <a href={`/projects/${encodeURIComponent(projectSlug(p))}`}
                    class="switcher-item"
                    class:switcher-item-active={currentProject?.id === p.id}
                    onclick={() => { switcherOpen = false; }}>
                    {p.name}
                  </a>
                {/each}
              {/if}
              {#if sharedProjects.length > 0}
                <div class="switcher-group-label">Shared with me</div>
                {#each sharedProjects as p}
                  <a href={`/projects/${encodeURIComponent(projectSlug(p))}`}
                    class="switcher-item"
                    class:switcher-item-active={currentProject?.id === p.id}
                    onclick={() => { switcherOpen = false; }}>
                    <span>{p.name}</span>
                    <span class="switcher-owner">{p.owner_email?.split("@")[0]}</span>
                  </a>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    <div class="flex items-center gap-2 sm:gap-3">
      <a href="/account" class="nav-btn">Account</a>
      <span class="hidden sm:inline" style="font-size: 13px; color: rgba(255,255,255,0.4);">{user.email}</span>
      <form method="POST" action="/logout" use:enhance>
        <button type="submit" class="nav-btn nav-btn-ghost cursor-pointer">Sign out</button>
      </form>
    </div>
  </header>
  <main style="position: relative; z-index: 1;">
    {@render children()}
  </main>
</div>

<style>
  .nav-btn {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
    text-decoration: none;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.05);
    transition: all 150ms ease;
  }

  .nav-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.25);
    color: white;
  }

  .nav-btn-ghost {
    border-color: transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.5);
  }

  .nav-btn-ghost:hover {
    border-color: rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
  }

  .switcher-wrapper {
    position: relative;
  }

  .switcher-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.8);
    font-size: 13px;
    font-weight: 500;
    transition: all 150ms ease;
  }

  .switcher-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.25);
    color: white;
  }

  .switcher-chevron {
    font-size: 9px;
    opacity: 0.6;
  }

  .switcher-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 220px;
    background: var(--color-bg-raised, #fff);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
    padding: 6px;
    z-index: 100;
  }

  .switcher-group-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    padding: 6px 8px 4px;
  }

  .switcher-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--color-text);
    text-decoration: none;
    transition: background 150ms ease;
  }

  .switcher-item:hover {
    background: rgba(86, 28, 36, 0.06);
  }

  .switcher-item-active {
    background: rgba(86, 28, 36, 0.08);
    font-weight: 600;
  }

  .switcher-owner {
    font-size: 11px;
    color: var(--color-text-muted);
  }
</style>
