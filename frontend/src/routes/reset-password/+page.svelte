<script lang="ts">
import { enhance } from "$app/forms";

let { form } = $props();
let loading = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="w-full max-w-sm p-8 rounded-xl" style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">

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
        class="w-full rounded-lg px-3 py-2.5 text-sm"
        style="border: 1px solid var(--color-border);"
      />
      <input type="password" name="confirm" placeholder="Confirm password" required minlength="8"
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
        {loading ? "Updating..." : "Update password"}
      </button>
    </form>

  </div>
</div>
