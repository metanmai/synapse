import { describe, expect, it } from "vitest";
import { enforceMemberLimitForTier, enforceProjectQuotaForTier } from "../../src/lib/tier";

/**
 * Bug class under test: "tier-quota enforcement only works when called
 * from a Hono Context, leaking through any code path that doesn't have
 * one — primarily the MCP tool handlers and the daemon-side flush
 * remap". Per docs/HANDOFF-2026-05-28.md Priority 2 bugs 2 and 3.
 *
 * Tests the new pure tier-string variants (`enforceProjectQuotaForTier`,
 * `enforceMemberLimitForTier`) directly — no Hono Context, no env, no
 * subscription DB. These are the functions the MCP create_project,
 * MCP invite_member, conversations capture, events-batch cwd_<hash>
 * remap, and invites mint/accept paths all call.
 */

describe("enforceProjectQuotaForTier", () => {
  it("allows a free user under the 5-project cap", () => {
    expect(() => enforceProjectQuotaForTier(0, "free")).not.toThrow();
    expect(() => enforceProjectQuotaForTier(4, "free")).not.toThrow();
  });

  it("rejects a free user AT the 5-project cap (>= semantics)", () => {
    // The bug class "off-by-one in the comparison" would let a free user
    // sneak in their 6th project. Pin >= on the boundary.
    expect(() => enforceProjectQuotaForTier(5, "free")).toThrow(/Project limit reached/);
    expect(() => enforceProjectQuotaForTier(6, "free")).toThrow(/Project limit reached/);
  });

  it("allows a plus user under the 50-project cap", () => {
    expect(() => enforceProjectQuotaForTier(0, "plus")).not.toThrow();
    expect(() => enforceProjectQuotaForTier(49, "plus")).not.toThrow();
  });

  it("rejects a plus user AT the 50-project cap", () => {
    expect(() => enforceProjectQuotaForTier(50, "plus")).toThrow(/Project limit reached/);
  });

  it("the thrown error is a TIER_LIMIT 403 (frontend depends on this code)", () => {
    try {
      enforceProjectQuotaForTier(5, "free");
      expect.unreachable("expected throw");
    } catch (err) {
      const e = err as { code?: string; status?: number };
      expect(e.code).toBe("TIER_LIMIT");
      expect(e.status).toBe(403);
    }
  });
});

describe("enforceMemberLimitForTier", () => {
  it("allows a free-tier project under the 2-member cap", () => {
    expect(() => enforceMemberLimitForTier(0, "free")).not.toThrow();
    expect(() => enforceMemberLimitForTier(1, "free")).not.toThrow();
  });

  it("rejects a free-tier project AT the 2-member cap (>= semantics)", () => {
    expect(() => enforceMemberLimitForTier(2, "free")).toThrow(/Member limit reached/);
    expect(() => enforceMemberLimitForTier(3, "free")).toThrow(/Member limit reached/);
  });

  it("treats plus tier as unlimited (maxMembers=0)", () => {
    // Bug class "0 sentinel is misread as 'zero allowed' instead of
    // 'unlimited'". This is exactly the trap getTierLimitsFromEnv sets
    // up — maxMembers === 0 means unlimited per its semantics.
    expect(() => enforceMemberLimitForTier(0, "plus")).not.toThrow();
    expect(() => enforceMemberLimitForTier(100, "plus")).not.toThrow();
    expect(() => enforceMemberLimitForTier(10_000, "plus")).not.toThrow();
  });

  it("respects env overrides of TIER_FREE_MAX_MEMBERS", () => {
    // Per-deploy override (used in tests / specialty deploys). The MCP
    // path lives on a Workers context that may or may not propagate
    // these, so pinning the override-honoring behavior here.
    expect(() => enforceMemberLimitForTier(4, "free", { TIER_FREE_MAX_MEMBERS: "5" })).not.toThrow();
    expect(() => enforceMemberLimitForTier(5, "free", { TIER_FREE_MAX_MEMBERS: "5" })).toThrow();
  });

  it("the thrown error is a TIER_LIMIT 403", () => {
    try {
      enforceMemberLimitForTier(2, "free");
      expect.unreachable("expected throw");
    } catch (err) {
      const e = err as { code?: string; status?: number };
      expect(e.code).toBe("TIER_LIMIT");
      expect(e.status).toBe(403);
    }
  });
});
