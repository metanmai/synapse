<script>
import AppShell from "$lib/components/layout/AppShell.svelte";

let { data, children } = $props();
</script>

<AppShell user={data.user} projects={data.projects}>
  {@render children()}
</AppShell>
