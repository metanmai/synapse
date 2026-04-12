<script>
import Sidebar from "$lib/components/layout/Sidebar.svelte";

let { data, children } = $props();
</script>

<div class="project-layout">
  <Sidebar projectName={data.project.name} />
  <main class="project-content">
    {@render children()}
  </main>
</div>

<style>
  .project-layout {
    display: flex;
    height: calc(100vh - 49px);
  }

  .project-content {
    flex: 1;
    min-width: 0;
    overflow: auto;
  }
</style>
