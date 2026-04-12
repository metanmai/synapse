import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);
  const shareLinks = await api.listShareLinks(project.id);
  return { shareLinks };
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

  removeMember: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = data.get("email") as string;

    const api = createApi(locals.token);
    await api.removeMember(projectId, email);
  },

  createLink: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const role = data.get("role") as string;

    const api = createApi(locals.token);
    await api.createShareLink(projectId, role);
  },

  revokeLink: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const token = data.get("token") as string;

    const api = createApi(locals.token);
    await api.deleteShareLink(projectId, token);
  },
};
