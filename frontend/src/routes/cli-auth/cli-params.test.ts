import { describe, expect, it } from "vitest";
import { buildRedirect, getCliParams } from "./cli-params";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe("getCliParams", () => {
  it("extracts all four fields when present", () => {
    expect(
      getCliParams(
        fd({
          cli_challenge: "abc",
          cli_state: "xyz",
          cli_port: "8080",
          cli_device: "tanmais-macbook-pro",
        }),
      ),
    ).toEqual({
      challenge: "abc",
      state: "xyz",
      port: "8080",
      device: "tanmais-macbook-pro",
      machine_id: null,
    });
  });

  it("returns null for missing fields (backwards-compat with old CLI that doesn't send cli_device)", () => {
    expect(getCliParams(fd({ cli_challenge: "abc", cli_state: "xyz", cli_port: "8080" }))).toEqual({
      challenge: "abc",
      state: "xyz",
      port: "8080",
      device: null,
      machine_id: null,
    });
  });

  it("treats empty-string field as null (avoids passing empty device_name to backend)", () => {
    expect(getCliParams(fd({ cli_challenge: "abc", cli_state: "", cli_port: "8080", cli_device: "" }))).toEqual({
      challenge: "abc",
      state: null,
      port: "8080",
      device: null,
      machine_id: null,
    });
  });

  it("extracts machine_id when the new CLI sends it (Phase 03-05)", () => {
    expect(
      getCliParams(
        fd({
          cli_challenge: "abc",
          cli_state: "xyz",
          cli_port: "8080",
          cli_machine_id: "550e8400-e29b-41d4-a716-446655440000",
        }),
      ),
    ).toEqual({
      challenge: "abc",
      state: "xyz",
      port: "8080",
      device: null,
      machine_id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });
});

describe("buildRedirect", () => {
  it("builds /cli-auth?challenge=…&state=…&port=…&device=… with all params", () => {
    const url = buildRedirect({
      challenge: "abc",
      state: "xyz",
      port: "8080",
      device: "host-1",
      machine_id: null,
    });
    const parsed = new URL(url, "http://example.com");
    expect(parsed.pathname).toBe("/cli-auth");
    expect(parsed.searchParams.get("challenge")).toBe("abc");
    expect(parsed.searchParams.get("state")).toBe("xyz");
    expect(parsed.searchParams.get("port")).toBe("8080");
    expect(parsed.searchParams.get("device")).toBe("host-1");
  });

  it("omits the device param when device is null (backwards-compat)", () => {
    const url = buildRedirect({ challenge: "abc", state: "xyz", port: "8080", device: null, machine_id: null });
    expect(url).not.toContain("device=");
  });

  it("returns bare /cli-auth when no params are set", () => {
    expect(buildRedirect({ challenge: null, state: null, port: null, device: null, machine_id: null })).toBe(
      "/cli-auth",
    );
  });

  it("url-encodes device names with spaces and special chars", () => {
    const url = buildRedirect({
      challenge: null,
      state: null,
      port: null,
      device: "Tanmai's MacBook Pro",
      machine_id: null,
    });
    const parsed = new URL(url, "http://example.com");
    expect(parsed.searchParams.get("device")).toBe("Tanmai's MacBook Pro");
    expect(url).toContain("device=");
    expect(url).not.toContain("device=Tanmai's MacBook Pro");
  });

  it("preserves machine_id across the redirect (Phase 03-05)", () => {
    const url = buildRedirect({
      challenge: "abc",
      state: "xyz",
      port: "8080",
      device: null,
      machine_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    const parsed = new URL(url, "http://example.com");
    expect(parsed.searchParams.get("machine_id")).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("omits machine_id param when null (backwards-compat with legacy CLI)", () => {
    const url = buildRedirect({ challenge: "abc", state: "xyz", port: "8080", device: null, machine_id: null });
    expect(url).not.toContain("machine_id=");
  });
});
