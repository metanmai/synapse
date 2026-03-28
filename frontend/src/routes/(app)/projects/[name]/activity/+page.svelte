<script>
  import ActivityFeed from "$lib/components/activity/ActivityFeed.svelte";

  let { data } = $props();
</script>

<div class="max-w-3xl p-6">
  <h1 class="text-xl font-semibold mb-6">Activity — {data.project.name}</h1>
  <ActivityFeed entries={data.activity} />

  {#if data.activity.length >= 50}
    <div class="mt-6 flex gap-2 justify-center">
      {#if data.page > 1}
        <a href="?page={data.page - 1}" class="text-sm px-3 py-1.5 rounded-lg"
          style="border: 1px solid var(--color-border);">
          Previous
        </a>
      {/if}
      <a href="?page={data.page + 1}" class="text-sm px-3 py-1.5 rounded-lg"
        style="border: 1px solid var(--color-border);">
        Next
      </a>
    </div>
  {/if}
</div>
