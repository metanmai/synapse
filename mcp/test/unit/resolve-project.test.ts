import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as projectMap from "../../src/cli/project-map.js";
import { resolveProject } from "../../src/cli/resolve-project.js";

describe("resolveProject", () => {
  beforeEach(() => {
    vi.spyOn(projectMap, "readProjectMap").mockReturnValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns local-map hit when cwd is mapped", async () => {
    vi.spyOn(projectMap, "readProjectMap").mockReturnValue({
      "/repo": { project_id: "p1", project_name: "myproj", updated_at: "2026-04-13T00:00:00Z" },
    });
    const fakeApi = vi.fn();
    const result = await resolveProject("/repo", fakeApi);
    expect(result).toEqual({ source: "local", project_id: "p1", name: "myproj" });
    expect(fakeApi).not.toHaveBeenCalled();
  });

  it("falls back to backend resolve when local-map misses", async () => {
    const fakeApi = vi.fn().mockResolvedValue({
      project_id: "p2",
      name: "from-backend",
      confidence: "high",
      signal: "name",
    });
    const result = await resolveProject("/repo", fakeApi);
    expect(result).toEqual({ source: "backend", project_id: "p2", name: "from-backend" });
    expect(fakeApi).toHaveBeenCalledOnce();
  });

  it("returns workspace-fallback signal when backend returns null", async () => {
    const fakeApi = vi.fn().mockResolvedValue({
      project_id: null,
      name: null,
      confidence: null,
      signal: "no_match",
    });
    const result = await resolveProject("/repo", fakeApi);
    expect(result).toEqual({ source: "workspace_fallback", project_id: null, name: null });
  });

  it("returns workspace-fallback when backend call throws", async () => {
    const fakeApi = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await resolveProject("/repo", fakeApi);
    expect(result.source).toBe("workspace_fallback");
  });
});
