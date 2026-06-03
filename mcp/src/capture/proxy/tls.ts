/**
 * TLS Manager for the LLM API proxy daemon (Layer 3a).
 *
 * Produces the certs that let the proxy's CONNECT handler (Layer 3b)
 * terminate TLS — i.e., be a transparent man-in-the-middle for HTTPS
 * traffic. Without this, the proxy can only see plain HTTP, which no
 * real AI tool uses.
 *
 * Cert hierarchy (mitmproxy-style):
 *
 *   Synapse CA  (self-signed, generated once, valid 10 years)
 *       │
 *       └─ signs leaf certs:
 *           ├─ api.anthropic.com  (SAN: DNS:api.anthropic.com)
 *           ├─ api.openai.com     (SAN: DNS:api.openai.com)
 *           └─ ... per hostname, lazily, on first proxy-CONNECT
 *
 * The CA must be installed in the client's trust store (system keychain
 * for GUI tools, NODE_EXTRA_CA_CERTS for Node CLI tools). Once trusted,
 * the client's TLS handshake against any of these leaf certs succeeds —
 * the client thinks it's talking to api.anthropic.com directly, but in
 * fact it's talking to the proxy holding a cert we signed.
 *
 * Implementation notes:
 *   - Uses `openssl` via child_process — no JS-cert-lib dependency
 *   - `execFileSync` everywhere with argv arrays, never shell interpolation
 *     (so attacker-controlled hostnames can't inject shell metacharacters)
 *   - Hostname sanitization for filesystem path components
 *   - Two-tier caching: in-memory Map for hot path, disk for cross-restart
 *   - First-call cost ~100ms per cert (one openssl process spawn); cached
 *     calls are zero-cost
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { synapseRoot } from "../handoff-paths.js";

export interface CertPair {
  /** PEM-encoded private key */
  key: string;
  /** PEM-encoded certificate */
  cert: string;
}

export interface TlsManagerOptions {
  /** Directory to store CA + leaf certs. Defaults to `${synapseRoot()}/proxy`. */
  caDir?: string;
  /** Common Name for the generated CA. Default "Synapse Proxy CA". */
  caCommonName?: string;
  /** CA validity in days. Default 3650 (10 years). */
  caValidDays?: number;
  /** Leaf cert validity in days. Default 365. */
  leafValidDays?: number;
  /** RSA key size for new keys. Default 2048. */
  keyBits?: number;
}

const HOSTNAME_SAFE_CHARS = /^[a-zA-Z0-9._-]+$/;

export class TlsManager {
  private readonly caDir: string;
  private readonly leafDir: string;
  private readonly caCommonName: string;
  private readonly caValidDays: number;
  private readonly leafValidDays: number;
  private readonly keyBits: number;
  private readonly leafCache = new Map<string, CertPair>();
  private cachedCa: CertPair | null = null;

  constructor(opts: TlsManagerOptions = {}) {
    this.caDir = opts.caDir ?? path.join(synapseRoot(), "proxy");
    this.leafDir = path.join(this.caDir, "leaves");
    this.caCommonName = opts.caCommonName ?? "Synapse Proxy CA";
    this.caValidDays = opts.caValidDays ?? 3650;
    this.leafValidDays = opts.leafValidDays ?? 365;
    this.keyBits = opts.keyBits ?? 2048;
  }

  /**
   * Path to the CA cert PEM — what the user needs to install in their
   * system trust store. Stable across calls.
   */
  caCertPath(): string {
    return path.join(this.caDir, "ca.pem");
  }

  /**
   * Ensure a CA exists. Generates on first call, loads from disk on
   * subsequent calls (including across process restarts).
   */
  ensureCa(): CertPair {
    if (this.cachedCa) return this.cachedCa;

    const keyPath = path.join(this.caDir, "ca.key");
    const certPath = path.join(this.caDir, "ca.pem");

    if (existsSync(keyPath) && existsSync(certPath)) {
      this.cachedCa = {
        key: readFileSync(keyPath, "utf-8"),
        cert: readFileSync(certPath, "utf-8"),
      };
      return this.cachedCa;
    }

    mkdirSync(this.caDir, { recursive: true, mode: 0o700 });

    // Generate RSA key.
    execFileSync("openssl", ["genrsa", "-out", keyPath, String(this.keyBits)], { stdio: "ignore" });
    chmodSync(keyPath, 0o600);

    // Self-signed CA cert.
    // -extensions v3_ca with -addext for CA basic constraints — older
    // openssl needed a config file; openssl 1.1.1+ accepts -addext.
    execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-x509",
        "-days",
        String(this.caValidDays),
        "-key",
        keyPath,
        "-out",
        certPath,
        "-subj",
        `/CN=${this.caCommonName}/O=Synapse`,
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
      ],
      { stdio: "ignore" },
    );

    this.cachedCa = {
      key: readFileSync(keyPath, "utf-8"),
      cert: readFileSync(certPath, "utf-8"),
    };
    return this.cachedCa;
  }

  /**
   * Get a leaf cert for `hostname`, signed by the CA, with SAN
   * `DNS:hostname` so the client's TLS validation passes.
   *
   * Generates lazily on first call per hostname; caches in memory + on
   * disk for subsequent calls.
   *
   * Throws if the hostname contains characters that aren't safe for
   * filesystem paths (defense against path-traversal via attacker-
   * controlled hostnames in proxied requests).
   */
  getLeafCert(hostname: string): CertPair {
    if (!isSafeHostname(hostname)) {
      throw new Error(`tls: refusing to generate leaf for unsafe hostname: ${JSON.stringify(hostname)}`);
    }

    const cached = this.leafCache.get(hostname);
    if (cached) return cached;

    this.ensureCa();
    mkdirSync(this.leafDir, { recursive: true, mode: 0o700 });

    const keyPath = path.join(this.leafDir, `${hostname}.key`);
    const certPath = path.join(this.leafDir, `${hostname}.pem`);

    if (existsSync(keyPath) && existsSync(certPath)) {
      const pair: CertPair = {
        key: readFileSync(keyPath, "utf-8"),
        cert: readFileSync(certPath, "utf-8"),
      };
      this.leafCache.set(hostname, pair);
      return pair;
    }

    const csrPath = path.join(this.leafDir, `${hostname}.csr`);
    const extPath = path.join(this.leafDir, `${hostname}.ext`);

    try {
      // Leaf private key.
      execFileSync("openssl", ["genrsa", "-out", keyPath, String(this.keyBits)], { stdio: "ignore" });
      chmodSync(keyPath, 0o600);

      // CSR with subject CN=hostname.
      execFileSync("openssl", ["req", "-new", "-key", keyPath, "-out", csrPath, "-subj", `/CN=${hostname}`], {
        stdio: "ignore",
      });

      // SAN extension. Required for modern TLS clients to accept the cert
      // — Chrome/Node/etc. ignore CN if SAN is absent (RFC 6125 §6.4.4).
      writeFileSync(extPath, `subjectAltName=DNS:${hostname}\nextendedKeyUsage=serverAuth\n`, "utf-8");

      // Sign with the CA.
      execFileSync(
        "openssl",
        [
          "x509",
          "-req",
          "-in",
          csrPath,
          "-CA",
          path.join(this.caDir, "ca.pem"),
          "-CAkey",
          path.join(this.caDir, "ca.key"),
          "-CAcreateserial",
          "-out",
          certPath,
          "-days",
          String(this.leafValidDays),
          "-extfile",
          extPath,
        ],
        { stdio: "ignore" },
      );
    } finally {
      // CSR and ext file are intermediate artifacts; the leaf cert + key
      // are what we keep. Clean up the intermediates so the leafDir
      // contains only what's needed for future cache hits.
      for (const p of [csrPath, extPath]) {
        try {
          if (existsSync(p)) unlinkSync(p);
        } catch {
          /* best-effort cleanup */
        }
      }
    }

    const pair: CertPair = {
      key: readFileSync(keyPath, "utf-8"),
      cert: readFileSync(certPath, "utf-8"),
    };
    this.leafCache.set(hostname, pair);
    return pair;
  }

  /**
   * Drop the in-memory leaf cache. Useful for tests; rarely used in
   * production. Does NOT delete on-disk certs.
   */
  clearMemoryCache(): void {
    this.leafCache.clear();
    this.cachedCa = null;
  }
}

/**
 * Validate that a hostname is safe to use as a filesystem path component.
 * Allows DNS hostnames per RFC 1123 (alphanumerics, dots, hyphens, plus
 * underscores which appear in some internal hostnames). Rejects path
 * separators, "..", null bytes, etc.
 */
function isSafeHostname(hostname: string): boolean {
  if (!hostname || hostname.length === 0 || hostname.length > 253) return false;
  if (hostname.includes("..")) return false;
  if (hostname.startsWith(".") || hostname.startsWith("-")) return false;
  return HOSTNAME_SAFE_CHARS.test(hostname);
}
