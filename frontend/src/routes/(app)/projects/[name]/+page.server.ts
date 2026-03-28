import { fail } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { createApi } from "$lib/server/api";

export const actions: Actions = {
  saveEntry: async ({ request, params, locals }) => {
    const data = await request.formData();
    const path = (data.get("path") as string)?.trim();
    const content = data.get("content") as string;
    const tagsRaw = data.get("tags") as string;
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];

    if (!path) return fail(400, { error: "Path is required" });

    const api = createApi(locals.token);
    try {
      await api.saveEntry(params.name, path, content, tags);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to save" });
    }

    return { saved: true, savedPath: path };
  },

  addMember: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = (data.get("email") as string)?.trim();
    const role = data.get("role") as string;

    if (!email) return fail(400, { error: "Email is required" });

    const api = createApi(locals.token);
    try {
      await api.addMember(projectId, email, role);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to invite" });
    }
    return { invited: true };
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

  importProject: async ({ request, locals }) => {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const projectId = formData.get("projectId") as string;

    if (!file || !projectId) return fail(400, { error: "File and project ID required" });

    const api = createApi(locals.token);
    try {
      const result = await api.importProject(projectId, file);
      return { importResult: result };
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Import failed" });
    }
  },
};
