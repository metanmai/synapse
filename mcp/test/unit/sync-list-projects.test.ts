import type fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listLocalProjectIds } from "../../src/cli/sync.js";

// Bug class under guard (2026-06-10): `synapsesync sync` listed projects
// from the project-map ONLY. A first-contact cwd's placeholder queue
// (projects/cwd_<hash>/events.jsonl) exists on disk BEFORE any map entry
// does, so the manual "force a sync now" command skipped exactly the
// queues that needed it — first-contact events stayed stranded until the
// daemon's next disk re-scan, minutes later. The fix unions map ids with
// on-disk project dirs, mirroring the daemon's reconcileProjects model.

function fakeFs(dirs: string[], extras: { files?: string[]; throwOnStat?: string[] } = {}) {
  const files = extras.files ?? [];
  const throwOnStat = new Set(extras.throwOnStat ?? []);
  return {
    readdirSync: (() => [...dirs, ...files]) as unknown as typeof fs.readdirSync,
    statSync: ((p: string) => {
      const name = path.basename(String(p));
      if (throwOnStat.has(name)) throw new Error("ENOENT");
      return { isDirectory: () => dirs.includes(name) } as ReturnType<typeof fs.statSync>;
    }) as typeof fs.statSync,
  };
}

describe("listLocalProjectIds", () => {
  it("includes on-disk placeholder dirs that have no map entry yet", () => {
    const ids = listLocalProjectIds([], "/h/.synapse/projects", fakeFs(["cwd_abc123def456"]));
    expect(ids).toContain("cwd_abc123def456");
  });

  it("unions map ids with disk dirs and dedupes the overlap", () => {
    const ids = listLocalProjectIds(
      ["11111111-1111-1111-1111-111111111111", "cwd_shared"],
      "/h/.synapse/projects",
      fakeFs(["cwd_shared", "cwd_diskonly"]),
    );
    expect(ids.sort()).toEqual(["11111111-1111-1111-1111-111111111111", "cwd_diskonly", "cwd_shared"].sort());
  });

  it("skips dotfiles and plain files in the projects dir", () => {
    const ids = listLocalProjectIds([], "/h/.synapse/projects", fakeFs(["cwd_real"], { files: ["stray.json"] }));
    expect(ids).toEqual(["cwd_real"]);
  });

  it("ignores .-prefixed entries", () => {
    const ids = listLocalProjectIds([], "/h/.synapse/projects", fakeFs([".DS_Store-like", "cwd_ok"]));
    expect(ids).toEqual(["cwd_ok"]);
  });

  it("tolerates a dir vanishing between readdir and stat", () => {
    const ids = listLocalProjectIds(
      [],
      "/h/.synapse/projects",
      fakeFs(["cwd_alive", "cwd_gone"], { throwOnStat: ["cwd_gone"] }),
    );
    expect(ids).toEqual(["cwd_alive"]);
  });

  it("falls back to map ids alone when the projects dir is unreadable (fresh install)", () => {
    const broken = {
      readdirSync: (() => {
        throw new Error("ENOENT");
      }) as unknown as typeof fs.readdirSync,
      statSync: (() => {
        throw new Error("unreachable");
      }) as unknown as typeof fs.statSync,
    };
    expect(listLocalProjectIds(["map-only-id"], "/nope/projects", broken)).toEqual(["map-only-id"]);
  });
});
