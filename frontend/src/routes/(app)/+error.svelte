<script>
import { page } from "$app/stores";
</script>

<div class="max-w-3xl mx-auto p-8">
  <div class="glass rounded-xl p-8 text-center">
    <h1 class="text-5xl font-bold mb-3" style="color: var(--color-accent); letter-spacing: -0.03em;">{$page.status}</h1>
    <p class="text-base mb-4" style="color: var(--color-text-muted);">{$page.error?.message}</p>
    {#if $page.error?.detail}
      <pre class="p-4 rounded-lg text-xs overflow-x-auto text-left mb-4"
        style="background-color: var(--color-bg-muted); color: var(--color-text); border: 1px solid var(--color-border);">{$page.error.detail}</pre>
    {/if}
    <a href="/" class="btn-secondary inline-block text-sm">Back to home</a>
  </div>
</div>
