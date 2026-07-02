import { describe, expect, it, vi } from "vitest";
import { matchConversations } from "../../src/db/queries/conversations";
import { aiResolveProject } from "../../src/lib/ai-resolve";
import { makeMockSupabase } from "../helpers/supabase-mock";

const ENV = { EMBEDDING_SERVICE_URL: "http://embed.test", EMBEDDING_SERVICE_KEY: "k" };
const VEC = [0.1, 0.2, 0.3];

// fetchFn stub standing in for the embedding service.
function embedOk(vec = VEC): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ embeddings: [vec] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}
function embedFail(): typeof fetch {
  return (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
}

function dbWithCandidates(rows: { project_id: string; similarity: number }[]) {
  const mock = makeMockSupabase();
  mock.rpc.match_conversations = () => ({ data: rows, error: null });
  return mock;
}

describe("aiResolveProject", () => {
  it("assigns to the best project when a candidate is confidently similar", async () => {
    const mock = dbWithCandidates([{ project_id: "p1", similarity: 0.9 }]);
    const r = await aiResolveProject(mock.client, ENV, "user", "seed", embedOk());
    expect(r).toMatchObject({ decision: { action: "assign", projectId: "p1", confidence: 0.9 } });
    expect(r?.embedding).toBe(JSON.stringify(VEC));
  });

  it("still assigns (low-confidence) in the ambiguous band", async () => {
    const mock = dbWithCandidates([{ project_id: "p1", similarity: 0.7 }]);
    const r = await aiResolveProject(mock.client, ENV, "user", "seed", embedOk());
    expect(r?.decision).toMatchObject({ action: "assign", projectId: "p1", confidence: 0.7 });
  });

  it("creates a new project when there are no candidates", async () => {
    const mock = dbWithCandidates([]);
    const r = await aiResolveProject(mock.client, ENV, "user", "seed", embedOk());
    expect(r?.decision.action).toBe("create");
  });

  it("collapses multiple hits in one project to its best score", async () => {
    const mock = dbWithCandidates([
      { project_id: "p1", similarity: 0.7 },
      { project_id: "p1", similarity: 0.9 },
      { project_id: "p2", similarity: 0.6 },
    ]);
    const r = await aiResolveProject(mock.client, ENV, "user", "seed", embedOk());
    expect(r?.decision).toMatchObject({ action: "assign", projectId: "p1", confidence: 0.9 });
  });

  it("returns null (caller falls back) when embeddings are not configured", async () => {
    const mock = dbWithCandidates([{ project_id: "p1", similarity: 0.9 }]);
    const fetchSpy = vi.fn();
    const r = await aiResolveProject(mock.client, {}, "user", "seed", fetchSpy as unknown as typeof fetch);
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when the embedding service errors", async () => {
    const mock = dbWithCandidates([{ project_id: "p1", similarity: 0.9 }]);
    const r = await aiResolveProject(mock.client, ENV, "user", "seed", embedFail());
    expect(r).toBeNull();
  });
});

describe("matchConversations", () => {
  it("passes the vector as pgvector text form and returns rows", async () => {
    const mock = dbWithCandidates([{ project_id: "p1", similarity: 0.8 }]);
    const rows = await matchConversations(mock.client, "user", VEC, 0.65);
    expect(rows).toEqual([{ project_id: "p1", similarity: 0.8 }]);
    const call = mock.calls.find((c) => c.table === "rpc:match_conversations");
    expect((call?.args as { query_embedding: string }).query_embedding).toBe(JSON.stringify(VEC));
  });

  it("degrades to an empty list on RPC error", async () => {
    const mock = makeMockSupabase();
    mock.rpc.match_conversations = () => ({ data: null, error: { message: "rpc down" } });
    expect(await matchConversations(mock.client, "user", VEC, 0.65)).toEqual([]);
  });
});
