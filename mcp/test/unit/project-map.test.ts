import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProjectMapPath, readProjectMap, upsertProjectMapping } from "../../src/cli/project-map.js";

describe("project-map", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-pm-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("getProjectMapPath returns ~/.synapse/project-map.json", () => {
    expect(getProjectMapPath()).toBe(path.join(tmpHome, ".synapse", "project-map.json"));
  });

  it("readProjectMap returns {} when file does not exist", () => {
    expect(readProjectMap()).toEqual({});
  });

  it("upsertProjectMapping creates directory + file", () => {
    upsertProjectMapping("/tmp/foo", { project_id: "p1", project_name: "foo" });
    const map = readProjectMap();
    expect(map["/tmp/foo"]).toMatchObject({ project_id: "p1", project_name: "foo" });
    expect(map["/tmp/foo"].updated_at).toBeTruthy();
  });

  it("upsertProjectMapping overwrites existing entry", () => {
    upsertProjectMapping("/tmp/foo", { project_id: "p1", project_name: "foo" });
    upsertProjectMapping("/tmp/foo", { project_id: "p2", project_name: "foo-renamed" });
    expect(readProjectMap()["/tmp/foo"].project_id).toBe("p2");
  });

  it("readProjectMap recovers from malformed JSON", () => {
    const p = getProjectMapPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "{not valid json");
    expect(readProjectMap()).toEqual({});
  });
});
