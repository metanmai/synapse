import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);
  const activity = await api.getActivity(project.id, 50, 0).catch(() => []);
  return { activity };
};
