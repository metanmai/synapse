// backend/test/api/account-keys-rename.test.ts
//
// BUG #6 guards: PATCH /api/account/keys/:id (rename).
//
// Two layers tested:
//
// 1. Pure-fn `computeRenamedLabel(existingLabel, userInput)` — the
//    cli-prefix preservation logic. This is the rule with the highest
//    correctness stakes: a bug here corrupts the device-cap accounting
//    (Free-tier users get the wrong count, picker decisions go sideways).
//
// 2. Smoke: the PATCH route is mounted under authMiddleware (401 without
//    Bearer) AND auth runs before schema validation (401 even on bad
//    body, NOT 400 — guards against leaking schema shape to
//    unauthenticated probers).
//
// End-to-end with a real DB is gated on the test-Supabase secrets gap
// (BUGS.md "5a"). When secrets land, add a round-trip case here.

import { describe, expect, it } from "vitest";
import { computeRenamedLabel } from "../../src/api/auth";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("computeRenamedLabel — cli- prefix preservation", () => {
  it("preserves the cli- prefix when the existing row had it", () => {
    // Bug class: user types "macbook" in the dashboard for a key
    // stored as "cli-old-laptop". The persisted label MUST be
    // "cli-macbook" so countCliKeys keeps including it; without the
    // prefix the row falls out of device-cap accounting and the user
    // can never hit the limit again until a different code path
    // re-adds the prefix.
    expect(computeRenamedLabel("cli-old-laptop", "macbook")).toBe("cli-macbook");
  });

  it("does NOT add the prefix to a non-cli key when input is bare", () => {
    // Bug class: adding cli- to a non-CLI key inflates the device count
    // and pushes Free-tier users over their cap inappropriately.
    expect(computeRenamedLabel("default", "production-token")).toBe("production-token");
  });

  it("STRIPS a leading cli- from user input on a non-cli key (user can't escape into cli- namespace)", () => {
    // Bug class: dashboard UI passes the stripped form, but a script
    // hitting the API directly could send "cli-foo" to a non-CLI key
    // and that would inflate device-cap accounting on next read.
    expect(computeRenamedLabel("default", "cli-sneaky")).toBe("sneaky");
  });

  it("STRIPS a leading cli- from user input on a cli- key (no double-prefix)", () => {
    // Bug class: user re-edits an already-renamed device. Dashboard
    // shows "macbook"; user types "cli-macbook" by mistake. Result
    // must NOT be "cli-cli-macbook" — that would un-match listCliKeys'
    // `LIKE 'cli-%'` filter on a casual read but still survive the
    // prefix-strip on display, leaving a permanently weird row.
    expect(computeRenamedLabel("cli-foo", "cli-bar")).toBe("cli-bar");
  });

  it("handles an empty input gracefully (no crash; schema-side validation rejects empty before this is called)", () => {
    // Defensive: schema requires min(1) so this path shouldn't fire
    // in production, but the helper should still produce a sensible
    // result if called directly.
    expect(computeRenamedLabel("cli-foo", "")).toBe("cli-");
    expect(computeRenamedLabel("default", "")).toBe("");
  });
});

describe("PATCH /api/account/keys/:id — auth gate", () => {
  it("returns 401 without auth header (route is mounted under authMiddleware)", async () => {
    const req = new Request("http://localhost/api/account/keys/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "new-name" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    // 401 (not 404) confirms the route exists; a missing route would
    // be 404. Catches "I forgot to mount the route" / "wrong prefix" /
    // "import broke at module load."
    expect(res.status).toBe(401);
  });

  it("returns 401 on a malformed body — auth runs BEFORE validation", async () => {
    // Same invariant as the cli-revoke-and-session test: schema 400s
    // must not leak shape info to unauthenticated probers.
    const req = new Request("http://localhost/api/account/keys/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "" }), // schema requires min(1)
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
