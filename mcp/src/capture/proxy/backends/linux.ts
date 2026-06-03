/**
 * Linux backend — STUB for Slice A Task 1.
 *
 * Task 2 of the cross-platform proxy plan replaces this stub with the
 * real implementation (distro detection via /etc/os-release, Debian
 * family `update-ca-certificates`, RHEL family `update-ca-trust extract`,
 * Arch + unknown soft-skip).
 *
 * For now every method soft-skips with `skippedReason` containing
 * `platform=linux` — matches the pre-refactor `onboarding.ts` behavior
 * exactly so the existing onboarding test suite passes byte-identically.
 */

import type { InstallCheckResult, InstallResult, PlatformBackend, UninstallResult } from "./types.js";
import { buildSharedEnvSnippet } from "./types.js";

export const LinuxBackend: PlatformBackend = {
  name: "linux",

  installCa(caPath, opts): InstallResult {
    const proxyPort = opts.proxyPort ?? 7727;
    return {
      installed: false,
      caPath,
      fingerprint: "",
      envSnippet: this.buildEnvSnippet(caPath, proxyPort),
      manualInstallInstructions: this.buildManualInstructions(caPath, proxyPort),
      proxyPort,
      skippedReason:
        "keychain install skipped on platform=linux; follow manual instructions to install in your OS trust store",
    };
  },

  uninstallCa(_caPath, _opts): UninstallResult {
    return { removed: false, skippedReason: "keychain uninstall skipped on platform=linux" };
  },

  checkInstall(_caPath, _opts): InstallCheckResult {
    return { caExists: true, inTrustStore: false, fingerprint: null };
  },

  buildEnvSnippet(caPath, proxyPort) {
    return buildSharedEnvSnippet(caPath, proxyPort);
  },

  buildManualInstructions(caPath, proxyPort) {
    return [
      "Linux native install lands in Slice A Task 2 (Debian/RHEL).",
      "Until then, follow your distro's CA-trust documentation:",
      `  Debian/Ubuntu: sudo cp ${caPath} /usr/local/share/ca-certificates/synapse.crt && sudo update-ca-certificates`,
      `  Fedora/RHEL:   sudo cp ${caPath} /etc/pki/ca-trust/source/anchors/synapse.pem && sudo update-ca-trust extract`,
      "",
      "Then add to your shell rc:",
      `  export NODE_EXTRA_CA_CERTS="${caPath}"`,
      `  export HTTPS_PROXY="http://127.0.0.1:${proxyPort}"`,
    ].join("\n");
  },
};
