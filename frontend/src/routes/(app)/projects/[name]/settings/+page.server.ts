import { createApi } from "$lib/server/api";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, parent }) => {
  const api = createApi(locals.token);
  const billing = await api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null }));

  const { project: currentProject } = await parent();
  const allProjects = await api.listProjects().catch(() => []);
  const linkCandidates = await api.listLinkCandidates(params.name).catch(() => []);
  const otherProjects = allProjects
    .filter((p) => p.id !== currentProject.id)
    .map((p) => ({
      id: p.id,
      name: p.name,
      conversation_count: p.conversation_count ?? 0,
      matched_by_remote: false,
    }));

  return { tier: billing.tier, linkCandidates, otherProjects };
};

export const actions: Actions = {
  addMember: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = (data.get("email") as string)?.trim();
    const role = data.get("role") as string;

    if (!email) return fail(400, { inviteError: "Email is required" });

    const api = createApi(locals.token);
    try {
      await api.addMember(projectId, email, role);
    } catch (err) {
      return fail(400, { inviteError: err instanceof Error ? err.message : "Failed to invite" });
    }
    return { invited: true };
  },

  updateRole: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = data.get("email") as string;
    const role = data.get("role") as string;

    const api = createApi(locals.token);
    await api.updateMemberRole(projectId, email, role);
  },

  removeMember: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = data.get("email") as string;

    const api = createApi(locals.token);
    await api.removeMember(projectId, email);
  },

  // Phase 2 (IDENT-02, D-07): manual project link / merge.
  // Status-code → locked-copy mapping per 02-UI-SPEC.md §State F.
  linkProject: async ({ request, locals }) => {
    const data = await request.formData();
    const sourceProjectId = data.get("sourceProjectId") as string;
    const targetProjectId = data.get("targetProjectId") as string;

    if (!sourceProjectId || !targetProjectId) {
      return fail(400, { linkError: "Pick a target project before linking." });
    }

    const api = createApi(locals.token);
    let targetName: string | undefined;
    try {
      await api.mergeProjects(sourceProjectId, targetProjectId);
      const all = await api.listProjects().catch(() => []);
      targetName = all.find((p) => p.id === targetProjectId)?.name;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 403) {
        return fail(403, {
          linkError: "You're not the owner of one of these projects. Only the owner can link projects.",
        });
      }
      if (status === 404) {
        return fail(404, {
          linkError: "That target project no longer exists. Refresh and pick another one.",
        });
      }
      if (status === 409) {
        return fail(409, {
          linkError: "You can't link a project to itself. Pick a different target.",
        });
      }
      if (status && status >= 500) {
        return fail(status, {
          linkError:
            "Something went wrong on our side. Wait a moment and try again — if it keeps failing, check the project page in a few minutes.",
        });
      }
      return fail(503, { linkError: "Couldn't reach the server. Check your connection and try again." });
    }

    throw redirect(303, `/projects/${encodeURIComponent(targetName ?? targetProjectId)}/settings`);
  },
};
