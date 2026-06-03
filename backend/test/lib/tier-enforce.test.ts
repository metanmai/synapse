import { describe, expect, it } from "vitest";
import {
  enforceMemberLimitForTier,
  enforceProjectQuotaForTier,
  getConversationCapForTier,
  getDeviceCapForTier,
  getInsightCapForTier,
  isAutoSyncEnabledForTier,
} from "../../src/lib/tier";

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
  // Phase 03-02: BOTH tiers cap at 50. Free expanded from 5→50; the
  // differentiator moves to per-project capacity (insights, conversations)
  // + auto-sync + link sharing, not project count.
  it("allows a user under the 50-project cap (both tiers)", () => {
    expect(() => enforceProjectQuotaForTier(0, "free")).not.toThrow();
    expect(() => enforceProjectQuotaForTier(49, "free")).not.toThrow();
    expect(() => enforceProjectQuotaForTier(0, "plus")).not.toThrow();
    expect(() => enforceProjectQuotaForTier(49, "plus")).not.toThrow();
  });

  it("rejects a user AT the 50-project cap (>= semantics, both tiers)", () => {
    // Bug class: off-by-one in the comparison would let a user sneak in
    // their 51st project. Pin >= on the boundary, both tiers.
    expect(() => enforceProjectQuotaForTier(50, "free")).toThrow(/Project limit reached/);
    expect(() => enforceProjectQuotaForTier(51, "free")).toThrow(/Project limit reached/);
    expect(() => enforceProjectQuotaForTier(50, "plus")).toThrow(/Project limit reached/);
    expect(() => enforceProjectQuotaForTier(51, "plus")).toThrow(/Project limit reached/);
  });

  it("the thrown error is PROJECT_QUOTA_EXCEEDED 402 (CLI + frontend depend on this code)", () => {
    // Phase 03-02: structured error replaces TIER_LIMIT/403. Status 402
    // distinguishes capacity-cap from auth/permission (403). The CLI surface
    // (mcp/src/capture/handoff-sync.ts) and frontend new-project UI both
    // match on this exact code string — changing it is a breaking change.
    try {
      enforceProjectQuotaForTier(50, "free");
      expect.unreachable("expected throw");
    } catch (err) {
      const e = err as { code?: string; status?: number };
      expect(e.code).toBe("PROJECT_QUOTA_EXCEEDED");
      expect(e.status).toBe(402);
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

/**
 * Bug class under test: "per-tier capacity helpers leak through the wrong
 * tier — Free user gets Plus caps or vice versa". These accessors are the
 * inputs to slice 03-03 (conversation LRU), 03-04 (insight cap), and 03-05
 * (device cap). Pinning the contract here prevents silent drift if the
 * underlying constants are reorganized.
 *
 * The assertions are deliberately contract-shaped ("plus > free", "free
 * is nonzero", "auto-sync gated on plus") rather than magic-number locked
 * for the two caps that still change in later slices. The two locked
 * caps (insights, conversations) ship with this slice and can be pinned
 * to their specific values.
 */
describe("per-tier capacity accessors (Phase 03-01)", () => {
  it("getInsightCapForTier: free=10, plus=50", () => {
    expect(getInsightCapForTier("free")).toBe(10);
    expect(getInsightCapForTier("plus")).toBe(50);
  });

  it("getConversationCapForTier: free=10, plus=50", () => {
    expect(getConversationCapForTier("free")).toBe(10);
    expect(getConversationCapForTier("plus")).toBe(50);
  });

  it("getDeviceCapForTier: free=3, plus>free (specific Plus value changes in slice 03-05)", () => {
    expect(getDeviceCapForTier("free")).toBe(3);
    expect(getDeviceCapForTier("plus")).toBeGreaterThan(getDeviceCapForTier("free"));
  });

  it("isAutoSyncEnabledForTier: free=false, plus=true", () => {
    expect(isAutoSyncEnabledForTier("free")).toBe(false);
    expect(isAutoSyncEnabledForTier("plus")).toBe(true);
  });
});
