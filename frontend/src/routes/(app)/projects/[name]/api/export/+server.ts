import type { RequestHandler } from "./$types";
import { API_URL } from "$env/static/private";

export const GET: RequestHandler = async ({ locals, params }) => {
  const projectsRes = await fetch(`${API_URL}/api/projects`, {
    headers: { Authorization: `Bearer ${locals.token}` },
  });
  const projects = await projectsRes.json();
  const project = projects.find((p: any) => p.name === params.name);
  if (!project) return new Response("Not found", { status: 404 });

  const res = await fetch(`${API_URL}/api/projects/${project.id}/export`, {
    headers: { Authorization: `Bearer ${locals.token}` },
  });

  return new Response(res.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": res.headers.get("Content-Disposition") ?? `attachment; filename="export.zip"`,
    },
  });
};
