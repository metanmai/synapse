<script>
import Sidebar from "$lib/components/layout/Sidebar.svelte";

let { data, children } = $props();

// Shared projects route as `<owner_email>~<name>`; owner-role projects route as
// bare name. Sidebar builds /projects/<slug>/* hrefs, so it needs the routing
// slug (with email prefix for non-owners), not the display name. Without this,
// every sidebar link 404s for any shared-project viewer.
const projectSlug = $derived(
  data.project.role === "owner" ? data.project.name : `${data.project.owner_email}~${data.project.name}`,
);
</script>

<div class="project-layout">
  <Sidebar projectName={projectSlug} />
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
