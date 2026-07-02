import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HANDLERS } from "../../src/cli/handlers.js";
import { runPurgeEmptyCmd, selectPurgeCandidates } from "../../src/cli/purge-empty.js";

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// Pure-function tests for the candidate selector. The bug class here is
// "we delete something the user actually cares about" — so the selector
// MUST exclude any project with a conversation, an insight, or a name
// outside the allowlist (default: only `untitled`).
describe("selectPurgeCandidates", () => {
  it("excludes projects with conversations even if they're named 'untitled'", async () => {
    const candidates = selectPurgeCandidates([
      { id: UUID_A, name: "untitled", conversation_count: 0, insight_count: 0 },
      { id: UUID_B, name: "untitled", conversation_count: 1, insight_count: 0 },
    ]);
    expect(candidates).toEqual([{ id: UUID_A, name: "untitled", conversation_count: 0, insight_count: 0 }]);
  });

  it("excludes projects with insights even when zero conversations", async () => {
    const candidates = selectPurgeCandidates([
      { id: UUID_A, name: "untitled", conversation_count: 0, insight_count: 3 },
    ]);
    expect(candidates).toEqual([]);
  });

  it("defaults to only deleting projects literally named 'untitled' — protects empty real projects", async () => {
    // Bug class: a user has an empty project they just created and is about
    // to capture into (e.g. `get-shit-done` with 0 convs). A naive
    // "delete anything empty" purge would nuke it. The default name filter
    // means an empty `untitled` IS deleted but an empty `get-shit-done` is
    // NOT — requires an explicit --include-named to override.
    const candidates = selectPurgeCandidates([
      { id: UUID_A, name: "untitled", conversation_count: 0, insight_count: 0 },
      { id: UUID_B, name: "get-shit-done", conversation_count: 0, insight_count: 0 },
      { id: UUID_C, name: "synapse-e2e-test", conversation_count: 0, insight_count: 0 },
    ]);
    expect(candidates.map((c) => c.id)).toEqual([UUID_A]);
  });

  it("--include-named widens the filter to any name containing the pattern", async () => {
    const candidates = selectPurgeCandidates(
      [
        { id: UUID_A, name: "untitled", conversation_count: 0, insight_count: 0 },
        { id: UUID_B, name: "synapse-e2e-test", conversation_count: 0, insight_count: 0 },
        { id: UUID_C, name: "synapse-e2e-test-v2", conversation_count: 0, insight_count: 0 },
      ],
      { includeNamed: "synapse-e2e-test" },
    );
    expect(candidates.map((c) => c.id).sort()).toEqual([UUID_B, UUID_C].sort());
  });

  it("treats missing conversation_count/insight_count as zero (defensive parsing)", async () => {
    // The /api/projects response is enriched by getProjectStats — but if a
    // backend change ever drops those fields, the selector must default
    // safely. Defaulting them to zero would make a project look empty when
    // it might not be — guarded against by the "untitled" name allowlist.
    const candidates = selectPurgeCandidates([{ id: UUID_A, name: "untitled" }]);
    expect(candidates.map((c) => c.id)).toEqual([UUID_A]);
  });
});

describe("runPurgeEmptyCmd", () => {
  let tmpHome: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalKey = process.env.SYNAPSE_API_KEY;
  const originalHome = process.env.SYNAPSE_HOME;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "purge-test-"));
    process.env.SYNAPSE_HOME = tmpHome;
    process.env.SYNAPSE_API_KEY = "test-purge-key";
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

  // Dry-run is the default. A user running `synapsesync purge-empty` with
  // no flags MUST see the list of what WOULD be deleted, with no actual
  // delete calls fired. This is the safety net before the irreversible
  // action.
  it("DOES NOT call DELETE in dry-run mode (no --yes)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: UUID_A, name: "untitled", conversation_count: 0, insight_count: 0 },
          { id: UUID_B, name: "untitled", conversation_count: 0, insight_count: 0 },
        ]),
        { status: 200 },
      ),
    );

    await runPurgeEmptyCmd({ yes: false });

    // Exactly one fetch — the GET /api/projects. No DELETEs.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/projects");
    const method = (fetchSpy.mock.calls[0][1] as RequestInit)?.method ?? "GET";
    expect(method).toBe("GET");
  });

  it("fires one DELETE per candidate when --yes is passed", async () => {
    fetchSpy
      // GET /api/projects
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: UUID_A, name: "untitled", conversation_count: 0, insight_count: 0 },
            { id: UUID_B, name: "untitled", conversation_count: 0, insight_count: 0 },
            { id: UUID_C, name: "synapse", conversation_count: 7, insight_count: 2 }, // NOT empty
          ]),
          { status: 200 },
        ),
      )
      // DELETE A
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      // DELETE B
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await runPurgeEmptyCmd({ yes: true });

    // 1 GET + 2 DELETEs. The non-empty `synapse` project must NOT be touched.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const deleteCalls = fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCalls).toHaveLength(2);
    const deletedIds = deleteCalls.map((c) => String(c[0])).map((u) => u.split("/").pop());
    expect(deletedIds.sort()).toEqual([UUID_A, UUID_B].sort());
  });

  it("survives a partial failure and continues deleting the rest", async () => {
    // Bug class: one DELETE 500s mid-loop → the remaining candidates must
    // still be attempted. Otherwise a single flaky row blocks the whole
    // cleanup. The error path is reported in stdout, not thrown.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: UUID_A, name: "untitled", conversation_count: 0, insight_count: 0 },
            { id: UUID_B, name: "untitled", conversation_count: 0, insight_count: 0 },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("server sad", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    // Should NOT throw.
    await expect(runPurgeEmptyCmd({ yes: true })).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(3); // GET + 2 DELETEs (both attempted)
  });

  it("does nothing when no candidates match the filter", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: UUID_A, name: "synapse", conversation_count: 7, insight_count: 2 },
          { id: UUID_B, name: "get-shit-done", conversation_count: 0, insight_count: 0 }, // empty but not "untitled"
        ]),
        { status: 200 },
      ),
    );

    await runPurgeEmptyCmd({ yes: true });

    // Just the GET — no candidates means no DELETEs.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("honors --include-named to widen beyond the default 'untitled'", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: UUID_A, name: "synapse-e2e-test", conversation_count: 0, insight_count: 0 },
            { id: UUID_B, name: "get-shit-done", conversation_count: 0, insight_count: 0 }, // not matching pattern
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await runPurgeEmptyCmd({ yes: true, includeNamed: "synapse-e2e-test" });

    // Exactly one DELETE — the matching name. `get-shit-done` is empty but
    // outside the pattern.
    const deleteCalls = fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCalls).toHaveLength(1);
    expect(String(deleteCalls[0][0])).toContain(UUID_A);
  });
});

describe("HANDLERS['purge-empty'] dispatch", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalKey = process.env.SYNAPSE_API_KEY;

  beforeEach(() => {
    process.env.SYNAPSE_API_KEY = "test-handler-key";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalKey) process.env.SYNAPSE_API_KEY = originalKey;
    else process.env.SYNAPSE_API_KEY = undefined;
  });

  it("forwards --yes through to runPurgeEmptyCmd", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    await HANDLERS["purge-empty"]?.(["--yes"]);
    // Just verify dispatch worked; empty list → only GET.
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("throws a usage error when --include-named is passed without a value", async () => {
    // Bug class: a CLI flag that silently accepts undefined would purge
    // EVERY empty project (because pattern="" matches all names via
    // .includes("")). The handler must reject this before any list is
    // fetched.
    await expect(HANDLERS["purge-empty"]?.(["--include-named"])).rejects.toThrow(/usage:/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
