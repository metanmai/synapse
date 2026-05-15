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
    <a href="/" style="display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.8125rem; color: var(--color-text-muted); text-decoration: none; margin-bottom: 1.5rem; transition: color 0.2s;" onmouseenter={(e) => (e.currentTarget.style.color = 'var(--color-text)')} onmouseleave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      Back to home
    </a>

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
          <button type="submit" aria-label="Continue with Google" class="btn-secondary w-full cursor-pointer flex items-center justify-center gap-2">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </button>
        </form>
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="github" />
          <button type="submit" aria-label="Continue with GitHub" class="btn-secondary w-full cursor-pointer flex items-center justify-center gap-2">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
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
          <label for="login-email" class="sr-only">Email</label>
          <input id="login-email" type="email" name="email" placeholder="Email" required
            value={form?.email ?? ""}
            class="w-full text-sm"
            style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
          <label for="login-password" class="sr-only">Password</label>
          <input id="login-password" type="password" name="password" placeholder="Password" required
            class="w-full text-sm"
            style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
          <div class="text-right">
            <a href="/forgot-password" class="text-xs" style="color: var(--color-link);">Forgot password?</a>
          </div>
          {#if form?.error}
            <p class="text-sm" role="alert" style="color: var(--color-danger);">{form.error}</p>
          {/if}
          <button type="submit" disabled={loading}
            class="btn-primary w-full cursor-pointer"
          >
            {#if loading}
              <span class="flex items-center justify-center gap-2">
                <span class="spinner spinner-sm spinner-white"></span>
                Signing in...
              </span>
            {:else}
              Sign in
            {/if}
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
          <label for="magic-email" class="sr-only">Email</label>
          <input id="magic-email" type="email" name="email" placeholder="Email" required
            value={form?.email ?? ""}
            class="w-full text-sm"
            style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
          {#if form?.error}
            <p class="text-sm" role="alert" style="color: var(--color-danger);">{form.error}</p>
          {/if}
          <button type="submit" disabled={loading}
            class="btn-primary w-full cursor-pointer"
          >
            {#if loading}
              <span class="flex items-center justify-center gap-2">
                <span class="spinner spinner-sm spinner-white"></span>
                Sending...
              </span>
            {:else}
              Send magic link
            {/if}
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
