<script lang="ts">
import { enhance } from "$app/forms";

let { user, children } = $props<{
  user: { id: string; email: string };
  children: import("svelte").Snippet;
}>();
</script>

<div class="min-h-screen" style="background-color: var(--color-bg); overflow-x: hidden;">
  <!-- Floating background orbs -->
  <div style="position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;">
    <div style="position: absolute; top: 10%; left: 15%; width: 400px; height: 400px; border-radius: 50%; background: rgba(86, 28, 36, 0.04); filter: blur(80px); animation: float-orb 20s ease-in-out infinite;"></div>
    <div style="position: absolute; bottom: 20%; right: 10%; width: 300px; height: 300px; border-radius: 50%; background: rgba(199, 183, 163, 0.08); filter: blur(60px); animation: float-orb 22s ease-in-out infinite reverse;"></div>
  </div>
  <header class="flex items-center justify-between"
    style="background: rgba(86, 28, 36, 0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: 0 4px 24px rgba(86, 28, 36, 0.15); padding: 1rem 1.5rem; position: sticky; top: 0; z-index: 50;">
    <a href="/dashboard" class="flex items-center gap-2" style="color: white; font-size: 18px; font-weight: 800; text-decoration: none;">
      <img src="/logo.svg" alt="" class="w-7 h-7" />
      synapse
    </a>
    <div class="flex items-center gap-2 sm:gap-3">
      <a href="/dashboard" class="nav-btn">Workspace</a>
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
</style>
