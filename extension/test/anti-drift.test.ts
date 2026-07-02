import { CAPTURE_HOSTS } from "@synapse/shared/capture-hosts.js";
import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";
import { API_URL, APP_URL } from "../src/config.js";
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

  it("host_permissions stay within CAPTURE_HOSTS + the Synapse endpoints (least privilege)", () => {
    // The extension may hold host permission for the capture sites (content scripts)
    // AND, for the self-sufficient path (Slice C), the Synapse backend (capture ingest
    // + cli-exchange) and frontend (the /cli-auth sign-in page) — derived from config.ts
    // so this can't drift from the real endpoints. Nothing else: guards against the
    // extension quietly requesting access to an arbitrary site.
    const allowed = new Set<string>([...CAPTURE_HOSTS, new URL(API_URL).host, new URL(APP_URL).host]);
    for (const p of manifest.host_permissions) expect([...allowed]).toContain(hostFromMatch(p));
  });
});
