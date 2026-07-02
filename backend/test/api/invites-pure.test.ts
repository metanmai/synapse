// backend/test/api/invites-pure.test.ts
//
// BUGS.md 5a path-(b) round 2: pure-helper coverage for the invites flow.
// Security-relevant bug classes: weak token entropy, charset relaxation,
// expiry off-by-one (re-redeemable tokens), accept-state misread.

import { describe, expect, it } from "vitest";
import {
  INVITE_TTL_MS,
  JOIN_URL_BASE,
  buildJoinUrl,
  computeInviteExpiresAt,
  generateInviteToken,
  isInviteAccepted,
  isInviteExpired,
  parseInviteRequestBody,
} from "../../src/api/invites-pure";

describe("generateInviteToken — security-critical charset + entropy", () => {
  it("returns a 32-character string (24 bytes → base64url, padding stripped)", () => {
    // Bug class: a refactor truncates the byte buffer or changes the
    // encoding, shrinking the token below the 128-bit-entropy floor.
    // 24 random bytes = 192 bits; base64-encoded length is ceil(24/3*4)=32
    // pre-padding, and base64url strips trailing `=` so length stays 32.
    const t = generateInviteToken();
    expect(t).toHaveLength(32);
  });

  it("contains ONLY url-safe characters: [A-Za-z0-9_-]", () => {
    // Bug class: the `.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")`
    // chain gets shortened to one replace, leaving raw base64 chars `+` `/`
    // `=` in the token. Those characters need percent-encoding in URLs;
    // an unencoded `/` would split the path and break the route match.
    // 100 samples covers the random-bit space with high probability.
    const charset = /^[A-Za-z0-9_-]+$/;
    for (let i = 0; i < 100; i++) {
      const t = generateInviteToken();
      expect(t, `token ${t} contains non-url-safe characters`).toMatch(charset);
    }
  });

  it("produces high-entropy distinct tokens across many invocations", () => {
    // Bug class: someone replaces `crypto.getRandomValues` with
    // `Math.random()` (not a CSPRNG, and on some runtimes seeded
    // predictably). The distinct-count check fails fast if the source
    // is non-random — 1000 calls collapsing to <990 distinct values
    // signals a serious entropy regression.
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateInviteToken());
    expect(seen.size).toBeGreaterThan(990); // allow ≤10 collisions on entropy edge
  });

  it("never produces an empty string", () => {
    // Pin: the function returns a usable token every time. A no-op (empty
    // string) would silently bypass the invite-required gate by hitting
    // /invite/<empty> which the router might route to the wrong handler.
    for (let i = 0; i < 50; i++) expect(generateInviteToken().length).toBeGreaterThan(0);
  });
});

describe("parseInviteRequestBody — defensive parser", () => {
  it("rejects malformed JSON with 400 'invalid JSON body'", () => {
    // Bug class: Hono's c.req.json() throws on malformed input; if not
    // caught the handler returns 500 (opaque). The parser must return
    // a structured 400 instead.
    expect(parseInviteRequestBody("{ this is not json")).toEqual({
      ok: false,
      status: 400,
      reason: "invalid JSON body",
    });
    expect(parseInviteRequestBody("undefined")).toEqual({
      ok: false,
      status: 400,
      reason: "invalid JSON body",
    });
    expect(parseInviteRequestBody("")).toEqual({
      ok: false,
      status: 400,
      reason: "invalid JSON body",
    });
  });

  it("rejects non-object bodies (arrays, primitives) with 'email required'", () => {
    // Bug class: array body `["foo@bar.com"]` shouldn't accidentally
    // become "email = first element." Only `{ email: ... }` shape is valid.
    expect(parseInviteRequestBody("[]").ok).toBe(false);
    expect(parseInviteRequestBody("42").ok).toBe(false);
    expect(parseInviteRequestBody('"some string"').ok).toBe(false);
    expect(parseInviteRequestBody("null").ok).toBe(false);
  });

  it("rejects missing or non-string email", () => {
    expect(parseInviteRequestBody("{}").ok).toBe(false);
    expect(parseInviteRequestBody('{"email": null}').ok).toBe(false);
    expect(parseInviteRequestBody('{"email": 42}').ok).toBe(false);
  });

  it("rejects whitespace-only email (after trim)", () => {
    // Bug class: invite for "   @   " creates a stub invite that can be
    // redeemed but corresponds to no real person — a fuzzing attacker
    // could mint these in bulk.
    expect(parseInviteRequestBody('{"email": "   "}')).toEqual({
      ok: false,
      status: 400,
      reason: "email required",
    });
    expect(parseInviteRequestBody('{"email": "\\t\\n"}')).toEqual({
      ok: false,
      status: 400,
      reason: "email required",
    });
    expect(parseInviteRequestBody('{"email": ""}')).toEqual({
      ok: false,
      status: 400,
      reason: "email required",
    });
  });

  it("accepts a valid email and returns it trimmed", () => {
    expect(parseInviteRequestBody('{"email": "alice@example.com"}')).toEqual({
      ok: true,
      email: "alice@example.com",
    });
    // Trim happens — leading/trailing whitespace removed, internal preserved
    expect(parseInviteRequestBody('{"email": "  alice@example.com  "}')).toEqual({
      ok: true,
      email: "alice@example.com",
    });
  });

  it("ignores extra fields silently (forward compat)", () => {
    // Pin: adding new optional fields to the request body doesn't break
    // the parser. The handler should be permissive on extra fields.
    expect(parseInviteRequestBody('{"email": "a@b.com", "role": "admin", "note": "x"}')).toEqual({
      ok: true,
      email: "a@b.com",
    });
  });
});

describe("isInviteExpired — boundary semantics", () => {
  it("returns false when expires_at is in the FUTURE", () => {
    const now = new Date("2026-05-31T12:00:00Z").getTime();
    const invite = { accepted_at: null, expires_at: "2026-05-31T13:00:00Z" };
    expect(isInviteExpired(invite, now)).toBe(false);
  });

  it("returns true when expires_at is in the PAST", () => {
    const now = new Date("2026-05-31T12:00:00Z").getTime();
    const invite = { accepted_at: null, expires_at: "2026-05-31T11:00:00Z" };
    expect(isInviteExpired(invite, now)).toBe(true);
  });

  it("returns false at the EXACT expires_at moment (one-tick grace)", () => {
    // Bug class: someone flips `<` to `<=`, invalidating an in-flight
    // redemption that races the boundary. Pin the existing behavior so
    // a future tightening is deliberate.
    const exact = "2026-05-31T12:00:00Z";
    const now = new Date(exact).getTime();
    expect(isInviteExpired({ accepted_at: null, expires_at: exact }, now)).toBe(false);
  });

  it("returns true 1ms past expires_at", () => {
    const exact = "2026-05-31T12:00:00Z";
    const now = new Date(exact).getTime() + 1;
    expect(isInviteExpired({ accepted_at: null, expires_at: exact }, now)).toBe(true);
  });
});

describe("isInviteAccepted — state semantics", () => {
  it("returns false when accepted_at is null", () => {
    expect(isInviteAccepted({ accepted_at: null, expires_at: "2026-12-31T00:00:00Z" })).toBe(false);
  });

  it("returns true when accepted_at is a non-null string", () => {
    expect(
      isInviteAccepted({
        accepted_at: "2026-05-30T10:00:00Z",
        expires_at: "2026-12-31T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("returns false when accepted_at is undefined (defensive)", () => {
    // The InviteState type says `string | null` but the DB driver could
    // return `undefined` if the column is missing from the select. Don't
    // crash; treat as not-accepted.
    expect(
      isInviteAccepted({
        accepted_at: undefined as unknown as null,
        expires_at: "2026-12-31T00:00:00Z",
      }),
    ).toBe(false);
  });
});

describe("computeInviteExpiresAt — TTL math", () => {
  it("default TTL is 7 days (pin)", () => {
    // Bug class: someone changes `7 * 24 * 60 * 60 * 1000` to
    // `7 * 24 * 60 * 1000` (drops the `* 60` for seconds), making invites
    // expire in 7 minutes. The pinned constant catches the typo.
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns ISO string at now + TTL", () => {
    const now = new Date("2026-05-31T12:00:00Z").getTime();
    const out = computeInviteExpiresAt(now);
    expect(out).toBe(new Date(now + INVITE_TTL_MS).toISOString());
  });

  it("respects custom TTL override", () => {
    const now = new Date("2026-05-31T12:00:00Z").getTime();
    const oneDay = 24 * 60 * 60 * 1000;
    const out = computeInviteExpiresAt(now, oneDay);
    expect(new Date(out).getTime() - now).toBe(oneDay);
  });
});

describe("buildJoinUrl — URL composition", () => {
  it("composes JOIN_URL_BASE + / + token", () => {
    expect(buildJoinUrl("abc123")).toBe(`${JOIN_URL_BASE}/abc123`);
  });

  it("JOIN_URL_BASE pinned to production domain (no localhost / staging slip)", () => {
    // Bug class: someone leaves a dev base URL in the codebase. Pin so the
    // change is deliberate.
    expect(JOIN_URL_BASE).toBe("https://synapsesync.app/invite");
  });
});
