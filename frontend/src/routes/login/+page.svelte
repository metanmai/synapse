<script lang="ts">
  import { enhance } from "$app/forms";

  let { form } = $props();
  let mode = $state<"password" | "magic">("password");
  let loading = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="w-full max-w-sm p-8 rounded-xl" style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">

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
          <button type="submit"
            class="w-full rounded-lg px-4 py-2.5 text-sm cursor-pointer"
            style="border: 1px solid var(--color-pink); color: var(--color-pink-dark); background: var(--color-bg-raised);"
          >
            Continue with Google
          </button>
        </form>
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="github" />
          <button type="submit"
            class="w-full rounded-lg px-4 py-2.5 text-sm cursor-pointer"
            style="border: 1px solid var(--color-pink); color: var(--color-pink-dark); background: var(--color-bg-raised);"
          >
            Continue with GitHub
          </button>
        </form>
      </div>

      <div class="relative mb-6">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full" style="border-top: 1px solid var(--color-border);"></div>
        </div>
        <div class="relative flex justify-center text-xs">
          <span class="px-2" style="background-color: var(--color-bg-raised); color: var(--color-text-muted);">or</span>
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
            class="w-full rounded-lg px-3 py-2.5 text-sm"
            style="border: 1px solid var(--color-border);"
          />
          <input type="password" name="password" placeholder="Password" required
            class="w-full rounded-lg px-3 py-2.5 text-sm"
            style="border: 1px solid var(--color-border);"
          />
          <div class="text-right">
            <a href="/forgot-password" class="text-xs" style="color: var(--color-link);">Forgot password?</a>
          </div>
          {#if form?.error}
            <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
          {/if}
          <button type="submit" disabled={loading}
            class="w-full rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
            style="background-color: var(--color-accent); color: white; opacity: {loading ? 0.6 : 1};"
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
            class="w-full rounded-lg px-3 py-2.5 text-sm"
            style="border: 1px solid var(--color-border);"
          />
          {#if form?.error}
            <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
          {/if}
          <button type="submit" disabled={loading}
            class="w-full rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer"
            style="background-color: var(--color-accent); color: white; opacity: {loading ? 0.6 : 1};"
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
