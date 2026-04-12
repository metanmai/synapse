<script>
import VersionTimeline from "$lib/components/activity/VersionTimeline.svelte";

let { data } = $props();
</script>

<div class="max-w-4xl p-8">
  <h1 class="text-xl font-bold mb-2" style="letter-spacing: -0.02em;">Version History</h1>
  <p class="text-sm font-mono mb-6" style="color: var(--color-text-muted);">
    {data.entryPath}
  </p>
  <VersionTimeline versions={data.history} currentContent={data.currentContent} />
</div>
