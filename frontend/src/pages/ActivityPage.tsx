import { useParams } from "react-router-dom";

import { Sidebar } from "../components/layout";
import { ActivityFeed } from "../components/activity";
import { useActivity } from "../hooks/useActivity";
import { useProjects } from "../hooks/useProjects";

export function ActivityPage() {
  const { name } = useParams<{ name: string }>();
  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.name === name);
  const { data: activity = [] } = useActivity(project?.id ?? "");

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto max-w-3xl">
        <h1 className="text-xl font-semibold mb-6">Activity — {name}</h1>
        <ActivityFeed entries={activity} />
      </div>
    </div>
  );
}
