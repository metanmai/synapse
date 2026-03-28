<script>
  import Sidebar from "$lib/components/layout/Sidebar.svelte";

  let { data, children } = $props();
</script>

<div class="flex" style="height: calc(100vh - 49px);">
  <Sidebar projectName={data.project.name} />
  <div class="flex-1 overflow-y-auto">
    {@render children()}
  </div>
</div>
