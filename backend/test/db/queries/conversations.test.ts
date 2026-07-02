import type { SupabaseClient } from "@supabase/supabase-js";
import { type Mock, describe, expect, it, vi } from "vitest";

import { countConversationsForProject, evictOldestConversationForProject } from "../../../src/db/queries/conversations";

/**
 * Bug class under test (Phase 03-03):
 *  - countConversationsForProject must return the COUNT (not data) and
 *    raise on error (so the eviction path doesn't silently skip and
 *    leave a Free user permanently over-cap).
 *  - evictOldestConversationForProject must SELECT the OLDEST by
 *    updated_at ASC (not random, not newest), DELETE it, and return
 *    its id. On no-rows / select-error / delete-error, return null
 *    rather than throwing — eviction is best-effort, the subsequent
 *    create must not be blocked by an eviction failure.
 *
 * Tests follow the insights.test.ts mock pattern (per-call chainable).
 */

function createSequentialMockDb(...responses: { data?: unknown; error?: unknown; count?: number | null }[]) {
  let callIndex = 0;
  const chains: Record<string, Mock>[] = [];

  const from = vi.fn().mockImplementation(() => {
    const idx = callIndex++;
    const resp = responses[idx] ?? responses[responses.length - 1];

    const chainable: Record<string, Mock> = {};
    const methods = [
      "select",
      "insert",
      "update",
      "delete",
      "upsert",
      "eq",
      "neq",
      "in",
      "is",
      "like",
      "or",
      "overlaps",
      "order",
      "limit",
      "range",
      "textSearch",
    ];
    for (const m of methods) {
      chainable[m] = vi.fn().mockReturnValue(chainable);
    }
    chainable.single = vi.fn().mockResolvedValue(resp);
    chainable.maybeSingle = vi.fn().mockResolvedValue(resp);
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock
    (chainable as Record<string, unknown>).then = (resolve: (v: unknown) => void) => resolve(resp);

    chains.push(chainable);
    return chainable;
  });

  return { from, chains };
}

// ────────────────────────────────────────────────────────────────────
// countConversationsForProject
// ────────────────────────────────────────────────────────────────────
describe("countConversationsForProject", () => {
  it("returns the count for a project", async () => {
    const { from } = createSequentialMockDb({ count: 7, error: null });
    const db = { from } as unknown as SupabaseClient;
    expect(await countConversationsForProject(db, "proj-1")).toBe(7);
  });

  it("returns 0 when the project is empty (null count)", async () => {
    const { from } = createSequentialMockDb({ count: null, error: null });
    const db = { from } as unknown as SupabaseClient;
    expect(await countConversationsForProject(db, "proj-empty")).toBe(0);
  });

  it("throws when the count query errors (caller must know — eviction would otherwise skip silently)", async () => {
    const { from } = createSequentialMockDb({ count: null, error: { message: "db down" } });
    const db = { from } as unknown as SupabaseClient;
    await expect(countConversationsForProject(db, "proj-broken")).rejects.toMatchObject({ message: "db down" });
  });
});

// ────────────────────────────────────────────────────────────────────
// evictOldestConversationForProject
// ────────────────────────────────────────────────────────────────────
describe("evictOldestConversationForProject", () => {
  it("selects oldest by updated_at ASC, deletes it, returns its id", async () => {
    // Response 1: select returns the oldest row { id: "old-conv-id" }
    // Response 2: delete succeeds with error: null
    const { from, chains } = createSequentialMockDb(
      { data: { id: "old-conv-id" }, error: null },
      { data: null, error: null },
    );
    const db = { from } as unknown as SupabaseClient;

    const result = await evictOldestConversationForProject(db, "proj-1");
    expect(result).toBe("old-conv-id");

    // Verify the select chain used `.order("updated_at", { ascending: true })`
    // — pinning the LRU contract. Without this assertion the test would
    // pass even if the impl accidentally ordered DESC (evicting newest!).
    const selectChain = chains[0];
    expect(selectChain.order).toHaveBeenCalledWith("updated_at", { ascending: true });
    expect(selectChain.limit).toHaveBeenCalledWith(1);

    // Verify the delete chain used eq("id", evictId)
    const deleteChain = chains[1];
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "old-conv-id");
  });

  it("returns null on no rows (empty project)", async () => {
    const { from } = createSequentialMockDb({ data: null, error: null });
    const db = { from } as unknown as SupabaseClient;
    expect(await evictOldestConversationForProject(db, "proj-empty")).toBeNull();
  });

  it("returns null on select error (best-effort, does not throw — log + null)", async () => {
    const { from } = createSequentialMockDb({ data: null, error: { message: "select failed" } });
    const db = { from } as unknown as SupabaseClient;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await evictOldestConversationForProject(db, "proj-broken")).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns null on delete error (best-effort — log + null, do not throw)", async () => {
    const { from } = createSequentialMockDb(
      { data: { id: "found-id" }, error: null },
      { data: null, error: { message: "delete failed" } },
    );
    const db = { from } as unknown as SupabaseClient;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await evictOldestConversationForProject(db, "proj-1")).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
