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
      <label for="new-password" class="sr-only">New password</label>
      <input id="new-password" type="password" name="password" placeholder="New password" required minlength="8"
        class="w-full text-sm"
        style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
      />
      <label for="confirm-password" class="sr-only">Confirm password</label>
      <input id="confirm-password" type="password" name="confirm" placeholder="Confirm password" required minlength="8"
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
            Updating...
          </span>
        {:else}
          Update password
        {/if}
      </button>
    </form>

  </div>
</div>
