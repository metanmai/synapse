// backend/test/api/capture-browser.test.ts
//
// Slice A — the security-critical core of the self-sufficient browser
// extension. Two things under guard:
//
//  1. CAPTURE-SCOPED KEYS ARE FAIL-CLOSED. A `scope:"capture"` key may reach
//     ONLY POST /api/capture/browser. On every other authed route it's 403.
//     This is the whole blast-radius argument for the scoped token — if it
//     can read /api/projects or delete a conversation, the safer-option
//     promise is broken. The adversarial table below is the regression guard.
//  2. The ingest endpoint allowlists + scrubs (pure normalizeBrowserCapture)
//     and persists a conversation.
//
// Feature-detection: a key row with NO `scope` field (pre-migration prod)
// must default to "full" — the core auth path can't 500 before migration 031.

import { vi } from "vitest";
import { __mockState__ } from "../helpers/supabase-mock";

vi.mock("../../src/db/client", () => ({
  createSupabaseClient: () => __mockState__.db?.client,
}));

import { beforeEach, describe, expect, it } from "vitest";
import { normalizeBrowserCapture } from "../../src/api/capture";
import worker from "../../src/index";
import {
  type MockSupabase,
  bearer,
  makeContractTestEnv,
  makeMockSupabase,
  resetMockState,
  setMockDb,
} from "../helpers/supabase-mock";
import { createExecutionContext, waitOnExecutionContext } from "../setup";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "ext@e2e.local" };

/** Seed the api_keys lookup to return a key with the given scope (omit → no
 *  scope field at all, exercising the feature-detection default). */
function seedKey(db: MockSupabase, scope?: string): void {
  db.tables.api_keys = {
    maybeSingle: () => ({
      data: {
        id: "key-uuid",
        user_id: USER.id,
        expires_at: null,
        ...(scope ? { scope } : {}),
        users: { ...USER },
      },
      error: null,
    }),
  };
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: bearer("any-key") };
  if (body !== undefined) init.body = JSON.stringify(body);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`http://localhost${path}`, init), makeContractTestEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(() => resetMockState());

describe("normalizeBrowserCapture — allowlist + scrub (pure)", () => {
  it("rejects an unknown host", () => {
    const r = normalizeBrowserCapture({ host: "evil.com", messages: [{ role: "user", content: "x" }] });
    expect("error" in r).toBe(true);
  });

  it("rejects a lookalike host (exact match only — not claude.ai.evil.com)", () => {
    const r = normalizeBrowserCapture({ host: "claude.ai.evil.com", messages: [{ role: "user", content: "x" }] });
    expect("error" in r).toBe(true);
  });

  it("rejects when there are no capturable messages", () => {
    expect("error" in normalizeBrowserCapture({ host: "claude.ai", messages: [] })).toBe(true);
    expect("error" in normalizeBrowserCapture({ host: "claude.ai", messages: [{ role: "user", content: "" }] })).toBe(
      true,
    );
  });

  it("coerces unknown roles to user, keeps assistant", () => {
    const r = normalizeBrowserCapture({
      host: "chatgpt.com",
      messages: [
        { role: "system", content: "a" },
        { role: "assistant", content: "b" },
      ],
    });
    if ("error" in r) throw new Error("expected success");
    expect(r.messages).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
  });

  it("scrubs token-shaped values from content", () => {
    const r = normalizeBrowserCapture({
      host: "claude.ai",
      messages: [{ role: "user", content: "key sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGG done" }],
    });
    if ("error" in r) throw new Error("expected success");
    expect(r.messages[0].content).not.toContain("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGG");
    expect(r.messages[0].content).toContain("[REDACTED]");
  });

  it("ignores any non-allowlisted keys (cookies/headers can't survive)", () => {
    const r = normalizeBrowserCapture({
      host: "claude.ai",
      messages: [{ role: "user", content: "hi", cookie: "secret=abc" }],
      cookies: "session=xyz",
      headers: { authorization: "Bearer leak" },
    });
    if ("error" in r) throw new Error("expected success");
    expect(r).toEqual({ host: "claude.ai", messages: [{ role: "user", content: "hi" }] });
  });
});

describe("capture-scoped key is FAIL-CLOSED outside the ingest endpoint", () => {
  // Representative authed routes a capture key must NEVER reach.
  const FORBIDDEN: Array<{ method: string; path: string; body?: unknown }> = [
    { method: "GET", path: "/api/projects" },
    { method: "POST", path: "/api/conversations", body: {} },
    { method: "GET", path: "/api/insights" },
    { method: "GET", path: "/api/account/usage" },
  ];

  it.each(FORBIDDEN)("403 on $method $path", async ({ method, path, body }) => {
    const db = makeMockSupabase();
    seedKey(db, "capture");
    setMockDb(db);
    const res = await send(method, path, body);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe("FORBIDDEN");
  });

  it("never wrote anything (403 fires in auth, before any handler)", async () => {
    const db = makeMockSupabase();
    seedKey(db, "capture");
    setMockDb(db);
    await send("POST", "/api/conversations", { title: "x" });
    expect(db.calls.some((c) => c.op === "insert")).toBe(false);
  });
});

describe("scope does NOT block the allowlisted ingest path or full keys", () => {
  it("a capture key REACHES POST /api/capture/browser (not 403/401)", async () => {
    const db = makeMockSupabase();
    seedKey(db, "capture");
    setMockDb(db);
    // Bad body → 400 from the handler, but crucially NOT 403 (auth let it in).
    const res = await send("POST", "/api/capture/browser", { host: "nope" });
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(400);
  });

  it("a FULL-scope key is NOT scope-gated on other routes", async () => {
    const db = makeMockSupabase();
    seedKey(db, "full");
    setMockDb(db);
    const res = await send("GET", "/api/projects");
    expect(res.status).not.toBe(403);
  });

  it("feature-detection: a key with NO scope field defaults to full (pre-migration safe)", async () => {
    const db = makeMockSupabase();
    seedKey(db); // no scope field at all
    setMockDb(db);
    const res = await send("GET", "/api/projects");
    expect(res.status).not.toBe(403);
  });
});

describe("POST /api/capture/browser — persists a scrubbed conversation", () => {
  it("ingests, scrubs, and creates a conversation (capture key, 200)", async () => {
    const db = makeMockSupabase();
    seedKey(db, "capture");
    // Persist path: existing per-host project (no create/quota), then conversation + messages.
    db.tables.project_members = { select: () => ({ data: [{ project_id: "proj-1" }], error: null }) };
    db.tables.projects = { maybeSingle: () => ({ data: { id: "proj-1", git_remote_url: "x" }, error: null }) };
    db.tables.conversations = { insertSingle: () => ({ data: { id: "conv-1", project_id: "proj-1" }, error: null }) };
    db.tables.conversation_messages = {
      maybeSingle: () => ({ data: null, error: null }), // max sequence 0
      insert: () => ({ data: [{ id: "m1" }], error: null }),
      insertSingle: () => ({ data: { id: "m1" }, error: null }),
    };
    setMockDb(db);

    const res = await send("POST", "/api/capture/browser", {
      host: "claude.ai",
      messages: [
        { role: "user", content: "my token is sk-ant-api03-ZZZZYYYYXXXXWWWWVVVVUUUUTTTT keep it" },
        { role: "assistant", content: "noted" },
      ],
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; conversation_id?: string };
    expect(json.ok).toBe(true);
    expect(json.conversation_id).toBe("conv-1");

    // The secret must have been scrubbed before the messages insert.
    const msgInsert = db.calls.find((c) => c.table === "conversation_messages" && c.op === "insert");
    expect(msgInsert, "expected a conversation_messages insert").toBeDefined();
    const serialized = JSON.stringify(msgInsert?.args);
    expect(serialized).not.toContain("sk-ant-api03-ZZZZYYYYXXXXWWWWVVVVUUUUTTTT");
    expect(serialized).toContain("[REDACTED]");
  });

  it("returns 400 on an unknown host (allowlist)", async () => {
    const db = makeMockSupabase();
    seedKey(db, "capture");
    setMockDb(db);
    const res = await send("POST", "/api/capture/browser", {
      host: "evil.com",
      messages: [{ role: "user", content: "x" }],
    });
    expect(res.status).toBe(400);
  });
});
