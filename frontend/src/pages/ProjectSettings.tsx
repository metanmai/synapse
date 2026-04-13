import { useParams } from "react-router-dom";

import { Sidebar } from "../components/layout";
import { MemberList, ShareLinkManager, InviteDialog } from "../components/sharing";
import { useProjects } from "../hooks/useProjects";

export function ProjectSettings() {
  const { name } = useParams<{ name: string }>();
  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.name === name);

  if (!project) return <div className="p-8 text-gray-500">Project not found</div>;

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto max-w-3xl">
        <h1 className="text-xl font-semibold mb-6">Settings — {name}</h1>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Members</h2>
          <InviteDialog projectId={project.id} />
          <div className="mt-4">
            <MemberList projectId={project.id} members={project.project_members ?? []} />
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Share Links</h2>
          <ShareLinkManager projectId={project.id} />
        </section>
      </div>
    </div>
  );
}
