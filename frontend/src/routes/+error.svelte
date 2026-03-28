<script>
import { page } from "$app/stores";
</script>

<div class="min-h-screen flex items-center justify-center p-8" style="background-color: var(--color-bg);">
  <div class="max-w-2xl w-full">
    <h1 class="text-4xl font-semibold mb-2 text-center" style="color: var(--color-text);">
      {$page.status}
    </h1>
    <p class="text-center mb-4" style="color: var(--color-text-muted);">{$page.error?.message}</p>
    {#if $page.error?.detail}
      <pre class="p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap mb-4"
        style="background-color: var(--color-bg-muted); color: var(--color-text);">{$page.error.detail}</pre>
    {/if}
    <div class="text-center">
      <a href="/" class="text-sm" style="color: var(--color-link);">Go home</a>
    </div>
  </div>
</div>
