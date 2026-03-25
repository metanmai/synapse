<script>
  import { page } from "$app/stores";
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="text-center">
    <h1 class="text-4xl font-semibold mb-2" style="color: var(--color-text);">
      {$page.status}
    </h1>
    <p style="color: var(--color-text-muted);">{$page.error?.message}</p>
    <a href="/" class="inline-block mt-4 text-sm" style="color: var(--color-link);">
      Go home
    </a>
  </div>
</div>
