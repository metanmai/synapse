<script lang="ts">
import { enhance } from "$app/forms";

let { form } = $props();
let loading = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="glass w-full max-w-md rounded-xl" style="padding: 2rem;">

    <h1 class="text-xl font-semibold mb-2" style="color: var(--color-accent);">Set new password</h1>
    <p class="text-sm mb-6" style="color: var(--color-text-muted);">
      Choose a new password for your account.
    </p>

    <form method="POST" use:enhance={() => {
      loading = true;
      return async ({ update }) => {
        loading = false;
        await update();
      };
    }} class="space-y-4">
      <input type="password" name="password" placeholder="New password" required minlength="8"
        class="w-full text-sm"
        style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
      />
      <input type="password" name="confirm" placeholder="Confirm password" required minlength="8"
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
        {loading ? "Updating..." : "Update password"}
      </button>
    </form>

  </div>
</div>
