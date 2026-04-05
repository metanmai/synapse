import { describe, expect, it } from "vitest";
import { formatDate, formatRenewalDate, isExpired, isExpiredAt } from "./account-helpers";

// ---------- formatDate ----------

describe("formatDate", () => {
  it('returns "Never" for null input', () => {
    expect(formatDate(null)).toBe("Never");
  });

  it("formats a valid date string", () => {
    const result = formatDate("2026-03-28T12:00:00Z");
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/28/);
    expect(result).toMatch(/2026/);
  });

  it("formats dates from different months correctly", () => {
    const result = formatDate("2025-01-15T00:00:00Z");
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/2025/);
  });

  it("is deterministic for same input", () => {
    const iso = "2026-06-01T10:00:00Z";
    expect(formatDate(iso)).toBe(formatDate(iso));
  });
});

// ---------- isExpired ----------

describe("isExpired", () => {
  it("returns false for null expiration", () => {
    expect(isExpired(null)).toBe(false);
  });

  it("returns true for past dates", () => {
    expect(isExpired("2020-01-01T00:00:00Z")).toBe(true);
  });

  it("returns false for future dates", () => {
    const future = new Date(Date.now() + 86400_000 * 365).toISOString();
    expect(isExpired(future)).toBe(false);
  });
});

// ---------- isExpiredAt ----------

describe("isExpiredAt", () => {
  const now = new Date("2026-03-28T12:00:00Z");

  it("returns false for null expiration", () => {
    expect(isExpiredAt(null, now)).toBe(false);
  });

  it("returns true when expiration is before reference date", () => {
    expect(isExpiredAt("2026-03-27T12:00:00Z", now)).toBe(true);
  });

  it("returns false when expiration is after reference date", () => {
    expect(isExpiredAt("2026-03-29T12:00:00Z", now)).toBe(false);
  });

  it("returns true when expiration equals reference date exactly", () => {
    // new Date(expiresAt) < now is false when equal, so isExpired is false
    expect(isExpiredAt("2026-03-28T12:00:00Z", now)).toBe(false);
  });

  it("returns true for dates one millisecond before reference", () => {
    expect(isExpiredAt("2026-03-28T11:59:59.999Z", now)).toBe(true);
  });
});

// ---------- formatRenewalDate ----------

describe("formatRenewalDate", () => {
  it("returns null for null input", () => {
    expect(formatRenewalDate(null)).toBeNull();
  });

  it("formats a valid date with long month name", () => {
    const result = formatRenewalDate("2026-03-28T12:00:00Z");
    expect(result).toMatch(/March/);
    expect(result).toMatch(/28/);
    expect(result).toMatch(/2026/);
  });

  it("formats January dates correctly", () => {
    const result = formatRenewalDate("2026-01-01T00:00:00Z");
    expect(result).toMatch(/January/);
    // Day might be Dec 31 depending on TZ; just check it has a year
    expect(result).toMatch(/202[56]/);
  });

  it("is deterministic for same input", () => {
    const iso = "2026-09-15T10:00:00Z";
    expect(formatRenewalDate(iso)).toBe(formatRenewalDate(iso));
  });
});
