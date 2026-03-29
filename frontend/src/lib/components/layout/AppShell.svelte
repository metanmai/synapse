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
    <a href="/" class="flex items-center gap-2" style="color: white; font-size: 18px; font-weight: 800;">
      <img src="/logo.svg" alt="" class="w-7 h-7" />
      synapse
    </a>
    <div class="flex items-center gap-3 sm:gap-4">
      <span class="hidden sm:inline" style="font-size: 14px; color: rgba(255,255,255,0.75);">{user.email}</span>
      <a href="/account" style="font-size: 13px; font-weight: 500; color: white; transition: var(--transition-base);">Account</a>
      <form method="POST" action="/logout" use:enhance>
        <button type="submit" class="cursor-pointer"
          style="font-size: 13px; color: rgba(255,255,255,0.75); transition: var(--transition-base);">
          Sign out
        </button>
      </form>
    </div>
  </header>
  <main style="position: relative; z-index: 1;">
    {@render children()}
  </main>
</div>
