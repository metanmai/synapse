import { CAPTURE_HOSTS } from "@synapse/shared/capture-hosts.js";
import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";
import { ADAPTERS } from "../src/content/registry.js";

// "https://claude.ai/*" → "claude.ai"
function hostFromMatch(pattern: string): string {
  return pattern.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
}

describe("CAPTURE_HOSTS anti-drift", () => {
  const manifestHosts = [...new Set(manifest.content_scripts.flatMap((cs) => cs.matches.map(hostFromMatch)))];
  const adapterHosts = ADAPTERS.map((a) => a.host);

  it("every adapter host is a CAPTURE_HOST", () => {
    for (const h of adapterHosts) expect(CAPTURE_HOSTS).toContain(h);
  });

  it("every CAPTURE_HOST has an adapter", () => {
    for (const h of CAPTURE_HOSTS) expect(adapterHosts).toContain(h);
  });

  it("every manifest match host is a CAPTURE_HOST", () => {
    for (const h of manifestHosts) expect(CAPTURE_HOSTS).toContain(h);
  });

  it("the manifest covers every CAPTURE_HOST", () => {
    for (const h of CAPTURE_HOSTS) expect(manifestHosts).toContain(h);
  });

  it("host_permissions also stay within CAPTURE_HOSTS", () => {
    for (const p of manifest.host_permissions) expect(CAPTURE_HOSTS).toContain(hostFromMatch(p));
  });
});
