import { useState } from "react";
import { Link } from "react-router-dom";
import { useProjects, useCreateProject } from "../hooks/useProjects";

export function DashboardPage() {
  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await createProject.mutateAsync(newName.trim());
    setNewName("");
    setShowCreate(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          New Project
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 flex gap-2">
          <input
            type="text"
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
            autoFocus
          />
          <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm">
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(false)}
            className="text-gray-500 text-sm"
          >
            Cancel
          </button>
        </form>
      )}

      {isLoading ? (
        <p className="text-gray-500">Loading projects...</p>
      ) : !projects?.length ? (
        <p className="text-gray-500">No projects yet. Create one to get started.</p>
      ) : (
        <div className="space-y-2">
          {projects.map((p: any) => (
            <Link
              key={p.id}
              to={`/projects/${encodeURIComponent(p.name)}`}
              className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
            >
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-gray-500 mt-1">
                Created {new Date(p.created_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
