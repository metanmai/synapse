<script lang="ts">
import LinkPicker from "$lib/components/project-link/LinkPicker.svelte";

let { data, form } = $props();
</script>

<svelte:head>
  <title>__e2e LinkPicker fixture</title>
</svelte:head>

<div class="max-w-3xl p-6">
  <h1 class="text-xl font-semibold mb-6">__e2e LinkPicker fixture</h1>
  <p style="font-size: 12px; color: #888; margin-bottom: 1rem;">
    Playwright-only test route. Not linked from product UI. See plan 02-06.
  </p>

  <LinkPicker
    sourceProjectId={data.sourceProjectId}
    sourceProjectName={data.sourceProjectName}
    candidates={data.candidates}
    allOtherProjects={data.allOtherProjects}
    linkError={form?.linkError}
  />
</div>
