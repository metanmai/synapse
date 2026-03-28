<script>
import AppShell from "$lib/components/layout/AppShell.svelte";

let { data, children } = $props();
</script>

<AppShell user={data.user}>
  {@render children()}
</AppShell>
