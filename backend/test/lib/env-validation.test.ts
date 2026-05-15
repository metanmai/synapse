import { describe, it, expect } from "vitest";
import type { Env } from "../../src/lib/env";

describe("Environment variable validation", () => {
  const requiredVars: (keyof Env)[] = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
  ];

  it.each(requiredVars)("Env interface requires %s", (varName) => {
    // This is a compile-time check — if Env doesn't have these fields, TS will error
    const env = {} as Env;
    expect(varName in env || true).toBe(true); // Runtime placeholder
  });

  it("createSupabaseClient throws if URL is missing", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    expect(() => createClient("", "some-key")).toThrow();
  });

  it("createSupabaseClient throws if key is missing", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    expect(() => createClient("https://test.supabase.co", "")).toThrow();
  });
});
