import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/lib/env";
import { AppError } from "../../src/lib/errors";
import {
  enforceConnectionLimit,
  enforceFileLimit,
  enforceMemberLimit,
  getHistoryLimit,
  getTierLimits,
  requireConversationSync,
  requirePlus,
} from "../../src/lib/tier";

// ---------------------------------------------------------------------------
// Helper: create a minimal mock Hono Context with tier and env bindings
// ---------------------------------------------------------------------------
function createMockContext(tier: "free" | "plus", envOverrides?: Record<string, string>) {
  const vars: Record<string, unknown> = { tier };
  return {
    get: (key: string) => vars[key],
    set: (key: string, value: unknown) => {
      vars[key] = value;
    },
    env: {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_KEY: "test-key",
      ...envOverrides,
    },
  } as unknown as Context<{ Bindings: Env }>;
}

// ---------------------------------------------------------------------------
// requirePlus
// ---------------------------------------------------------------------------
describe("requirePlus", () => {
  it("throws AppError(403, TIER_LIMIT) for free tier", () => {
    const c = createMockContext("free");
    expect(() => requirePlus(c, "Conversation sync")).toThrowError(AppError);

    try {
      requirePlus(c, "Conversation sync");
    } catch (err) {
      const e = err as AppError;
      expect(e.status).toBe(403);
      expect(e.code).toBe("TIER_LIMIT");
      expect(e.message).toContain("Conversation sync");
      expect(e.message).toContain("5.99");
    }
  });

  it("does not throw for plus tier", () => {
    const c = createMockContext("plus");
    expect(() => requirePlus(c, "Conversation sync")).not.toThrow();
  });

  it("includes feature name and price in error message", () => {
    const c = createMockContext("free");
    try {
      requirePlus(c, "Advanced analytics");
    } catch (err) {
      const e = err as AppError;
      expect(e.message).toContain("Advanced analytics");
      expect(e.message).toContain("$5.99/mo");
    }
  });

  it("respects custom TIER_PLUS_PRICE env var", () => {
    const c = createMockContext("free", { TIER_PLUS_PRICE: "9.99" });
    try {
      requirePlus(c, "Feature X");
    } catch (err) {
      const e = err as AppError;
      expect(e.message).toContain("$9.99/mo");
    }
  });
});

// ---------------------------------------------------------------------------
// enforceMemberLimit
// ---------------------------------------------------------------------------
describe("enforceMemberLimit", () => {
  it("passes when free tier count is under limit", () => {
    const c = createMockContext("free");
    expect(() => enforceMemberLimit(0, c)).not.toThrow();
    expect(() => enforceMemberLimit(1, c)).not.toThrow();
  });

  it("throws when free tier count reaches limit (default 2)", () => {
    const c = createMockContext("free");
    expect(() => enforceMemberLimit(2, c)).toThrowError(AppError);

    try {
      enforceMemberLimit(2, c);
    } catch (err) {
      const e = err as AppError;
      expect(e.status).toBe(403);
      expect(e.code).toBe("TIER_LIMIT");
      expect(e.message).toContain("Member limit reached");
      expect(e.message).toContain("2 members");
    }
  });

  it("throws when free tier count exceeds limit", () => {
    const c = createMockContext("free");
    expect(() => enforceMemberLimit(5, c)).toThrowError(AppError);
  });

  it("always passes for plus tier (limit=0 means unlimited)", () => {
    const c = createMockContext("plus");
    expect(() => enforceMemberLimit(0, c)).not.toThrow();
    expect(() => enforceMemberLimit(100, c)).not.toThrow();
    expect(() => enforceMemberLimit(999, c)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// enforceFileLimit
// ---------------------------------------------------------------------------
describe("enforceFileLimit", () => {
  it("passes when free tier count is under limit (default 50)", () => {
    const c = createMockContext("free");
    expect(() => enforceFileLimit(0, c)).not.toThrow();
    expect(() => enforceFileLimit(49, c)).not.toThrow();
  });

  it("throws when free tier count reaches limit (50)", () => {
    const c = createMockContext("free");
    expect(() => enforceFileLimit(50, c)).toThrowError(AppError);

    try {
      enforceFileLimit(50, c);
    } catch (err) {
      const e = err as AppError;
      expect(e.status).toBe(403);
      expect(e.code).toBe("TIER_LIMIT");
      expect(e.message).toContain("File limit reached");
      expect(e.message).toContain("50 files");
    }
  });

  it("throws when free tier count exceeds limit", () => {
    const c = createMockContext("free");
    expect(() => enforceFileLimit(100, c)).toThrowError(AppError);
  });

  it("passes when plus tier count is under limit (default 500)", () => {
    const c = createMockContext("plus");
    expect(() => enforceFileLimit(0, c)).not.toThrow();
    expect(() => enforceFileLimit(499, c)).not.toThrow();
  });

  it("throws when plus tier count reaches limit (500)", () => {
    const c = createMockContext("plus");
    expect(() => enforceFileLimit(500, c)).toThrowError(AppError);

    try {
      enforceFileLimit(500, c);
    } catch (err) {
      const e = err as AppError;
      expect(e.status).toBe(403);
      expect(e.code).toBe("TIER_LIMIT");
      expect(e.message).toContain("500 files");
    }
  });
});

// ---------------------------------------------------------------------------
// enforceConnectionLimit
// ---------------------------------------------------------------------------
describe("enforceConnectionLimit", () => {
  it("passes when free tier connections are under limit (default 3)", () => {
    const c = createMockContext("free");
    expect(() => enforceConnectionLimit(0, "google_docs", c)).not.toThrow();
    expect(() => enforceConnectionLimit(2, "google_docs", c)).not.toThrow();
  });

  it("throws when free tier connections reach limit (3)", () => {
    const c = createMockContext("free");
    expect(() => enforceConnectionLimit(3, "google_docs", c)).toThrowError(AppError);

    try {
      enforceConnectionLimit(3, "google_docs", c);
    } catch (err) {
      const e = err as AppError;
      expect(e.status).toBe(403);
      expect(e.code).toBe("TIER_LIMIT");
      expect(e.message).toContain("Connection limit reached");
      expect(e.message).toContain("3 sources");
    }
  });

  it("throws when free tier connections exceed limit", () => {
    const c = createMockContext("free");
    expect(() => enforceConnectionLimit(10, "google_docs", c)).toThrowError(AppError);
  });

  it("always passes for plus tier (limit=0 means unlimited)", () => {
    const c = createMockContext("plus");
    expect(() => enforceConnectionLimit(0, "google_docs", c)).not.toThrow();
    expect(() => enforceConnectionLimit(50, "google_docs", c)).not.toThrow();
    expect(() => enforceConnectionLimit(999, "google_docs", c)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getHistoryLimit
// ---------------------------------------------------------------------------
describe("getHistoryLimit", () => {
  it("returns 3 for free tier (default)", () => {
    const c = createMockContext("free");
    expect(getHistoryLimit(c)).toBe(3);
  });

  it("returns -1 for plus tier (unlimited)", () => {
    const c = createMockContext("plus");
    expect(getHistoryLimit(c)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// getTierLimits
// ---------------------------------------------------------------------------
describe("getTierLimits", () => {
  it("returns correct free tier limits object", () => {
    const c = createMockContext("free");
    const limits = getTierLimits(c);
    expect(limits).toEqual({
      maxFiles: 50,
      maxConnections: 3,
      maxHistoryVersions: 3,
      maxMembers: 2,
    });
  });

  it("returns correct plus tier limits object", () => {
    const c = createMockContext("plus");
    const limits = getTierLimits(c);
    expect(limits).toEqual({
      maxFiles: 500,
      maxConnections: 0,
      maxHistoryVersions: -1,
      maxMembers: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// requireConversationSync — delegates to requirePlus
// ---------------------------------------------------------------------------
describe("requireConversationSync", () => {
  it("throws for free tier (delegates to requirePlus)", () => {
    const c = createMockContext("free");
    expect(() => requireConversationSync(c)).toThrowError(AppError);

    try {
      requireConversationSync(c);
    } catch (err) {
      const e = err as AppError;
      expect(e.status).toBe(403);
      expect(e.code).toBe("TIER_LIMIT");
      expect(e.message).toContain("Conversation sync");
    }
  });

  it("does not throw for plus tier", () => {
    const c = createMockContext("plus");
    expect(() => requireConversationSync(c)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Env var overrides
// ---------------------------------------------------------------------------
describe("env var overrides", () => {
  it("uses custom TIER_FREE_MAX_FILES when set", () => {
    const c = createMockContext("free", { TIER_FREE_MAX_FILES: "100" });
    // 99 < 100 → passes
    expect(() => enforceFileLimit(99, c)).not.toThrow();
    // 100 >= 100 → throws
    expect(() => enforceFileLimit(100, c)).toThrowError(AppError);
  });

  it("uses custom TIER_FREE_MAX_CONNECTIONS when set", () => {
    const c = createMockContext("free", { TIER_FREE_MAX_CONNECTIONS: "5" });
    expect(() => enforceConnectionLimit(4, "google_docs", c)).not.toThrow();
    expect(() => enforceConnectionLimit(5, "google_docs", c)).toThrowError(AppError);
  });

  it("uses custom TIER_FREE_MAX_MEMBERS when set", () => {
    const c = createMockContext("free", { TIER_FREE_MAX_MEMBERS: "10" });
    expect(() => enforceMemberLimit(9, c)).not.toThrow();
    expect(() => enforceMemberLimit(10, c)).toThrowError(AppError);
  });

  it("uses custom TIER_FREE_MAX_HISTORY for getHistoryLimit", () => {
    const c = createMockContext("free", { TIER_FREE_MAX_HISTORY: "7" });
    expect(getHistoryLimit(c)).toBe(7);
  });

  it("uses custom TIER_PLUS_MAX_FILES when set", () => {
    const c = createMockContext("plus", { TIER_PLUS_MAX_FILES: "1000" });
    expect(() => enforceFileLimit(999, c)).not.toThrow();
    expect(() => enforceFileLimit(1000, c)).toThrowError(AppError);
  });
});
