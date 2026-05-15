<script>
import { page } from "$app/stores";
</script>

<div class="max-w-3xl mx-auto p-8">
  <h1 class="text-4xl font-semibold mb-2 text-center">{$page.status}</h1>
  <p class="text-center mb-4" style="color: var(--color-text-muted);">{$page.error?.message}</p>
  {#if $page.error?.detail}
    <pre class="p-4 rounded-lg text-xs overflow-x-auto"
      style="background-color: var(--color-bg-muted); color: var(--color-text);">{$page.error.detail}</pre>
  {/if}
  <div class="text-center mt-4">
    <a href="/" class="text-sm" style="color: var(--color-link);">Back to home</a>
  </div>
</div>
