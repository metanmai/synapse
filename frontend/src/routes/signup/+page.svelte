<script lang="ts">
import { enhance } from "$app/forms";
import { onMount } from "svelte";

let { form } = $props();
let loading = $state(false);

// Poll for email confirmation when showing "check your email" screen
onMount(() => {
  if (!form?.success) return;

  const interval = setInterval(async () => {
    try {
      const res = await fetch("/dashboard", { redirect: "manual" });
      if (res.status === 200 || res.status === 303 || res.type === "opaqueredirect") {
        clearInterval(interval);
        window.location.href = "/dashboard";
      }
    } catch {}
  }, 3000);

  return () => clearInterval(interval);
});
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div style="position: fixed; inset: 0; pointer-events: none; overflow: hidden;">
    <div style="position: absolute; top: 20%; right: 20%; width: 350px; height: 350px; border-radius: 50%; background: rgba(86, 28, 36, 0.04); filter: blur(80px); animation: float-orb 20s ease-in-out infinite;"></div>
  </div>

  <div class="glass w-full max-w-md rounded-xl" style="padding: 2rem;">

    {#if form?.success}
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2">Check your email</h2>
        <p class="text-sm mb-4" style="color: var(--color-text-muted);">
          We sent a confirmation link to {form.email}
        </p>
        <div class="flex items-center justify-center gap-2 text-xs" style="color: var(--color-text-muted);">
          <span class="polling-dot"></span>
          Waiting for confirmation...
        </div>
      </div>
    {:else}
      <h1 class="text-xl font-semibold mb-6" style="color: var(--color-accent);">Create your account</h1>

      <div class="space-y-3 mb-6">
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="google" />
          <button type="submit" class="btn-secondary w-full cursor-pointer">
            Continue with Google
          </button>
        </form>
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="github" />
          <button type="submit" class="btn-secondary w-full cursor-pointer">
            Continue with GitHub
          </button>
        </form>
      </div>

      <div class="relative mb-6">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full" style="border-top: 1px solid var(--color-border);"></div>
        </div>
        <div class="relative flex justify-center text-xs">
          <span class="px-2" style="background-color: transparent; color: var(--color-text-muted);">or</span>
        </div>
      </div>

      <form method="POST" action="?/signup" use:enhance={() => {
        loading = true;
        return async ({ update }) => {
          loading = false;
          await update();
        };
      }} class="space-y-4">
        <input type="email" name="email" placeholder="Email" required
          value={form?.email ?? ""}
          class="w-full text-sm"
          style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
        />
        <input type="password" name="password" placeholder="Password (min 6 characters)"
          required minlength={6}
          class="w-full text-sm"
          style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
        />
        {#if form?.error}
          <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
        {/if}
        <button type="submit" disabled={loading}
          class="btn-primary w-full cursor-pointer"
        >
          {#if loading}
            <span class="flex items-center justify-center gap-2">
              <span class="spinner spinner-sm spinner-white"></span>
              Creating account...
            </span>
          {:else}
            Create account
          {/if}
        </button>
      </form>

      <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
        Already have an account?
        <a href="/login" style="color: var(--color-link);">Sign in</a>
      </p>
    {/if}
  </div>
</div>

<style>
  .polling-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--color-accent);
    animation: pulse-dot 1.5s ease-in-out infinite;
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
</style>
