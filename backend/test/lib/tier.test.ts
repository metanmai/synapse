import { describe, expect, it } from "vitest";
import { getTierLimitsFromEnv } from "../../src/db/types";

describe("getTierLimitsFromEnv", () => {
  it("returns default free tier limits", () => {
    const limits = getTierLimitsFromEnv();
    expect(limits.free.maxFiles).toBe(50);
    expect(limits.free.maxConnections).toBe(3);
    expect(limits.free.maxHistoryVersions).toBe(3);
    expect(limits.free.maxMembers).toBe(2);
  });

  it("returns default pro tier limits", () => {
    const limits = getTierLimitsFromEnv();
    expect(limits.pro.maxFiles).toBe(500);
    expect(limits.pro.maxConnections).toBe(0);
    expect(limits.pro.maxHistoryVersions).toBe(-1);
    expect(limits.pro.maxMembers).toBe(0);
  });

  it("respects env var overrides", () => {
    const limits = getTierLimitsFromEnv({
      TIER_FREE_MAX_FILES: "100",
      TIER_PRO_MAX_FILES: "1000",
    });
    expect(limits.free.maxFiles).toBe(100);
    expect(limits.pro.maxFiles).toBe(1000);
    // Non-overridden values keep defaults
    expect(limits.free.maxConnections).toBe(3);
  });

  it("uses defaults when env vars are undefined", () => {
    const limits = getTierLimitsFromEnv({});
    expect(limits.free.maxFiles).toBe(50);
  });

  it("handles NaN env vars gracefully", () => {
    const limits = getTierLimitsFromEnv({
      TIER_FREE_MAX_FILES: "not-a-number",
    });
    expect(limits.free.maxFiles).toBeNaN();
  });
});
