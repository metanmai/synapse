/**
 * Linux backend — native CA install via update-ca-certificates / update-ca-trust.
 *
 * Spec §4.2: family detection via /etc/os-release.
 *   debian-family → /usr/local/share/ca-certificates/synapse.crt + sudo update-ca-certificates
 *   rhel-family   → /etc/pki/ca-trust/source/anchors/synapse.pem + sudo update-ca-trust extract
 *   unknown       → soft-skip with distro-aware manual install instructions
 *                   (Arch gets its own block naming /etc/ca-certificates/trust-source/anchors/)
 *
 * Spec §4.3: sudo invocations use stdio:"inherit" so password prompts
 * reach the user's TTY. Non-zero exit → soft-fail with
 * { installed: false, requiresSudo: true, manualCommand } — never throws.
 *
 * All four runners (runSudo, runCp, readOsRelease, runOpenssl) are
 * injectable so unit tests never touch the real system trust store,
 * never spawn real sudo, never read the real /etc/os-release.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  type CommandResult,
  type InstallCheckResult,
  type InstallResult,
  type PlatformBackend,
  type UninstallResult,
  buildSharedEnvSnippet,
} from "./types.js";

type LinuxFamily = "debian" | "rhel" | "unknown";

/** Spec §4.2 debian-family IDs (matches ID or any ID_LIKE token). */
const DEBIAN_IDS = new Set([
  "debian",
  "ubuntu",
  "linuxmint",
  "mint",
  "pop",
  "elementary",
  "kali",
  "parrot",
  "raspbian",
  "alpine",
]);

/** Spec §4.2 rhel-family IDs. */
const RHEL_IDS = new Set([
  "fedora",
  "rhel",
  "centos",
  "rocky",
  "rockylinux",
  "almalinux",
  "amzn",
  "amazon",
  "ol",
  "oracle",
]);

const ARCH_IDS = new Set(["arch", "manjaro", "endeavouros"]);

/**
 * Pure parser exported for direct unit-test drive with fixture strings.
 * Reads `ID=` and `ID_LIKE=` lines; strips surrounding quotes from values;
 * splits on whitespace for ID_LIKE; returns the first matching family.
 *
 * Spec §4.2: debian/rhel/unknown — Arch maps to unknown (the trap distro),
 * matches ID_LIKE inheritance (Ubuntu has ID=ubuntu but ID_LIKE=debian).
 */
export function detectDistroFamily(osReleaseText: string | null): LinuxFamily {
  const candidates = parseCandidates(osReleaseText);
  for (const c of candidates) if (DEBIAN_IDS.has(c)) return "debian";
  for (const c of candidates) if (RHEL_IDS.has(c)) return "rhel";
  return "unknown";
}

function parseCandidates(osReleaseText: string | null): Set<string> {
  const candidates = new Set<string>();
  if (!osReleaseText) return candidates;
  for (const line of osReleaseText.split("\n")) {
    const match = line.match(/^(ID|ID_LIKE)=(.*)$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    for (const token of value.split(/\s+/)) {
      if (token) candidates.add(token.toLowerCase());
    }
  }
  return candidates;
}

const TRUST_PATHS = {
  debian: {
    anchor: "/usr/local/share/ca-certificates/synapse.crt",
    check: "/etc/ssl/certs/synapse.pem",
  },
  rhel: {
    anchor: "/etc/pki/ca-trust/source/anchors/synapse.pem",
    check: "/etc/pki/ca-trust/source/anchors/synapse.pem",
  },
} as const;

const UPDATE_CMD = {
  debian: ["update-ca-certificates"],
  rhel: ["update-ca-trust", "extract"],
} as const;

// ── Default runners (real subprocess; tests inject fakes) ────────────────

function defaultRunSudo(args: string[]): CommandResult {
  const r: SpawnSyncReturns<Buffer> = spawnSync("sudo", args, { stdio: "inherit" });
  return { status: r.status ?? -1, stdout: "", stderr: "" };
}

function defaultRunCp(args: string[]): CommandResult {
  if (args.length === 0) return { status: -1, stdout: "", stderr: "no args" };
  const [bin, ...rest] = args;
  const r: SpawnSyncReturns<Buffer> = spawnSync(bin, rest, { stdio: "pipe" });
  return {
    status: r.status ?? -1,
    stdout: (r.stdout ?? Buffer.from("")).toString("utf-8"),
    stderr: (r.stderr ?? Buffer.from("")).toString("utf-8"),
  };
}

function defaultReadOsRelease(): string | null {
  try {
    return readFileSync("/etc/os-release", "utf-8");
  } catch {
    return null;
  }
}

// ── Distro-aware manual instructions ─────────────────────────────────────

function buildManualInstructionsForFamily(
  family: LinuxFamily,
  candidates: Set<string>,
  caPath: string,
  proxyPort: number,
): string {
  const tail = [
    "",
    "Then add to your shell rc:",
    `  export NODE_EXTRA_CA_CERTS="${caPath}"`,
    `  export HTTPS_PROXY="http://127.0.0.1:${proxyPort}"`,
  ];

  if (family === "debian") {
    return [
      "Debian-family install:",
      `  sudo cp ${caPath} /usr/local/share/ca-certificates/synapse.crt`,
      "  sudo update-ca-certificates",
      ...tail,
    ].join("\n");
  }
  if (family === "rhel") {
    return [
      "RHEL-family install:",
      `  sudo cp ${caPath} /etc/pki/ca-trust/source/anchors/synapse.pem`,
      "  sudo update-ca-trust extract",
      ...tail,
    ].join("\n");
  }

  // unknown — detect Arch specifically for targeted text per spec §4.2 trap
  const isArch = [...candidates].some((c) => ARCH_IDS.has(c));
  if (isArch) {
    return [
      "Arch / Manjaro install:",
      `  sudo cp ${caPath} /etc/ca-certificates/trust-source/anchors/synapse-proxy.pem`,
      "  sudo trust extract-compat",
      ...tail,
    ].join("\n");
  }
  return [
    "Native install for this distro is not yet automated.",
    "Consult your distro's documentation for adding a trusted root certificate, then:",
    ...tail.slice(1), // drop the leading blank
  ].join("\n");
}

// ── Backend ──────────────────────────────────────────────────────────────

export const LinuxBackend: PlatformBackend = {
  name: "linux",

  installCa(caPath, opts): InstallResult {
    const proxyPort = opts.proxyPort ?? 7727;
    const envSnippet = buildSharedEnvSnippet(caPath, proxyPort);
    const readOsRelease = opts.readOsRelease ?? defaultReadOsRelease;
    const runSudo = opts.runSudo ?? defaultRunSudo;
    const runCp = opts.runCp ?? defaultRunCp;

    const osReleaseText = readOsRelease();
    const candidates = parseCandidates(osReleaseText);
    const family = detectDistroFamily(osReleaseText);
    const manualInstallInstructions = buildManualInstructionsForFamily(family, candidates, caPath, proxyPort);

    if (family === "unknown") {
      const reason =
        osReleaseText === null
          ? "no /etc/os-release found; cannot detect Linux distro"
          : "unsupported distro for automatic install — see manual install instructions";
      return {
        installed: false,
        caPath,
        fingerprint: "",
        envSnippet,
        manualInstallInstructions,
        proxyPort,
        skippedReason: reason,
      };
    }

    const { anchor } = TRUST_PATHS[family];
    const updateCmd = [...UPDATE_CMD[family]];

    // Spec §4.3: cp via runCp (so tests intercept).
    const cp = runCp(["sudo", "cp", caPath, anchor]);
    if (cp.status !== 0) {
      return {
        installed: false,
        caPath,
        fingerprint: "",
        envSnippet,
        manualInstallInstructions,
        proxyPort,
        requiresSudo: true,
        manualCommand: `sudo cp ${caPath} ${anchor}`,
        skippedReason: "sudo cp failed — re-run the manual install command",
      };
    }

    // Spec §4.3: update-ca-* via runSudo (stdio:"inherit" by default).
    const upd = runSudo(updateCmd);
    if (upd.status !== 0) {
      return {
        installed: false,
        caPath,
        fingerprint: "",
        envSnippet,
        manualInstallInstructions,
        proxyPort,
        requiresSudo: true,
        manualCommand: `sudo ${updateCmd.join(" ")}`,
        skippedReason: `${updateCmd[0]} failed — re-run the manual install command`,
      };
    }

    return {
      installed: true,
      caPath,
      fingerprint: "",
      envSnippet,
      manualInstallInstructions,
      proxyPort,
    };
  },

  uninstallCa(_caPath, opts): UninstallResult {
    const readOsRelease = opts.readOsRelease ?? defaultReadOsRelease;
    const runSudo = opts.runSudo ?? defaultRunSudo;
    const runCp = opts.runCp ?? defaultRunCp;
    const family = detectDistroFamily(readOsRelease());

    if (family === "unknown") {
      return { removed: false, skippedReason: "unsupported distro — nothing to remove" };
    }

    const { anchor } = TRUST_PATHS[family];
    const updateCmd = [...UPDATE_CMD[family]];

    // rm -f is idempotent — no need to pre-check existence.
    const cp = runCp(["sudo", "rm", "-f", anchor]);
    if (cp.status !== 0) {
      return { removed: false, skippedReason: "sudo rm failed" };
    }
    const upd = runSudo(updateCmd);
    return { removed: upd.status === 0 };
  },

  checkInstall(_caPath, opts): InstallCheckResult {
    const readOsRelease = opts.readOsRelease ?? defaultReadOsRelease;
    const runCp = opts.runCp ?? defaultRunCp;
    const family = detectDistroFamily(readOsRelease());

    if (family === "unknown") {
      return { caExists: true, inTrustStore: false, fingerprint: null };
    }
    const { check } = TRUST_PATHS[family];
    const r = runCp(["test", "-f", check]);
    return { caExists: true, inTrustStore: r.status === 0, fingerprint: null };
  },

  buildEnvSnippet(caPath, proxyPort) {
    return buildSharedEnvSnippet(caPath, proxyPort);
  },

  buildManualInstructions(caPath, proxyPort) {
    // Default to debian-family (most common). installCa() overrides per detected family.
    return buildManualInstructionsForFamily("debian", new Set(), caPath, proxyPort);
  },
};
