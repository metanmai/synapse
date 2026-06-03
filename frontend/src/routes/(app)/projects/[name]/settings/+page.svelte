<script>
import LinkPicker from "$lib/components/project-link/LinkPicker.svelte";
import InviteDialog from "$lib/components/sharing/InviteDialog.svelte";
import MemberList from "$lib/components/sharing/MemberList.svelte";

let { data, form } = $props();
</script>

<div class="max-w-3xl p-6">
  <h1 class="text-xl font-semibold mb-6">Settings — {data.project.name}</h1>

  <section class="mb-8">
    <h2 class="text-lg font-medium mb-3">Members</h2>
    <InviteDialog error={form?.inviteError} projectId={data.project.id} />
    <div class="mt-4">
      <MemberList members={data.project.project_members ?? []} projectId={data.project.id} />
    </div>
  </section>

  <section class="mb-8">
    <LinkPicker
      sourceProjectId={data.project.id}
      sourceProjectName={data.project.name}
      candidates={data.linkCandidates ?? []}
      allOtherProjects={data.otherProjects ?? []}
      linkError={form?.linkError}
    />
  </section>
</div>
