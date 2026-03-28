import type { PageServerLoad } from "./$types";

// activity comes from parent layout — no extra fetch needed
export const load: PageServerLoad = async ({ url }) => {
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  return { page };
};
