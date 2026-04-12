<script lang="ts">
import { enhance } from "$app/forms";

let { form } = $props();
let loading = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="glass w-full max-w-md rounded-xl" style="padding: 2rem;">

    {#if form?.success}
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2">Check your email</h2>
        <p class="text-sm" style="color: var(--color-text-muted);">
          We sent a password reset link to {form.email}
        </p>
        <a href="/login" class="inline-block mt-4 text-sm" style="color: var(--color-link);">
          Back to login
        </a>
      </div>
    {:else}
      <h1 class="text-xl font-semibold mb-2" style="color: var(--color-accent);">Reset password</h1>
      <p class="text-sm mb-6" style="color: var(--color-text-muted);">
        Enter your email and we'll send you a link to reset your password.
      </p>

      <form method="POST" action="?/reset" use:enhance={() => {
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
        >
          {#if loading}
            <span class="flex items-center justify-center gap-2">
              <span class="spinner spinner-sm spinner-white"></span>
              Sending...
            </span>
          {:else}
            Send reset link
          {/if}
        </button>
      </form>

      <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
        <a href="/login" style="color: var(--color-link);">Back to login</a>
      </p>
    {/if}
  </div>
</div>
