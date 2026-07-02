<script lang="ts">
import { enhance } from "$app/forms";

let { data, form } = $props();
let mode = $state<"login" | "signup">("login");
let loginMode = $state<"password" | "magic">("password");
let loading = $state(false);
// Device-limit picker state. The selected radio's value is sent as
// `revoke_key_id` in the revokeAndContinue action's form data.
let selectedRevokeId = $state<string | null>(null);

// Compact relative-time formatter. Shows "12m ago", "3h ago", "2d ago",
// "never used". Lighter than pulling in a date library for one widget.
function relativeTime(iso: string | null): string {
  if (!iso) return "never used";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "never used";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div style="position: fixed; inset: 0; pointer-events: none; overflow: hidden;">
    <div style="position: absolute; top: 20%; right: 20%; width: 350px; height: 350px; border-radius: 50%; background: rgba(86, 28, 36, 0.04); filter: blur(80px); animation: float-orb 20s ease-in-out infinite;"></div>
  </div>

  <div class="glass w-full max-w-md rounded-xl" style="padding: 2rem;">

    {#if data.authenticated && data.hasCli && form?.deviceLimit}
      <!-- BUG #5 picker: user hit the Free-tier device limit. List the
           existing devices + let them choose one to revoke so a slot
           opens up for the new device. -->
      <div class="text-center mb-6">
        <div style="font-size: 1.5rem; color: var(--color-accent); margin-bottom: 0.5rem;">&#9670;</div>
        <h1 class="text-xl font-semibold" style="color: var(--color-accent);">Device limit reached</h1>
        <p class="text-sm mt-1" style="color: var(--color-text-muted);">
          You're using {form.limit} of {form.limit} CLI device slots on the {form.tier === "plus" ? "Plus" : "Free"} plan.
          Pick a device to revoke so this one can sign in.
        </p>
      </div>

      <form method="POST" action="?/revokeAndContinue" use:enhance={() => {
        loading = true;
        return async ({ result, update }) => {
          loading = false;
          if (result.type === "success" && result.data?.redirectTo) {
            window.location.href = result.data.redirectTo as string;
            return;
          }
          await update();
        };
      }}>
        <input type="hidden" name="cli_challenge" value={data.challenge ?? ""} />
        <input type="hidden" name="cli_state" value={data.state ?? ""} />
        <input type="hidden" name="cli_port" value={data.port ?? ""} />
        <input type="hidden" name="cli_device" value={data.device ?? ""} />
        <input type="hidden" name="cli_machine_id" value={data.machine_id ?? ""} />

        <fieldset class="space-y-2 mb-4" style="border: none; padding: 0;">
          <legend class="sr-only">Devices to revoke</legend>
          {#each form.devices as device (device.id)}
            <label
              class="flex items-start gap-3 cursor-pointer"
              style="padding: 12px 14px; border-radius: 12px; border: 1px solid {selectedRevokeId === device.id ? 'var(--color-accent)' : 'var(--color-border)'}; background-color: {selectedRevokeId === device.id ? 'rgba(86, 28, 36, 0.04)' : 'transparent'}; transition: all 120ms ease;"
            >
              <input
                type="radio"
                name="revoke_key_id"
                value={device.id}
                bind:group={selectedRevokeId}
                required
                style="margin-top: 4px;"
              />
              <span class="flex-1 text-sm">
                <span class="font-medium" style="color: var(--color-text);">{device.name}</span>
                <span class="block text-xs mt-0.5" style="color: var(--color-text-muted);">
                  Last used {relativeTime(device.last_used_at)}
                </span>
              </span>
            </label>
          {/each}
        </fieldset>

        <button
          type="submit"
          disabled={loading || !selectedRevokeId}
          class="btn-primary w-full cursor-pointer"
        >
          {#if loading}
            <span class="flex items-center justify-center gap-2">
              <span class="spinner spinner-sm spinner-white"></span> Revoking + signing in...
            </span>
          {:else}
            Revoke selected device + continue
          {/if}
        </button>
      </form>
      <!-- A revoke failure returns { error } without deviceLimit, so the page
           falls through to the regular "Continue as" branch on next render —
           the user clicks Continue again, gets a fresh 409, and the picker
           reappears with up-to-date device list. Showing the inline error in
           the picker would require carrying the device list through revoke
           failures, which is a larger refactor for a transient error path. -->

      <div class="mt-4 text-center">
        <a href="/dashboard" class="text-sm" style="color: var(--color-link);">
          Cancel — manage devices on your account page instead
        </a>
      </div>

    {:else if data.authenticated && data.hasCli}
      <!-- Authenticated + CLI params but switch=1 was set — show account picker -->
      <div class="text-center mb-6">
        <div style="font-size: 1.5rem; color: var(--color-accent); margin-bottom: 0.5rem;">&#9670;</div>
        <h1 class="text-xl font-semibold" style="color: var(--color-accent);">Continue to Synapse</h1>
        <p class="text-sm mt-1" style="color: var(--color-text-muted);">Connecting from the terminal</p>
      </div>

      <form method="POST" action="?/continueAs" use:enhance={() => {
        loading = true;
        return async ({ result, update }) => {
          loading = false;
          if (result.type === "success" && result.data?.redirectTo) {
            window.location.href = result.data.redirectTo as string;
            return;
          }
          await update();
        };
      }}>
        <input type="hidden" name="cli_challenge" value={data.challenge ?? ""} />
        <input type="hidden" name="cli_state" value={data.state ?? ""} />
        <input type="hidden" name="cli_port" value={data.port ?? ""} />
        <input type="hidden" name="cli_device" value={data.device ?? ""} />
        <input type="hidden" name="cli_machine_id" value={data.machine_id ?? ""} />
        <button type="submit" disabled={loading} aria-label="Continue as {data.email}" class="btn-primary w-full cursor-pointer">
          {#if loading}
            <span class="flex items-center justify-center gap-2">
              <span class="spinner spinner-sm spinner-white"></span> Connecting...
            </span>
          {:else}
            Continue as {data.email}
          {/if}
        </button>
      </form>

      <div class="mt-4 text-center">
        <form method="POST" action="?/switchAccount" use:enhance>
          <input type="hidden" name="cli_challenge" value={data.challenge ?? ""} />
          <input type="hidden" name="cli_state" value={data.state ?? ""} />
          <input type="hidden" name="cli_port" value={data.port ?? ""} />
        <input type="hidden" name="cli_device" value={data.device ?? ""} />
          <button type="submit" class="cursor-pointer text-sm" style="color: var(--color-link);">
            Use a different account
          </button>
        </form>
      </div>

    {:else if data.authenticated && !data.hasCli}
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
        <input type="hidden" name="cli_device" value={data.device ?? ""} />
          <button type="submit" aria-label="Continue with Google" class="btn-secondary w-full cursor-pointer">
            Continue with Google
          </button>
        </form>
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="github" />
          <input type="hidden" name="cli_challenge" value={data.challenge ?? ""} />
          <input type="hidden" name="cli_state" value={data.state ?? ""} />
          <input type="hidden" name="cli_port" value={data.port ?? ""} />
        <input type="hidden" name="cli_device" value={data.device ?? ""} />
          <button type="submit" aria-label="Continue with GitHub" class="btn-secondary w-full cursor-pointer">
            Continue with GitHub
          </button>
        </form>
      </div>

      <div class="relative mb-6">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full" style="border-top: 1px solid var(--color-border);"></div>
        </div>
        <div class="relative flex justify-center text-xs">
          <span class="px-2" style="background-color: var(--color-bg); color: var(--color-text-muted);">or</span>
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
        <input type="hidden" name="cli_device" value={data.device ?? ""} />
            <label for="cli-login-email" class="sr-only">Email</label>
            <input id="cli-login-email" type="email" name="email" placeholder="Email" required
              value={form?.email ?? ""}
              class="w-full text-sm"
              style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            />
            <label for="cli-login-password" class="sr-only">Password</label>
            <input id="cli-login-password" type="password" name="password" placeholder="Password" required
              class="w-full text-sm"
              style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            />
            {#if form?.error}
              <p class="text-sm" role="alert" style="color: var(--color-danger);">{form.error}</p>
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
        <input type="hidden" name="cli_device" value={data.device ?? ""} />
            <label for="cli-magic-email" class="sr-only">Email</label>
            <input id="cli-magic-email" type="email" name="email" placeholder="Email" required
              value={form?.email ?? ""}
              class="w-full text-sm"
              style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            />
            {#if form?.error}
              <p class="text-sm" role="alert" style="color: var(--color-danger);">{form.error}</p>
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
        <input type="hidden" name="cli_device" value={data.device ?? ""} />
          <label for="cli-signup-email" class="sr-only">Email</label>
          <input id="cli-signup-email" type="email" name="email" placeholder="Email" required
            value={form?.email ?? ""}
            class="w-full text-sm"
            style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
          <label for="cli-signup-password" class="sr-only">Password</label>
          <input id="cli-signup-password" type="password" name="password" placeholder="Password (min 6 characters)"
            required minlength={6}
            class="w-full text-sm"
            style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
          {#if form?.error}
            <p class="text-sm" role="alert" style="color: var(--color-danger);">{form.error}</p>
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
