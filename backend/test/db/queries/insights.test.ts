import type { SupabaseClient } from "@supabase/supabase-js";
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { type createMockDb, mockSuccess } from "../mock-supabase";

import { createInsight, listInsights } from "../../../src/db/queries/insights";

// ─────────────────────────────────────────────────────────────────
// Helper mirroring queries.test.ts: per-call chainable mock so we
// can verify multi-step queries like createInsight (insert →
// optional update-supersedes).
// ─────────────────────────────────────────────────────────────────
function createSequentialMockDb(...responses: { data?: unknown; error?: unknown; count?: number | null }[]) {
  let callIndex = 0;
  const chains: ReturnType<typeof createMockDb>["chainable"][] = [];

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

    chains.push(chainable as ReturnType<typeof createMockDb>["chainable"]);
    return chainable;
  });

  return { from, chains };
}

// ═════════════════════════════════════════════════════════════════
// INSIGHTS — supersession curation (migration 024)
// ═════════════════════════════════════════════════════════════════
//
// These tests guard the curation contract added in 024:
//   - listInsights filters `superseded_by IS NULL` by default
//   - listInsights({ includeSuperseded: true }) returns the full set
//   - createInsight({ supersedes: [...] }) stamps superseded_by on the
//     listed rows, scoped to the SAME project (security guard) and
//     idempotent against already-superseded rows.
//   - Cross-project supersedes is silently ignored — the project_id
//     filter in the UPDATE WHERE clause is the security guard.
//   - Empty supersedes / undefined → no second query is issued.
//   - Errors during the supersession UPDATE are non-fatal — the new
//     insight save is the contract, the stamp is best-effort.
//
// Bug class guarded: a regression that drops the project_id filter
// from the supersedes UPDATE would let a caller stamp insights in any
// project they don't own. A regression that drops the
// `superseded_by IS NULL` guard would re-stamp an already-superseded
// row each call, losing the original supersession chain.

describe("insights queries — supersession (migration 024)", () => {
  // ── listInsights default: superseded_by IS NULL ────────────────
  describe("listInsights — excludes superseded by default", () => {
    let db: ReturnType<typeof createSequentialMockDb>;

    beforeEach(() => {
      // 1st from() = count query (head:true, .is() filter must fire)
      // 2nd from() = data query (.is() filter must also fire)
      db = createSequentialMockDb({ data: null, error: null, count: 3 }, { data: [], error: null });
    });

    it("default call applies .is('superseded_by', null) on both count and data queries", async () => {
      await listInsights(db as unknown as SupabaseClient, "proj1");

      // count query is db.chains[0], data query is db.chains[1]
      expect(db.chains[0].is).toHaveBeenCalledWith("superseded_by", null);
      expect(db.chains[1].is).toHaveBeenCalledWith("superseded_by", null);
    });

    it("includeSuperseded:false applies the same filter (explicit default)", async () => {
      await listInsights(db as unknown as SupabaseClient, "proj1", { includeSuperseded: false });

      expect(db.chains[0].is).toHaveBeenCalledWith("superseded_by", null);
      expect(db.chains[1].is).toHaveBeenCalledWith("superseded_by", null);
    });
  });

  // ── listInsights({ includeSuperseded: true }) — full set ───────
  describe("listInsights — includeSuperseded:true returns full set", () => {
    it("does NOT call .is('superseded_by', null) on either query", async () => {
      const db = createSequentialMockDb({ data: null, error: null, count: 7 }, { data: [], error: null });

      await listInsights(db as unknown as SupabaseClient, "proj1", { includeSuperseded: true });

      // Neither the count nor data chain should have .is() called.
      // If a regression adds the filter back, this catches it.
      expect(db.chains[0].is).not.toHaveBeenCalled();
      expect(db.chains[1].is).not.toHaveBeenCalled();
    });

    it("still filters by project_id and orders by updated_at desc", async () => {
      const db = createSequentialMockDb({ data: null, error: null, count: 7 }, { data: [], error: null });

      await listInsights(db as unknown as SupabaseClient, "proj1", { includeSuperseded: true });

      expect(db.chains[1].eq).toHaveBeenCalledWith("project_id", "proj1");
      expect(db.chains[1].order).toHaveBeenCalledWith("updated_at", { ascending: false });
    });
  });

  // ── createInsight({ supersedes: [...] }) ───────────────────────
  describe("createInsight — supersedes stamps superseded_by on listed rows", () => {
    it("issues a second UPDATE with the new insight id scoped to the same project", async () => {
      const inserted = {
        id: "new-id",
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "newer",
        detail: null,
        source: null,
        encrypted: false,
        created_at: "2026-05-28",
        updated_at: "2026-05-28",
        superseded_by: null,
      };
      // 1st from() = INSERT (returns the new row)
      // 2nd from() = UPDATE (stamps the supersedes targets)
      const db = createSequentialMockDb({ data: inserted, error: null }, { data: null, error: null });

      const result = await createInsight(db as unknown as SupabaseClient, {
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "newer",
        supersedes: ["old-a", "old-b"],
      });

      expect(result).toEqual(inserted);
      // Two from() calls — first is the insert chain, second the
      // supersession-stamp chain.
      expect(db.from).toHaveBeenCalledTimes(2);
      expect(db.from).toHaveBeenNthCalledWith(1, "insights");
      expect(db.from).toHaveBeenNthCalledWith(2, "insights");

      // UPDATE payload must be exactly { superseded_by: <new_id> }
      expect(db.chains[1].update).toHaveBeenCalledWith({ superseded_by: "new-id" });
      // Filtered by the supersedes id list
      expect(db.chains[1].in).toHaveBeenCalledWith("id", ["old-a", "old-b"]);
      // Project scoping — SECURITY: cross-project ids must NOT match.
      // The whole bug class this protects against is "client passes ids
      // they don't own; without project_id we'd stamp them anyway."
      expect(db.chains[1].eq).toHaveBeenCalledWith("project_id", "proj1");
      // Idempotency — must not re-stamp already-superseded rows.
      expect(db.chains[1].is).toHaveBeenCalledWith("superseded_by", null);
    });

    it("cross-project supersedes is silently ignored by the project_id filter (no security leak)", async () => {
      // The UPDATE issues regardless — the WHERE clause is what enforces
      // scope. We mock zero rows affected (data:null, no error), as if
      // Supabase matched none of the requested ids in this project.
      const inserted = {
        id: "new-id",
        project_id: "proj-mine",
        user_id: "u1",
        type: "learning",
        summary: "x",
        detail: null,
        source: null,
        encrypted: false,
        created_at: "2026-05-28",
        updated_at: "2026-05-28",
        superseded_by: null,
      };
      const db = createSequentialMockDb({ data: inserted, error: null }, { data: null, error: null });

      const result = await createInsight(db as unknown as SupabaseClient, {
        project_id: "proj-mine",
        user_id: "u1",
        type: "learning",
        summary: "x",
        // These ids belong to a different project. The UPDATE issues but
        // the .eq("project_id", "proj-mine") filter excludes them — no
        // rows get stamped, no error is raised, the function returns
        // the new insight normally.
        supersedes: ["someone-elses-id-1", "someone-elses-id-2"],
      });

      expect(result).toEqual(inserted);
      // CRITICAL: the project_id filter MUST be present in the chain. If
      // a refactor drops it, cross-project stamping becomes possible.
      // The contract here is "every UPDATE chain on supersedes has
      // .eq('project_id', <caller's project>)."
      expect(db.chains[1].eq).toHaveBeenCalledWith("project_id", "proj-mine");
    });

    it("empty supersedes array is a no-op — no second from() call", async () => {
      const inserted = {
        id: "new-id",
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "no replacements",
        detail: null,
        source: null,
        encrypted: false,
        created_at: "2026-05-28",
        updated_at: "2026-05-28",
        superseded_by: null,
      };
      const db = createSequentialMockDb({ data: inserted, error: null });

      const result = await createInsight(db as unknown as SupabaseClient, {
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "no replacements",
        supersedes: [],
      });

      expect(result).toEqual(inserted);
      // No supersession UPDATE — only the INSERT call.
      expect(db.from).toHaveBeenCalledTimes(1);
    });

    it("undefined supersedes is a no-op — backwards-compatible with existing callers", async () => {
      const inserted = {
        id: "new-id",
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "legacy caller",
        detail: null,
        source: null,
        encrypted: false,
        created_at: "2026-05-28",
        updated_at: "2026-05-28",
        superseded_by: null,
      };
      const db = createSequentialMockDb({ data: inserted, error: null });

      await createInsight(db as unknown as SupabaseClient, {
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "legacy caller",
        // no supersedes key at all — must behave exactly as the
        // pre-024 createInsight did.
      });

      expect(db.from).toHaveBeenCalledTimes(1);
    });

    it("supersession stamp failure is non-fatal — the new insight is still returned", async () => {
      const inserted = {
        id: "new-id",
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "saved despite stamp failure",
        detail: null,
        source: null,
        encrypted: false,
        created_at: "2026-05-28",
        updated_at: "2026-05-28",
        superseded_by: null,
      };
      const stampError = {
        name: "PostgrestError",
        code: "42501",
        message: "permission denied on supersession update",
        details: "",
        hint: "",
      };
      // INSERT succeeds, UPDATE fails — the contract says we log + swallow
      // so the response shape stays stable. Without this guarantee a
      // transient stamp failure would break save_insight entirely.
      const db = createSequentialMockDb({ data: inserted, error: null }, { data: null, error: stampError });

      // Silence the console.error so the test output stays clean —
      // we're asserting on the throw behavior, not on the log.
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await createInsight(db as unknown as SupabaseClient, {
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "saved despite stamp failure",
        supersedes: ["old-x"],
      });

      expect(result).toEqual(inserted);
      // The error WAS observed (logged), but not thrown.
      expect(errSpy).toHaveBeenCalled();

      errSpy.mockRestore();
    });

    it("INSERT error still propagates — supersedes logic does not mask insert failures", async () => {
      // If the INSERT fails, we never even reach the supersession step.
      // This guards against a refactor that wraps the entire body in a
      // try/catch and silently swallows the contract-critical INSERT err.
      const insertError = {
        name: "PostgrestError",
        code: "23503",
        message: "foreign key violation",
        details: "",
        hint: "",
      };
      const db = createSequentialMockDb({ data: null, error: insertError });

      await expect(
        createInsight(db as unknown as SupabaseClient, {
          project_id: "proj1",
          user_id: "u1",
          type: "decision",
          summary: "won't insert",
          supersedes: ["a", "b"],
        }),
      ).rejects.toMatchObject({ code: "23503" });

      // Only the failed INSERT call — no UPDATE attempt after a failed INSERT.
      expect(db.from).toHaveBeenCalledTimes(1);
    });
  });

  // ── superseded_by exposed on return shape ──────────────────────
  describe("Insight type — superseded_by column is selected", () => {
    it("createInsight SELECT clause includes superseded_by", async () => {
      const db = mockSuccess({
        id: "new-id",
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "x",
        detail: null,
        source: null,
        encrypted: false,
        created_at: "2026-05-28",
        updated_at: "2026-05-28",
        superseded_by: null,
      });

      await createInsight(db as unknown as SupabaseClient, {
        project_id: "proj1",
        user_id: "u1",
        type: "decision",
        summary: "x",
      });

      // The .select() call after .insert() must include superseded_by
      // so downstream callers (briefs, dashboards) can check it.
      const selectCall = (db.chainable.select as Mock).mock.calls[0][0] as string;
      expect(selectCall).toContain("superseded_by");
    });
  });
});
