<script>
import VersionTimeline from "$lib/components/activity/VersionTimeline.svelte";

let { data } = $props();
</script>

<div class="max-w-3xl p-6">
  <h1 class="text-xl font-semibold mb-2">Version History</h1>
  <p class="text-sm font-mono mb-6" style="color: var(--color-text-muted);">
    {data.entryPath}
  </p>
  <VersionTimeline versions={data.history} />
</div>
