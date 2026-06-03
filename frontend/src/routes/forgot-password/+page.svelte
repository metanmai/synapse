<script lang="ts">
  import { enhance } from "$app/forms";

  let { form } = $props();
  let loading = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="w-full max-w-sm p-8 rounded-xl" style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">

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
          {loading ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
        <a href="/login" style="color: var(--color-link);">Back to login</a>
      </p>
    {/if}
  </div>
</div>
