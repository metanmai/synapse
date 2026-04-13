import type { SupabaseClient } from "@supabase/supabase-js";
import { type Mock, describe, expect, it, vi } from "vitest";
import { createMockDb, mockNoRows, mockSuccess } from "./mock-supabase";

// ── Entries ──────────────────────────────────────────────────────
import { countEntries, deleteEntry, getEntry, listEntries, upsertEntry } from "../../src/db/queries/entries";

// ── Projects ─────────────────────────────────────────────────────
import {
  addMember,
  countMembers,
  createProject,
  getMemberRole,
  getProjectByName,
  removeMember,
} from "../../src/db/queries/projects";

// ── API keys ─────────────────────────────────────────────────────
import {
  ApiKeyExpiredError,
  countApiKeys,
  createApiKey,
  deleteApiKey,
  findUserByApiKeyHash,
} from "../../src/db/queries/api-keys";

// ── Subscriptions ────────────────────────────────────────────────
import { getActiveSubscription, upsertSubscription } from "../../src/db/queries/subscriptions";

// ── Share links ──────────────────────────────────────────────────
import { createShareLink, deleteShareLink, getShareLinkByToken } from "../../src/db/queries/share-links";

// ─────────────────────────────────────────────────────────────────
// Helper: build a chainable mock where each call to `from()` can
// return a DIFFERENT chain (needed for multi-step queries like
// upsertEntry which calls from("entries") then from("entry_history")
// then from("entries") again).
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

    chains.push(chainable as any);
    return chainable;
  });

  return { from, chains };
}

// ═════════════════════════════════════════════════════════════════
// ENTRIES
// ═════════════════════════════════════════════════════════════════
describe("entries queries", () => {
  // ── upsertEntry (new entry) ────────────────────────────────
  describe("upsertEntry — new entry", () => {
    it("queries entries, then inserts when no existing row", async () => {
      const created = {
        id: "e1",
        project_id: "p1",
        path: "notes/a.md",
        content: "hello",
        content_type: "markdown",
        author_id: null,
        source: "claude",
        tags: [],
        google_doc_id: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      };

      // 1st from("entries").select().eq().eq().single() → no rows
      // 2nd from("entries").insert().select().single() → created row
      const noRowsResp = {
        data: null,
        error: { name: "PostgrestError", code: "PGRST116", message: "No rows found", details: "", hint: "" },
      };
      const db = createSequentialMockDb(noRowsResp, { data: created, error: null });

      const result = await upsertEntry(db as unknown as SupabaseClient, {
        project_id: "p1",
        path: "notes/a.md",
        content: "hello",
      });

      expect(result).toEqual(created);
      // First call: select existing
      expect(db.from).toHaveBeenNthCalledWith(1, "entries");
      // Second call: insert new
      expect(db.from).toHaveBeenNthCalledWith(2, "entries");
      // Verify insert was called on second chain
      expect(db.chains[1].insert).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "p1",
          path: "notes/a.md",
          content: "hello",
          content_type: "markdown",
          source: "claude",
          tags: [],
        }),
      );
    });
  });

  // ── upsertEntry (existing entry → update + history) ─────────
  describe("upsertEntry — existing entry", () => {
    it("saves to history then updates when entry exists", async () => {
      const existing = {
        id: "e1",
        project_id: "p1",
        path: "notes/a.md",
        content: "old",
        content_type: "markdown",
        author_id: null,
        source: "human",
        tags: ["x"],
        google_doc_id: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      };
      const updated = { ...existing, content: "new", updated_at: "2026-01-02" };

      // 1st from("entries").select...single() → existing
      // 2nd from("entry_history").insert(...) → ok
      // 3rd from("entries").update...single() → updated
      const db = createSequentialMockDb(
        { data: existing, error: null },
        { data: null, error: null },
        { data: updated, error: null },
      );

      const result = await upsertEntry(db as unknown as SupabaseClient, {
        project_id: "p1",
        path: "notes/a.md",
        content: "new",
      });

      expect(result).toEqual(updated);
      // History insert
      expect(db.from).toHaveBeenNthCalledWith(2, "entry_history");
      expect(db.chains[1].insert).toHaveBeenCalledWith({
        entry_id: "e1",
        content: "old",
        source: "human",
      });
      // Update on 3rd chain
      expect(db.from).toHaveBeenNthCalledWith(3, "entries");
      expect(db.chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ content: "new" }));
      expect(db.chains[2].eq).toHaveBeenCalledWith("id", "e1");
    });
  });

  // ── getEntry ───────────────────────────────────────────────
  describe("getEntry", () => {
    it("queries entries with project_id and path filters", async () => {
      const row = {
        id: "e1",
        project_id: "p1",
        path: "docs/a.md",
        content: "hi",
        content_type: "markdown",
      };
      const db = mockSuccess(row);

      // getEntry uses singleOrNull which reads .error/.data from the single() result
      // single() in mockSuccess resolves to { data: row, error: null }
      const result = await getEntry(db as unknown as SupabaseClient, "p1", "docs/a.md");

      expect(db.from).toHaveBeenCalledWith("entries");
      expect(db.chainable.select).toHaveBeenCalled();
      expect(db.chainable.eq).toHaveBeenCalledWith("project_id", "p1");
      expect(db.chainable.eq).toHaveBeenCalledWith("path", "docs/a.md");
      expect(db.chainable.single).toHaveBeenCalled();
      expect(result).toEqual(row);
    });

    it("returns null when no entry found (PGRST116)", async () => {
      const db = mockNoRows();
      const result = await getEntry(db as unknown as SupabaseClient, "p1", "missing.md");
      expect(result).toBeNull();
    });
  });

  // ── listEntries ────────────────────────────────────────────
  describe("listEntries", () => {
    it("queries with project_id and orders by path", async () => {
      const db = createMockDb({ data: [], error: null });
      await listEntries(db as unknown as SupabaseClient, "p1");

      expect(db.from).toHaveBeenCalledWith("entries");
      expect(db.chainable.select).toHaveBeenCalledWith("path, content_type, tags, updated_at");
      expect(db.chainable.eq).toHaveBeenCalledWith("project_id", "p1");
      expect(db.chainable.order).toHaveBeenCalledWith("path", { ascending: true });
    });

    it("applies folder filter with LIKE when folder provided", async () => {
      const db = createMockDb({ data: [], error: null });
      await listEntries(db as unknown as SupabaseClient, "p1", "notes");

      expect(db.chainable.like).toHaveBeenCalledWith("path", "notes/%");
    });

    it("does NOT apply LIKE when no folder provided", async () => {
      const db = createMockDb({ data: [], error: null });
      await listEntries(db as unknown as SupabaseClient, "p1");

      expect(db.chainable.like).not.toHaveBeenCalled();
    });
  });

  // ── deleteEntry ────────────────────────────────────────────
  describe("deleteEntry", () => {
    it("deletes from entries with project_id and path filters", async () => {
      const db = createMockDb({ data: null, error: null });
      await deleteEntry(db as unknown as SupabaseClient, "p1", "notes/a.md");

      expect(db.from).toHaveBeenCalledWith("entries");
      expect(db.chainable.delete).toHaveBeenCalled();
      expect(db.chainable.eq).toHaveBeenCalledWith("project_id", "p1");
      expect(db.chainable.eq).toHaveBeenCalledWith("path", "notes/a.md");
    });

    it("throws when Supabase returns an error", async () => {
      const db = createMockDb({
        data: null,
        error: { name: "PostgrestError", code: "42501", message: "permission denied", details: "", hint: "" },
      });
      await expect(deleteEntry(db as unknown as SupabaseClient, "p1", "x")).rejects.toEqual(
        expect.objectContaining({ message: "permission denied" }),
      );
    });
  });

  // ── countEntries ───────────────────────────────────────────
  describe("countEntries", () => {
    it("uses count: exact and head: true", async () => {
      const db = createMockDb({ data: null, error: null, count: 42 });
      const result = await countEntries(db as unknown as SupabaseClient, "p1");

      expect(db.from).toHaveBeenCalledWith("entries");
      expect(db.chainable.select).toHaveBeenCalledWith("*", { count: "exact", head: true });
      expect(db.chainable.eq).toHaveBeenCalledWith("project_id", "p1");
      expect(result).toBe(42);
    });

    it("returns 0 when count is null", async () => {
      const db = createMockDb({ data: null, error: null, count: null });
      const result = await countEntries(db as unknown as SupabaseClient, "p1");
      expect(result).toBe(0);
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PROJECTS
// ═════════════════════════════════════════════════════════════════
describe("projects queries", () => {
  // ── createProject ──────────────────────────────────────────
  describe("createProject", () => {
    it("inserts project AND adds owner as member", async () => {
      const project = { id: "proj1", name: "myproject", owner_id: "u1", created_at: "2026-01-01" };
      const db = createSequentialMockDb(
        { data: project, error: null }, // insert project
        { data: null, error: null }, // insert member
      );

      const result = await createProject(db as unknown as SupabaseClient, "myproject", "u1");

      expect(result).toEqual(project);
      // 1st call: insert project
      expect(db.from).toHaveBeenNthCalledWith(1, "projects");
      expect(db.chains[0].insert).toHaveBeenCalledWith({ name: "myproject", owner_id: "u1" });
      // 2nd call: insert owner as member
      expect(db.from).toHaveBeenNthCalledWith(2, "project_members");
      expect(db.chains[1].insert).toHaveBeenCalledWith({
        project_id: "proj1",
        user_id: "u1",
        role: "owner",
      });
    });

    it("throws if project insert fails", async () => {
      const db = createSequentialMockDb({
        data: null,
        error: { name: "PostgrestError", code: "23505", message: "duplicate key", details: "", hint: "" },
      });

      await expect(createProject(db as unknown as SupabaseClient, "dup", "u1")).rejects.toEqual(
        expect.objectContaining({ message: "duplicate key" }),
      );
    });
  });

  // ── getProjectByName (qualified) ───────────────────────────
  describe("getProjectByName", () => {
    it("handles qualified name (owner~name) format", async () => {
      const project = { id: "proj1", name: "myproject", owner_id: "u1" };
      const db = mockSuccess(project);

      await getProjectByName(db as unknown as SupabaseClient, "alice@test.com~myproject", "u2");

      expect(db.from).toHaveBeenCalledWith("projects");
      expect(db.chainable.select).toHaveBeenCalledWith(
        "*, project_members!inner(user_id), users!projects_owner_id_fkey(email)",
      );
      expect(db.chainable.eq).toHaveBeenCalledWith("name", "myproject");
      expect(db.chainable.eq).toHaveBeenCalledWith("users.email", "alice@test.com");
      expect(db.chainable.eq).toHaveBeenCalledWith("project_members.user_id", "u2");
      expect(db.chainable.limit).toHaveBeenCalledWith(1);
      expect(db.chainable.maybeSingle).toHaveBeenCalled();
    });

    it("handles unqualified name — tries owned first", async () => {
      const project = { id: "proj1", name: "myproject", owner_id: "u1" };
      // 1st call: owned project lookup → found
      const db = createSequentialMockDb({ data: project, error: null });

      const result = await getProjectByName(db as unknown as SupabaseClient, "myproject", "u1");

      expect(result).toEqual(project);
      expect(db.from).toHaveBeenNthCalledWith(1, "projects");
      expect(db.chains[0].eq).toHaveBeenCalledWith("name", "myproject");
      expect(db.chains[0].eq).toHaveBeenCalledWith("project_members.user_id", "u1");
      expect(db.chains[0].eq).toHaveBeenCalledWith("project_members.role", "owner");
    });

    it("falls back to shared membership when not owned", async () => {
      const shared = { id: "proj2", name: "shared", owner_id: "u2" };
      // 1st call: owned → null
      // 2nd call: shared → found
      const db = createSequentialMockDb({ data: null, error: null }, { data: shared, error: null });

      const result = await getProjectByName(db as unknown as SupabaseClient, "shared", "u1");

      expect(result).toEqual(shared);
      expect(db.from).toHaveBeenCalledTimes(2);
      expect(db.from).toHaveBeenNthCalledWith(2, "projects");
      expect(db.chains[1].select).toHaveBeenCalledWith("*, project_members!inner(user_id)");
    });
  });

  // ── getMemberRole ──────────────────────────────────────────
  describe("getMemberRole", () => {
    it("queries project_members with correct filters", async () => {
      const db = mockSuccess({ role: "editor" });
      const result = await getMemberRole(db as unknown as SupabaseClient, "proj1", "u1");

      expect(db.from).toHaveBeenCalledWith("project_members");
      expect(db.chainable.select).toHaveBeenCalledWith("role");
      expect(db.chainable.eq).toHaveBeenCalledWith("project_id", "proj1");
      expect(db.chainable.eq).toHaveBeenCalledWith("user_id", "u1");
      expect(db.chainable.single).toHaveBeenCalled();
      expect(result).toBe("editor");
    });

    it("returns null when user is not a member", async () => {
      const db = mockNoRows();
      const result = await getMemberRole(db as unknown as SupabaseClient, "proj1", "u999");
      expect(result).toBeNull();
    });
  });

  // ── addMember ──────────────────────────────────────────────
  describe("addMember", () => {
    it("inserts with correct project, user, and role", async () => {
      const member = { project_id: "proj1", user_id: "u2", role: "editor" };
      const db = mockSuccess(member);
      const result = await addMember(db as unknown as SupabaseClient, "proj1", "u2", "editor");

      expect(db.from).toHaveBeenCalledWith("project_members");
      expect(db.chainable.upsert).toHaveBeenCalledWith(
        { project_id: "proj1", user_id: "u2", role: "editor" },
        { onConflict: "project_id,user_id" },
      );
      expect(db.chainable.select).toHaveBeenCalled();
      expect(db.chainable.single).toHaveBeenCalled();
      expect(result).toEqual(member);
    });
  });

  // ── countMembers ───────────────────────────────────────────
  describe("countMembers", () => {
    it("uses count: exact, head: true and excludes owner", async () => {
      const db = createMockDb({ data: null, error: null, count: 3 });
      const result = await countMembers(db as unknown as SupabaseClient, "proj1");

      expect(db.from).toHaveBeenCalledWith("project_members");
      expect(db.chainable.select).toHaveBeenCalledWith("*", { count: "exact", head: true });
      expect(db.chainable.eq).toHaveBeenCalledWith("project_id", "proj1");
      expect(db.chainable.neq).toHaveBeenCalledWith("role", "owner");
      expect(result).toBe(3);
    });
  });

  // ── removeMember ───────────────────────────────────────────
  describe("removeMember", () => {
    it("deletes with project_id and user_id filters", async () => {
      const db = createMockDb({ data: null, error: null });
      await removeMember(db as unknown as SupabaseClient, "proj1", "u2");

      expect(db.from).toHaveBeenCalledWith("project_members");
      expect(db.chainable.delete).toHaveBeenCalled();
      expect(db.chainable.eq).toHaveBeenCalledWith("project_id", "proj1");
      expect(db.chainable.eq).toHaveBeenCalledWith("user_id", "u2");
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// API KEYS
// ═════════════════════════════════════════════════════════════════
describe("api-keys queries", () => {
  // ── findUserByApiKeyHash ───────────────────────────────────
  describe("findUserByApiKeyHash", () => {
    it("queries by key_hash with user join", async () => {
      const user = { id: "u1", email: "test@test.com", supabase_auth_id: null, created_at: "2026-01-01" };
      const db = mockSuccess({
        id: "ak1",
        user_id: "u1",
        expires_at: null,
        users: user,
      });

      const result = await findUserByApiKeyHash(db as unknown as SupabaseClient, "hash123");

      expect(db.from).toHaveBeenCalledWith("api_keys");
      expect(db.chainable.select).toHaveBeenCalledWith("id, user_id, expires_at, users(*)");
      expect(db.chainable.eq).toHaveBeenCalledWith("key_hash", "hash123");
      expect(db.chainable.limit).toHaveBeenCalledWith(1);
      expect(db.chainable.maybeSingle).toHaveBeenCalled();
      expect(result).toEqual({ user, apiKeyId: "ak1" });
    });

    it("returns null when no matching key", async () => {
      const db = createMockDb({ data: null, error: null });
      const result = await findUserByApiKeyHash(db as unknown as SupabaseClient, "badhash");
      expect(result).toBeNull();
    });

    it("throws ApiKeyExpiredError when key is expired", async () => {
      const db = mockSuccess({
        id: "ak1",
        user_id: "u1",
        expires_at: "2020-01-01T00:00:00Z", // in the past
        users: { id: "u1", email: "test@test.com" },
      });

      await expect(findUserByApiKeyHash(db as unknown as SupabaseClient, "hash123")).rejects.toBeInstanceOf(
        ApiKeyExpiredError,
      );
    });

    it("does NOT throw when expires_at is in the future", async () => {
      const user = { id: "u1", email: "test@test.com" };
      const db = mockSuccess({
        id: "ak1",
        user_id: "u1",
        expires_at: "2099-12-31T23:59:59Z",
        users: user,
      });

      const result = await findUserByApiKeyHash(db as unknown as SupabaseClient, "hash123");
      expect(result).toEqual({ user, apiKeyId: "ak1" });
    });
  });

  // ── createApiKey ───────────────────────────────────────────
  describe("createApiKey", () => {
    it("inserts with correct fields", async () => {
      const key = {
        id: "ak1",
        user_id: "u1",
        key_hash: "h",
        label: "My Key",
        expires_at: "2099-01-01",
        last_used_at: null,
        created_at: "2026-01-01",
      };
      const db = mockSuccess(key);

      const result = await createApiKey(db as unknown as SupabaseClient, "u1", "h", "My Key", "2099-01-01");

      expect(db.from).toHaveBeenCalledWith("api_keys");
      expect(db.chainable.insert).toHaveBeenCalledWith({
        user_id: "u1",
        key_hash: "h",
        label: "My Key",
        expires_at: "2099-01-01",
      });
      expect(db.chainable.select).toHaveBeenCalled();
      expect(db.chainable.single).toHaveBeenCalled();
      expect(result).toEqual(key);
    });

    it("defaults expires_at to null when not provided", async () => {
      const db = mockSuccess({ id: "ak1" });
      await createApiKey(db as unknown as SupabaseClient, "u1", "h", "Key");

      expect(db.chainable.insert).toHaveBeenCalledWith(expect.objectContaining({ expires_at: null }));
    });
  });

  // ── deleteApiKey ───────────────────────────────────────────
  describe("deleteApiKey", () => {
    it("filters by both keyId AND userId for security", async () => {
      const db = createMockDb({ data: null, error: null, count: 1 });
      const result = await deleteApiKey(db as unknown as SupabaseClient, "ak1", "u1");

      expect(db.from).toHaveBeenCalledWith("api_keys");
      expect(db.chainable.delete).toHaveBeenCalledWith({ count: "exact" });
      expect(db.chainable.eq).toHaveBeenCalledWith("id", "ak1");
      expect(db.chainable.eq).toHaveBeenCalledWith("user_id", "u1");
      expect(result).toBe(true);
    });

    it("returns false when no rows deleted", async () => {
      const db = createMockDb({ data: null, error: null, count: 0 });
      const result = await deleteApiKey(db as unknown as SupabaseClient, "ak1", "u999");
      expect(result).toBe(false);
    });
  });

  // ── countApiKeys ───────────────────────────────────────────
  describe("countApiKeys", () => {
    it("counts for specific user with exact count", async () => {
      const db = createMockDb({ data: null, error: null, count: 5 });
      const result = await countApiKeys(db as unknown as SupabaseClient, "u1");

      expect(db.from).toHaveBeenCalledWith("api_keys");
      expect(db.chainable.select).toHaveBeenCalledWith("*", { count: "exact", head: true });
      expect(db.chainable.eq).toHaveBeenCalledWith("user_id", "u1");
      expect(result).toBe(5);
    });

    it("returns 0 when count is null", async () => {
      const db = createMockDb({ data: null, error: null, count: null });
      const result = await countApiKeys(db as unknown as SupabaseClient, "u1");
      expect(result).toBe(0);
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS
// ═════════════════════════════════════════════════════════════════
describe("subscriptions queries", () => {
  // ── getActiveSubscription ──────────────────────────────────
  describe("getActiveSubscription", () => {
    it("filters by status IN [active, past_due]", async () => {
      const sub = {
        id: "s1",
        user_id: "u1",
        provider: "creem",
        status: "active",
        provider_subscription_id: "sub_1",
      };
      const db = mockSuccess(sub);
      const result = await getActiveSubscription(db as unknown as SupabaseClient, "u1");

      expect(db.from).toHaveBeenCalledWith("subscriptions");
      expect(db.chainable.select).toHaveBeenCalledWith("*");
      expect(db.chainable.eq).toHaveBeenCalledWith("user_id", "u1");
      expect(db.chainable.in).toHaveBeenCalledWith("status", ["active", "past_due"]);
      expect(db.chainable.order).toHaveBeenCalledWith("created_at", { ascending: false });
      expect(db.chainable.limit).toHaveBeenCalledWith(1);
      expect(db.chainable.maybeSingle).toHaveBeenCalled();
      expect(result).toEqual(sub);
    });

    it("returns null when no active subscription", async () => {
      const db = createMockDb({ data: null, error: null });
      const result = await getActiveSubscription(db as unknown as SupabaseClient, "u1");
      expect(result).toBeNull();
    });
  });

  // ── upsertSubscription ─────────────────────────────────────
  describe("upsertSubscription", () => {
    it("uses onConflict: provider_subscription_id", async () => {
      const sub = {
        id: "s1",
        user_id: "u1",
        provider: "creem",
        provider_subscription_id: "sub_1",
        status: "active",
      };
      const db = mockSuccess(sub);

      const result = await upsertSubscription(db as unknown as SupabaseClient, {
        user_id: "u1",
        provider_subscription_id: "sub_1",
        status: "active",
      });

      expect(db.from).toHaveBeenCalledWith("subscriptions");
      expect(db.chainable.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "u1",
          provider: "creem",
          provider_subscription_id: "sub_1",
          status: "active",
          cancel_at_period_end: false,
        }),
        { onConflict: "provider_subscription_id" },
      );
      expect(db.chainable.select).toHaveBeenCalled();
      expect(db.chainable.single).toHaveBeenCalled();
      expect(result).toEqual(sub);
    });

    it("passes through optional fields", async () => {
      const db = mockSuccess({ id: "s1" });

      await upsertSubscription(db as unknown as SupabaseClient, {
        user_id: "u1",
        provider: "stripe",
        provider_subscription_id: "sub_2",
        provider_customer_id: "cus_123",
        status: "past_due",
        current_period_end: "2026-12-31",
        cancel_at_period_end: true,
      });

      expect(db.chainable.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "stripe",
          provider_customer_id: "cus_123",
          status: "past_due",
          current_period_end: "2026-12-31",
          cancel_at_period_end: true,
        }),
        { onConflict: "provider_subscription_id" },
      );
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// SHARE LINKS
// ═════════════════════════════════════════════════════════════════
describe("share-links queries", () => {
  // ── createShareLink ────────────────────────────────────────
  describe("createShareLink", () => {
    it("inserts with correct fields", async () => {
      const link = {
        id: "sl1",
        project_id: "proj1",
        token: "tok123",
        role: "viewer",
        created_by: "u1",
        expires_at: "2099-01-01",
      };
      const db = mockSuccess(link);

      const result = await createShareLink(db as unknown as SupabaseClient, "proj1", "viewer", "u1", "2099-01-01");

      expect(db.from).toHaveBeenCalledWith("share_links");
      expect(db.chainable.insert).toHaveBeenCalledWith({
        project_id: "proj1",
        role: "viewer",
        created_by: "u1",
        expires_at: "2099-01-01",
      });
      expect(db.chainable.select).toHaveBeenCalled();
      expect(db.chainable.single).toHaveBeenCalled();
      expect(result).toEqual(link);
    });

    it("defaults expires_at to null when not provided", async () => {
      const db = mockSuccess({ id: "sl1" });
      await createShareLink(db as unknown as SupabaseClient, "proj1", "editor", "u1");

      expect(db.chainable.insert).toHaveBeenCalledWith(expect.objectContaining({ expires_at: null }));
    });
  });

  // ── getShareLinkByToken ────────────────────────────────────
  describe("getShareLinkByToken", () => {
    it("queries by token", async () => {
      const link = { id: "sl1", token: "tok123", project_id: "proj1", role: "viewer" };
      const db = mockSuccess(link);
      const result = await getShareLinkByToken(db as unknown as SupabaseClient, "tok123");

      expect(db.from).toHaveBeenCalledWith("share_links");
      expect(db.chainable.select).toHaveBeenCalledWith("*");
      expect(db.chainable.eq).toHaveBeenCalledWith("token", "tok123");
      expect(db.chainable.single).toHaveBeenCalled();
      expect(result).toEqual(link);
    });

    it("returns null when token not found", async () => {
      const db = mockNoRows();
      const result = await getShareLinkByToken(db as unknown as SupabaseClient, "bad-token");
      expect(result).toBeNull();
    });
  });

  // ── deleteShareLink ────────────────────────────────────────
  describe("deleteShareLink", () => {
    it("filters by project_id AND token", async () => {
      const db = createMockDb({ data: null, error: null });
      await deleteShareLink(db as unknown as SupabaseClient, "proj1", "tok123");

      expect(db.from).toHaveBeenCalledWith("share_links");
      expect(db.chainable.delete).toHaveBeenCalled();
      expect(db.chainable.eq).toHaveBeenCalledWith("project_id", "proj1");
      expect(db.chainable.eq).toHaveBeenCalledWith("token", "tok123");
    });

    it("throws when deletion fails", async () => {
      const db = createMockDb({
        data: null,
        error: { name: "PostgrestError", code: "42501", message: "permission denied", details: "", hint: "" },
      });
      await expect(deleteShareLink(db as unknown as SupabaseClient, "proj1", "tok123")).rejects.toEqual(
        expect.objectContaining({ message: "permission denied" }),
      );
    });
  });
});
