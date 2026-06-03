import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HANDLERS } from "../../src/cli/handlers.js";
import { runMoveCmd } from "../../src/cli/move.js";

const UUID_CONV = "11111111-2222-3333-4444-555555555555";
const UUID_PROJ_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_PROJ_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("runMoveCmd", () => {
  let tmpHome: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalKey = process.env.SYNAPSE_API_KEY;
  const originalHome = process.env.SYNAPSE_HOME;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "move-test-"));
    process.env.SYNAPSE_HOME = tmpHome;
    // Provide a key via env so readApiKey resolves without writing config.json.
    process.env.SYNAPSE_API_KEY = "test-move-key";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalKey) process.env.SYNAPSE_API_KEY = originalKey;
    else process.env.SYNAPSE_API_KEY = undefined;
    if (originalHome) process.env.SYNAPSE_HOME = originalHome;
    else process.env.SYNAPSE_HOME = undefined;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // Happy path: both args are full UUIDs → no resolution lookups needed.
  it("POSTs reassign with both args as UUIDs without any list calls", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: UUID_CONV, project_id: UUID_PROJ_B, title: "test" }), { status: 200 }),
    );

    await runMoveCmd({ conv: UUID_CONV, project: UUID_PROJ_B });

    // Exactly one fetch — the reassign POST. No /api/projects list, no
    // /api/conversations lookup. UUIDs are passed through unchecked.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain(`/api/conversations/${UUID_CONV}/reassign`);
    expect((init as RequestInit)?.method).toBe("POST");
    const body = JSON.parse(((init as RequestInit)?.body ?? "{}") as string);
    expect(body.project_id).toBe(UUID_PROJ_B);
  });

  // Resolution: project given by name → must list projects, then POST.
  it("resolves a project name via exact match before POSTing reassign", async () => {
    fetchSpy
      // GET /api/projects
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: UUID_PROJ_A, name: "alpha" },
            { id: UUID_PROJ_B, name: "beta" },
          ]),
          { status: 200 },
        ),
      )
      // POST /api/conversations/:id/reassign
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: UUID_CONV, project_id: UUID_PROJ_B, title: "x" }), { status: 200 }),
      );

    await runMoveCmd({ conv: UUID_CONV, project: "beta" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // First call is the project list.
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/projects");
    // Second call is the reassign with the RESOLVED project UUID, not the name.
    const reassignBody = JSON.parse(((fetchSpy.mock.calls[1][1] as RequestInit)?.body ?? "{}") as string);
    expect(reassignBody.project_id).toBe(UUID_PROJ_B);
  });

  // Ambiguity: must throw a clear error rather than silently picking one.
  // Query "scrat" doesn't exact-match either project but substring-matches
  // both — so the fallback substring branch sees >1 candidate and throws.
  it("throws when project name has multiple substring matches", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: UUID_PROJ_A, name: "scratch" },
          { id: UUID_PROJ_B, name: "scratch-pad" },
        ]),
        { status: 200 },
      ),
    );

    await expect(runMoveCmd({ conv: UUID_CONV, project: "scrat" })).rejects.toThrow(/multiple/i);
  });

  // Surface backend errors clearly — don't swallow a 403 as a generic
  // "something went wrong."
  it("surfaces backend non-2xx responses with the status code", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));

    await expect(runMoveCmd({ conv: UUID_CONV, project: UUID_PROJ_B })).rejects.toThrow(/reassign failed.*403/);
  });
});

// Regression guard for "fix #5 ships but the command isn't reachable from
// `synapsesync move ...`" — index.ts dispatches via the HANDLERS map; if
// the entry is missing, the CLI prints "Unknown command" and the user
// can't fix misroutes.
describe("HANDLERS.move dispatch", () => {
  it("is registered as a callable handler", () => {
    expect(HANDLERS.move).toBeDefined();
    expect(typeof HANDLERS.move).toBe("function");
  });

  it("rejects with a usage message when args are missing", async () => {
    await expect(HANDLERS.move([])).rejects.toThrow(/usage/);
    await expect(HANDLERS.move([UUID_CONV])).rejects.toThrow(/usage/);
  });

  it("rejects when args look like flags (e.g. someone forgot positional order)", async () => {
    await expect(HANDLERS.move(["--help", UUID_PROJ_B])).rejects.toThrow(/usage/);
    await expect(HANDLERS.move([UUID_CONV, "--project=x"])).rejects.toThrow(/usage/);
  });
});
