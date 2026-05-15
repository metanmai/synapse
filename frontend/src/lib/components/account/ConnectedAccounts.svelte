<script lang="ts">
  import { enhance } from "$app/forms";
</script>

<div class="p-4 rounded-xl"
  style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
  <h3 class="font-medium mb-3">Connected Accounts</h3>
  <div class="space-y-2">
    <form method="POST" action="?/connectOAuth" use:enhance>
      <input type="hidden" name="provider" value="google" />
      <button type="submit" class="w-full text-left rounded-lg px-4 py-2.5 text-sm cursor-pointer"
        style="border: 1px solid var(--color-border);">
        Link Google Account
      </button>
    </form>
    <form method="POST" action="?/connectOAuth" use:enhance>
      <input type="hidden" name="provider" value="github" />
      <button type="submit" class="w-full text-left rounded-lg px-4 py-2.5 text-sm cursor-pointer"
        style="border: 1px solid var(--color-border);">
        Link GitHub Account
      </button>
    </form>
  </div>
</div>
