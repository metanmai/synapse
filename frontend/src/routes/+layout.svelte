<script>
import "../app.css";
import NavigationProgress from "$lib/components/NavigationProgress.svelte";

let { children } = $props();
</script>

<NavigationProgress />
{@render children()}
