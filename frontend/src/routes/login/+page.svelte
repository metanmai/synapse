<script lang="ts">
import { enhance } from "$app/forms";

let { form } = $props();
let mode = $state<"password" | "magic">("password");
let loading = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div style="position: fixed; inset: 0; pointer-events: none; overflow: hidden;">
    <div style="position: absolute; top: 20%; right: 20%; width: 350px; height: 350px; border-radius: 50%; background: rgba(86, 28, 36, 0.04); filter: blur(80px); animation: float-orb 20s ease-in-out infinite;"></div>
  </div>

  <div class="glass w-full max-w-md rounded-xl" style="padding: 2rem;">

    {#if form?.magicLinkSent}
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2">Check your email</h2>
        <p class="text-sm" style="color: var(--color-text-muted);">
          We sent a login link to {form.email}
        </p>
      </div>
    {:else}
      <h1 class="text-xl font-semibold mb-6" style="color: var(--color-accent);">Sign in to Synapse</h1>

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

      {#if mode === "password"}
        <form method="POST" action="?/login" use:enhance={() => {
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
          <input type="password" name="password" placeholder="Password" required
            class="w-full text-sm"
            style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
          <div class="text-right">
            <a href="/forgot-password" class="text-xs" style="color: var(--color-link);">Forgot password?</a>
          </div>
          {#if form?.error}
            <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
          {/if}
          <button type="submit" disabled={loading}
            class="btn-primary w-full cursor-pointer"
            style={loading ? 'opacity: 0.6;' : ''}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      {:else}
        <form method="POST" action="?/magicLink" use:enhance={() => {
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
          {#if form?.error}
            <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
          {/if}
          <button type="submit" disabled={loading}
            class="btn-primary w-full cursor-pointer"
            style={loading ? 'opacity: 0.6;' : ''}
          >
            {loading ? "Sending..." : "Send magic link"}
          </button>
        </form>
      {/if}

      <div class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
        <button onclick={() => mode = mode === "password" ? "magic" : "password"}
          class="cursor-pointer" style="color: var(--color-link);">
          {mode === "password" ? "Use magic link instead" : "Use password instead"}
        </button>
      </div>

      <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
        Don't have an account?
        <a href="/signup" style="color: var(--color-link);">Sign up</a>
      </p>
    {/if}
  </div>
</div>
