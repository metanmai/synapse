<script lang="ts">
import { enhance } from "$app/forms";

let { data, form } = $props();
let mode = $state<"login" | "signup">("login");
let loginMode = $state<"password" | "magic">("password");
let loading = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div style="position: fixed; inset: 0; pointer-events: none; overflow: hidden;">
    <div style="position: absolute; top: 20%; right: 20%; width: 350px; height: 350px; border-radius: 50%; background: rgba(86, 28, 36, 0.04); filter: blur(80px); animation: float-orb 20s ease-in-out infinite;"></div>
  </div>

  <div class="glass w-full max-w-md rounded-xl" style="padding: 2rem;">

    {#if data.authenticated && !data.hasCli}
      <!-- Authenticated but no CLI params — just show success -->
      <div class="text-center">
        <div style="font-size: 2rem; color: var(--color-accent); margin-bottom: 1rem;">&#9670;</div>
        <h2 class="text-lg font-semibold mb-2">You're signed in!</h2>
        <p class="text-sm" style="color: var(--color-text-muted);">
          You can close this tab and return to your terminal.
        </p>
      </div>

    {:else if form?.magicLinkSent}
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2">Check your email</h2>
        <p class="text-sm" style="color: var(--color-text-muted);">
          We sent a login link to {form.email}. Click it to complete setup in your terminal.
        </p>
      </div>

    {:else if form?.signupSuccess}
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2">Check your email</h2>
        <p class="text-sm mb-4" style="color: var(--color-text-muted);">
          We sent a confirmation link to {form.email}
        </p>
        <p class="text-xs" style="color: var(--color-text-muted);">
          After confirming, come back here and sign in to connect your terminal.
        </p>
      </div>

    {:else}
      <div class="text-center mb-6">
        <div style="font-size: 1.5rem; color: var(--color-accent); margin-bottom: 0.5rem;">&#9670;</div>
        <h1 class="text-xl font-semibold" style="color: var(--color-accent);">
          {mode === "login" ? "Sign in to Synapse" : "Create your account"}
        </h1>
        <p class="text-sm mt-1" style="color: var(--color-text-muted);">Connecting from the terminal</p>
      </div>

      <!-- OAuth buttons -->
      <div class="space-y-3 mb-6">
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="google" />
          <input type="hidden" name="cli_challenge" value={data.challenge ?? ""} />
          <input type="hidden" name="cli_state" value={data.state ?? ""} />
          <input type="hidden" name="cli_port" value={data.port ?? ""} />
          <button type="submit" class="btn-secondary w-full cursor-pointer">
            Continue with Google
          </button>
        </form>
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="github" />
          <input type="hidden" name="cli_challenge" value={data.challenge ?? ""} />
          <input type="hidden" name="cli_state" value={data.state ?? ""} />
          <input type="hidden" name="cli_port" value={data.port ?? ""} />
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

      {#if mode === "login"}
        {#if loginMode === "password"}
          <form method="POST" action="?/login" use:enhance={() => {
            loading = true;
            return async ({ update }) => {
              loading = false;
              await update();
            };
          }} class="space-y-4">
            <input type="hidden" name="cli_challenge" value={data.challenge ?? ""} />
            <input type="hidden" name="cli_state" value={data.state ?? ""} />
            <input type="hidden" name="cli_port" value={data.port ?? ""} />
            <input type="email" name="email" placeholder="Email" required
              value={form?.email ?? ""}
              class="w-full text-sm"
              style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            />
            <input type="password" name="password" placeholder="Password" required
              class="w-full text-sm"
              style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            />
            {#if form?.error}
              <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
            {/if}
            <button type="submit" disabled={loading} class="btn-primary w-full cursor-pointer">
              {#if loading}
                <span class="flex items-center justify-center gap-2">
                  <span class="spinner spinner-sm spinner-white"></span> Signing in...
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
            <input type="hidden" name="cli_challenge" value={data.challenge ?? ""} />
            <input type="hidden" name="cli_state" value={data.state ?? ""} />
            <input type="hidden" name="cli_port" value={data.port ?? ""} />
            <input type="email" name="email" placeholder="Email" required
              value={form?.email ?? ""}
              class="w-full text-sm"
              style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            />
            {#if form?.error}
              <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
            {/if}
            <button type="submit" disabled={loading} class="btn-primary w-full cursor-pointer">
              {#if loading}
                <span class="flex items-center justify-center gap-2">
                  <span class="spinner spinner-sm spinner-white"></span> Sending...
                </span>
              {:else}
                Send magic link
              {/if}
            </button>
          </form>
        {/if}

        <div class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
          <button onclick={() => loginMode = loginMode === "password" ? "magic" : "password"}
            class="cursor-pointer" style="color: var(--color-link);">
            {loginMode === "password" ? "Use magic link instead" : "Use password instead"}
          </button>
        </div>

        <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
          Don't have an account?
          <button onclick={() => mode = "signup"} class="cursor-pointer" style="color: var(--color-link);">Sign up</button>
        </p>

      {:else}
        <!-- Signup mode -->
        <form method="POST" action="?/signup" use:enhance={() => {
          loading = true;
          return async ({ update }) => {
            loading = false;
            await update();
          };
        }} class="space-y-4">
          <input type="hidden" name="cli_challenge" value={data.challenge ?? ""} />
          <input type="hidden" name="cli_state" value={data.state ?? ""} />
          <input type="hidden" name="cli_port" value={data.port ?? ""} />
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
          <button type="submit" disabled={loading} class="btn-primary w-full cursor-pointer">
            {#if loading}
              <span class="flex items-center justify-center gap-2">
                <span class="spinner spinner-sm spinner-white"></span> Creating account...
              </span>
            {:else}
              Create account
            {/if}
          </button>
        </form>

        <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
          Already have an account?
          <button onclick={() => mode = "login"} class="cursor-pointer" style="color: var(--color-link);">Sign in</button>
        </p>
      {/if}
    {/if}
  </div>
</div>
