<script lang="ts">
import { enhance } from "$app/forms";
</script>

<div class="glass rounded-xl" style="padding: 2rem;">
  <h3 style="font-size: 18px; font-weight: 700; color: var(--color-accent);" class="mb-3">Connected Accounts</h3>
  <div class="space-y-2">
    <form method="POST" action="?/connectOAuth" use:enhance>
      <input type="hidden" name="provider" value="google" />
      <button type="submit" class="btn-secondary w-full text-left cursor-pointer">
        Link Google Account
      </button>
    </form>
    <form method="POST" action="?/connectOAuth" use:enhance>
      <input type="hidden" name="provider" value="github" />
      <button type="submit" class="btn-secondary w-full text-left cursor-pointer">
        Link GitHub Account
      </button>
    </form>
  </div>
</div>
