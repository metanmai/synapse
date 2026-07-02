import { describe, expect, it } from "vitest";
import { backfillEmbeddings, reconcileMergesForOwner } from "../../src/cron/reconcile-projects";
import { makeMockSupabase } from "../helpers/supabase-mock";

const CFG = { url: "http://embed.test", key: "k" };
function embedOk(vecs: number[][]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ embeddings: vecs }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("backfillEmbeddings", () => {
  it("embeds conversations that have a title but no embedding, and updates them", async () => {
    const mock = makeMockSupabase();
    mock.tables.conversations = {
      select: () => ({
        data: [
          { id: "c1", title: "hello world" },
          { id: "c2", title: null }, // skipped — no title
          { id: "c3", title: "   " }, // skipped — blank title
        ],
        error: null,
      }),
    };
    const n = await backfillEmbeddings(mock.client, CFG, embedOk([[0.1, 0.2, 0.3]]));
    expect(n).toBe(1);
    const update = mock.calls.find((c) => c.table === "conversations" && c.op === "update");
    expect((update?.args as { embedding: string }).embedding).toBe(JSON.stringify([0.1, 0.2, 0.3]));
  });

  it("does nothing (and never calls the embedder) when no titled rows are pending", async () => {
    const mock = makeMockSupabase();
    mock.tables.conversations = { select: () => ({ data: [{ id: "c2", title: null }], error: null }) };
    let called = false;
    const spyFetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await backfillEmbeddings(mock.client, CFG, spyFetch)).toBe(0);
    expect(called).toBe(false);
  });
});

describe("reconcileMergesForOwner — 2-run hysteresis", () => {
  const ONE_PAIR = { data: [{ project_a: "a", project_b: "b", score: 0.9 }], error: null };

  it("first sighting only records a pending candidate (no merge)", async () => {
    const mock = makeMockSupabase();
    mock.rpc.find_merge_candidates = () => ONE_PAIR;
    mock.tables.project_merge_candidates = { maybeSingle: () => ({ data: null, error: null }) };

    const r = await reconcileMergesForOwner(mock.client, "owner", Date.now());
    expect(r).toEqual({ candidates: 1, merged: 0 });
    const insert = mock.calls.find((c) => c.table === "project_merge_candidates" && c.op === "insert");
    expect(insert?.args).toMatchObject({ project_low: "a", project_high: "b", status: "pending" });
    expect(mock.calls.find((c) => c.table === "rpc:merge_projects")).toBeUndefined();
  });

  it("second sighting merges, with the real project absorbing the synthetic bucket", async () => {
    const mock = makeMockSupabase();
    mock.rpc.find_merge_candidates = () => ONE_PAIR;
    mock.rpc.merge_projects = () => ({ error: null });
    mock.tables.project_merge_candidates = {
      maybeSingle: () => ({
        data: { id: "cand1", status: "pending", first_seen_at: "2020-01-01T00:00:00Z" },
        error: null,
      }),
    };
    mock.tables.projects = {
      select: () => ({
        data: [
          { id: "a", name: "chatgpt.com", created_at: "2026-02-01T00:00:00Z" }, // synthetic, newer
          { id: "b", name: "synapse", created_at: "2026-01-01T00:00:00Z" }, // real, older
        ],
        error: null,
      }),
    };

    const r = await reconcileMergesForOwner(mock.client, "owner", Date.now());
    expect(r).toEqual({ candidates: 0, merged: 1 });
    const merge = mock.calls.find((c) => c.table === "rpc:merge_projects");
    expect(merge?.args).toMatchObject({ p_source_id: "a", p_target_id: "b", p_user_id: "owner" });
  });

  it("does NOT merge a candidate first seen during this same run", async () => {
    const mock = makeMockSupabase();
    mock.rpc.find_merge_candidates = () => ONE_PAIR;
    // first_seen_at (ms 5000) is not strictly before runStart (1000) → not stable.
    mock.tables.project_merge_candidates = {
      maybeSingle: () => ({
        data: { id: "cand1", status: "pending", first_seen_at: new Date(5000).toISOString() },
        error: null,
      }),
    };

    const r = await reconcileMergesForOwner(mock.client, "owner", 1000);
    expect(r).toEqual({ candidates: 0, merged: 0 });
    expect(mock.calls.find((c) => c.table === "rpc:merge_projects")).toBeUndefined();
  });

  it("skips a candidate that was already merged", async () => {
    const mock = makeMockSupabase();
    mock.rpc.find_merge_candidates = () => ONE_PAIR;
    mock.tables.project_merge_candidates = {
      maybeSingle: () => ({
        data: { id: "cand1", status: "merged", first_seen_at: "2020-01-01T00:00:00Z" },
        error: null,
      }),
    };

    const r = await reconcileMergesForOwner(mock.client, "owner", Date.now());
    expect(r).toEqual({ candidates: 0, merged: 0 });
    expect(mock.calls.find((c) => c.table === "rpc:merge_projects")).toBeUndefined();
  });
});
