<script>
  import { page } from "$app/stores";
</script>

<div class="max-w-3xl mx-auto p-8 text-center">
  <h1 class="text-4xl font-semibold mb-2">{$page.status}</h1>
  <p style="color: var(--color-text-muted);">{$page.error?.message}</p>
  <a href="/" class="inline-block mt-4 text-sm" style="color: var(--color-link);">
    Back to dashboard
  </a>
</div>
