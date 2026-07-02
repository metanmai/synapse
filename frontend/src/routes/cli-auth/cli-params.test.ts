import { describe, expect, it } from "vitest";
import {
  type CliParams,
  buildCallbackUrl,
  buildRedirect,
  getCliParams,
  isAllowedExtensionRedirect,
} from "./cli-params";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

/** Build a full CliParams with all-null defaults; override only what a test needs. */
function cp(overrides: Partial<CliParams> = {}): CliParams {
  return {
    challenge: null,
    state: null,
    port: null,
    device: null,
    machine_id: null,
    redirect_uri: null,
    scope: null,
    ...overrides,
  };
}

describe("getCliParams", () => {
  it("extracts the core PKCE + device fields when present", () => {
    expect(
      getCliParams(
        fd({
          cli_challenge: "abc",
          cli_state: "xyz",
          cli_port: "8080",
          cli_device: "tanmais-macbook-pro",
        }),
      ),
    ).toEqual(cp({ challenge: "abc", state: "xyz", port: "8080", device: "tanmais-macbook-pro" }));
  });

  it("returns null for missing fields (backwards-compat with old CLI that doesn't send cli_device)", () => {
    expect(getCliParams(fd({ cli_challenge: "abc", cli_state: "xyz", cli_port: "8080" }))).toEqual(
      cp({ challenge: "abc", state: "xyz", port: "8080" }),
    );
  });

  it("treats empty-string field as null (avoids passing empty device_name to backend)", () => {
    expect(getCliParams(fd({ cli_challenge: "abc", cli_state: "", cli_port: "8080", cli_device: "" }))).toEqual(
      cp({ challenge: "abc", port: "8080" }),
    );
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
    ).toEqual(cp({ challenge: "abc", state: "xyz", port: "8080", machine_id: "550e8400-e29b-41d4-a716-446655440000" }));
  });

  it("extracts redirect_uri + scope when the extension sends them (Slice B)", () => {
    expect(
      getCliParams(
        fd({
          cli_challenge: "abc",
          cli_state: "xyz",
          cli_redirect_uri: "https://ext.chromiumapp.org/",
          cli_scope: "capture",
        }),
      ),
    ).toEqual(cp({ challenge: "abc", state: "xyz", redirect_uri: "https://ext.chromiumapp.org/", scope: "capture" }));
  });
});

describe("buildRedirect", () => {
  it("builds /cli-auth?challenge=…&state=…&port=…&device=… with all params", () => {
    const url = buildRedirect(cp({ challenge: "abc", state: "xyz", port: "8080", device: "host-1" }));
    const parsed = new URL(url, "http://example.com");
    expect(parsed.pathname).toBe("/cli-auth");
    expect(parsed.searchParams.get("challenge")).toBe("abc");
    expect(parsed.searchParams.get("state")).toBe("xyz");
    expect(parsed.searchParams.get("port")).toBe("8080");
    expect(parsed.searchParams.get("device")).toBe("host-1");
  });

  it("omits the device param when device is null (backwards-compat)", () => {
    const url = buildRedirect(cp({ challenge: "abc", state: "xyz", port: "8080" }));
    expect(url).not.toContain("device=");
  });

  it("returns bare /cli-auth when no params are set", () => {
    expect(buildRedirect(cp())).toBe("/cli-auth");
  });

  it("url-encodes device names with spaces and special chars", () => {
    const url = buildRedirect(cp({ device: "Tanmai's MacBook Pro" }));
    const parsed = new URL(url, "http://example.com");
    expect(parsed.searchParams.get("device")).toBe("Tanmai's MacBook Pro");
    expect(url).toContain("device=");
    expect(url).not.toContain("device=Tanmai's MacBook Pro");
  });

  it("preserves machine_id across the redirect (Phase 03-05)", () => {
    const url = buildRedirect(
      cp({ challenge: "abc", state: "xyz", port: "8080", machine_id: "550e8400-e29b-41d4-a716-446655440000" }),
    );
    const parsed = new URL(url, "http://example.com");
    expect(parsed.searchParams.get("machine_id")).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("omits machine_id param when null (backwards-compat with legacy CLI)", () => {
    const url = buildRedirect(cp({ challenge: "abc", state: "xyz", port: "8080" }));
    expect(url).not.toContain("machine_id=");
  });

  it("preserves redirect_uri + scope across the redirect (Slice B — extension round-trip)", () => {
    const url = buildRedirect(
      cp({ challenge: "abc", state: "xyz", redirect_uri: "https://ext.chromiumapp.org/", scope: "capture" }),
    );
    const parsed = new URL(url, "http://example.com");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://ext.chromiumapp.org/");
    expect(parsed.searchParams.get("scope")).toBe("capture");
  });

  it("omits redirect_uri + scope params when null (CLI flow unchanged)", () => {
    const url = buildRedirect(cp({ challenge: "abc", state: "xyz", port: "8080" }));
    expect(url).not.toContain("redirect_uri=");
    expect(url).not.toContain("scope=");
  });
});

// Slice B — the open-redirect guard. The whole point of the scoped token is
// blast-radius containment; an unvetted redirect target would hand a freshly
// minted (capture) credential to an attacker. These cases pin the allowlist.
describe("isAllowedExtensionRedirect", () => {
  it("accepts a canonical chromiumapp.org extension callback", () => {
    expect(isAllowedExtensionRedirect("https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/")).toBe(true);
  });

  it("accepts one carrying a path/query (the host is what's validated)", () => {
    expect(isAllowedExtensionRedirect("https://ext.chromiumapp.org/cb?x=1")).toBe(true);
  });

  const rejected: Array<[string, string]> = [
    ["http, not https", "http://ext.chromiumapp.org/"],
    ["bare apex with no subdomain label", "https://chromiumapp.org/"],
    ["suffix attack (chromiumapp.org.evil.com)", "https://ext.chromiumapp.org.evil.com/"],
    ["an unrelated host", "https://evil.com/"],
    ["@-trick: userinfo masks an evil host", "https://ext.chromiumapp.org@evil.com/"],
    ["userinfo present even with a valid host", "https://user:pass@ext.chromiumapp.org/"],
    ["a non-default port", "https://ext.chromiumapp.org:8443/"],
    ["a non-https scheme", "javascript:alert(1)"],
    ["a bare host that isn't a URL", "ext.chromiumapp.org"],
    ["empty string", ""],
  ];
  it.each(rejected)("rejects %s", (_label, uri) => {
    expect(isAllowedExtensionRedirect(uri)).toBe(false);
  });
});

describe("buildCallbackUrl", () => {
  it("builds the localhost loopback callback for the CLI flow (port)", () => {
    expect(buildCallbackUrl(cp({ state: "st", port: "8080" }), "the-code")).toBe(
      "http://localhost:8080/callback?code=the-code&state=st",
    );
  });

  it("builds the extension callback from a valid redirect_uri", () => {
    expect(buildCallbackUrl(cp({ state: "st", redirect_uri: "https://ext.chromiumapp.org/" }), "the-code")).toBe(
      "https://ext.chromiumapp.org/?code=the-code&state=st",
    );
  });

  it("uses & as the separator when the redirect_uri already has a query", () => {
    expect(buildCallbackUrl(cp({ state: "st", redirect_uri: "https://ext.chromiumapp.org/?a=1" }), "c")).toBe(
      "https://ext.chromiumapp.org/?a=1&code=c&state=st",
    );
  });

  it("url-encodes the code and state", () => {
    const out = buildCallbackUrl(cp({ state: "a b/c", port: "8080" }), "x y&z");
    expect(out).toContain("code=x%20y%26z");
    expect(out).toContain("state=a%20b%2Fc");
  });

  it("REFUSES (null) an invalid redirect_uri and does NOT fall back to the port", () => {
    // Security property: a bad redirect_uri is a hard reject — it must never
    // silently downgrade to the localhost path (that would mask an attack).
    expect(buildCallbackUrl(cp({ state: "st", port: "8080", redirect_uri: "https://evil.com/" }), "c")).toBeNull();
  });

  it("returns null for a non-numeric port (no injection into the URL)", () => {
    expect(buildCallbackUrl(cp({ state: "st", port: "evil) rm -rf" }), "c")).toBeNull();
  });

  it("returns null when neither redirect_uri nor port is present", () => {
    expect(buildCallbackUrl(cp({ state: "st" }), "c")).toBeNull();
  });
});
