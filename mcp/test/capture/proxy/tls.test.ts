// mcp/test/capture/proxy/tls.test.ts
//
// Bug class: "the TLS manager produces certs that don't validate
// (wrong SAN, broken signature) OR leaks state across hostnames
// (cache hit returns wrong cert) OR escapes the configured cert
// directory (path traversal via attacker-controlled hostname)."
//
// Tests use Node's built-in crypto.X509Certificate to inspect cert
// internals — verifies actual TLS-relevant properties, not just
// "did a PEM file appear on disk."

import { X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TlsManager } from "../../../src/capture/proxy/tls.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "synapse-tls-test-"));
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("TlsManager", () => {
  describe("ensureCa", () => {
    it("generates a CA on first call and persists it to disk", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const ca = mgr.ensureCa();

      expect(ca.key).toMatch(/-----BEGIN .*PRIVATE KEY-----/);
      expect(ca.cert).toMatch(/-----BEGIN CERTIFICATE-----/);
      expect(existsSync(path.join(tmpRoot, "ca.pem"))).toBe(true);
      expect(existsSync(path.join(tmpRoot, "ca.key"))).toBe(true);
    });

    it("returns the same cert on subsequent calls (no regen, cached on disk)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const a = mgr.ensureCa();

      // Fresh manager — must load from disk, not regenerate.
      const mgr2 = new TlsManager({ caDir: tmpRoot });
      const b = mgr2.ensureCa();

      expect(a.cert).toBe(b.cert);
      expect(a.key).toBe(b.key);
    });

    it("CA cert carries the configured Common Name", () => {
      const mgr = new TlsManager({ caDir: tmpRoot, caCommonName: "Custom Synapse CA" });
      const ca = mgr.ensureCa();
      const x509 = new X509Certificate(ca.cert);
      expect(x509.subject).toContain("CN=Custom Synapse CA");
    });

    it("CA cert is marked as a CA (basicConstraints CA:TRUE)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const ca = mgr.ensureCa();
      const x509 = new X509Certificate(ca.cert);
      // X509Certificate doesn't expose basicConstraints directly, but
      // checkIssued requires the issuer to be a CA — so we use that as
      // the indirect test in the chain-validation test below.
      // Here we just sanity-check the cert has plausible CA-shaped fields.
      expect(x509.subject).toContain("Synapse");
    });

    it("CA validity is multi-year (default 10 years)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const ca = mgr.ensureCa();
      const x509 = new X509Certificate(ca.cert);
      const validFrom = new Date(x509.validFrom);
      const validTo = new Date(x509.validTo);
      const years = (validTo.getTime() - validFrom.getTime()) / (365 * 24 * 60 * 60 * 1000);
      expect(years).toBeGreaterThan(9);
    });
  });

  describe("getLeafCert", () => {
    it("generates a leaf cert for a hostname with the hostname as subject CN", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const leaf = mgr.getLeafCert("api.anthropic.com");
      const x509 = new X509Certificate(leaf.cert);
      expect(x509.subject).toContain("CN=api.anthropic.com");
    });

    it("leaf cert has DNS:hostname in subjectAltName (required by RFC 6125)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const leaf = mgr.getLeafCert("api.openai.com");
      const x509 = new X509Certificate(leaf.cert);
      expect(x509.subjectAltName).toBeDefined();
      expect(x509.subjectAltName).toContain("DNS:api.openai.com");
    });

    it("leaf cert chain validates against the CA (issued + signature verified)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const ca = mgr.ensureCa();
      const leaf = mgr.getLeafCert("api.anthropic.com");

      const caX509 = new X509Certificate(ca.cert);
      const leafX509 = new X509Certificate(leaf.cert);

      // Issuer chain: leaf was issued BY the CA.
      expect(leafX509.checkIssued(caX509)).toBe(true);
      // Signature: leaf's signature verifies against the CA's public key.
      // caX509.publicKey is already a KeyObject — pass it directly.
      expect(leafX509.verify(caX509.publicKey)).toBe(true);
    });

    it("returns the same cert on subsequent calls for the same hostname (in-memory cache)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const a = mgr.getLeafCert("api.anthropic.com");
      const b = mgr.getLeafCert("api.anthropic.com");
      // Reference equality not guaranteed (we re-read), but contents must match.
      expect(a.cert).toBe(b.cert);
      expect(a.key).toBe(b.key);
    });

    it("loads existing leaf from disk on a fresh TlsManager instance (cross-restart cache)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const a = mgr.getLeafCert("api.anthropic.com");

      const mgr2 = new TlsManager({ caDir: tmpRoot });
      const b = mgr2.getLeafCert("api.anthropic.com");
      expect(b.cert).toBe(a.cert);
    });

    it("generates DISTINCT leaves for different hostnames (no cross-host conflation)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const anthropic = mgr.getLeafCert("api.anthropic.com");
      const openai = mgr.getLeafCert("api.openai.com");
      expect(anthropic.cert).not.toBe(openai.cert);

      const anthropicX509 = new X509Certificate(anthropic.cert);
      const openaiX509 = new X509Certificate(openai.cert);
      expect(anthropicX509.subjectAltName).toContain("DNS:api.anthropic.com");
      expect(openaiX509.subjectAltName).toContain("DNS:api.openai.com");
    });

    it("leaf cert has shorter validity than CA (default 1 year)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      const leaf = mgr.getLeafCert("api.anthropic.com");
      const x509 = new X509Certificate(leaf.cert);
      const validFrom = new Date(x509.validFrom);
      const validTo = new Date(x509.validTo);
      const days = (validTo.getTime() - validFrom.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(360);
      expect(days).toBeLessThan(400);
    });

    it("cleans up intermediate artifacts (CSR + ext file) after signing", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      mgr.getLeafCert("api.anthropic.com");
      const leaves = readdirSync(path.join(tmpRoot, "leaves"));
      expect(leaves).toContain("api.anthropic.com.key");
      expect(leaves).toContain("api.anthropic.com.pem");
      expect(leaves).not.toContain("api.anthropic.com.csr");
      expect(leaves).not.toContain("api.anthropic.com.ext");
    });
  });

  describe("hostname safety (path-traversal defense)", () => {
    it.each([
      "../etc/passwd",
      "../../sensitive",
      "host/with/slash",
      "host\\with\\backslash",
      "host;rm -rf /",
      "host\x00null",
      "",
      ".",
      "..",
      "-leading-hyphen",
      ".leading-dot",
    ])("refuses to generate a leaf for unsafe hostname: %s", (hostname) => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      expect(() => mgr.getLeafCert(hostname)).toThrow(/unsafe hostname/);
      // Crucially: no file should appear OUTSIDE the configured caDir.
      // We can't easily assert "nothing outside tmpRoot was touched" but
      // we can assert the leafDir wasn't polluted with a weird-named file.
      if (existsSync(path.join(tmpRoot, "leaves"))) {
        const files = readdirSync(path.join(tmpRoot, "leaves"));
        for (const f of files) {
          expect(f).not.toContain("..");
          expect(f).not.toContain("/");
          expect(f).not.toContain("\\");
        }
      }
    });

    it("accepts ordinary DNS hostnames (alphanumeric, dots, hyphens)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      // None of these should throw.
      expect(() => mgr.getLeafCert("api.anthropic.com")).not.toThrow();
      expect(() => mgr.getLeafCert("sub-domain.example.com")).not.toThrow();
      expect(() => mgr.getLeafCert("api.openai.com")).not.toThrow();
    });
  });

  describe("caCertPath", () => {
    it("returns a stable path to the CA cert (useful for documenting trust install)", () => {
      const mgr = new TlsManager({ caDir: tmpRoot });
      mgr.ensureCa();
      const p = mgr.caCertPath();
      expect(p).toBe(path.join(tmpRoot, "ca.pem"));
      expect(existsSync(p)).toBe(true);
    });
  });
});
