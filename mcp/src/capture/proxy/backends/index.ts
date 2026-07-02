/**
 * Dispatcher — selects the right `PlatformBackend` for the current OS.
 *
 * Cross-platform proxy CA onboarding (spec §3.1). Adding a new platform
 * means writing a new backend file and adding one switch branch here.
 *
 * Slice A: mac (real), linux (stub → Task 2 real), everything else →
 * UnknownBackend that soft-skips with a `skippedReason` mentioning the
 * platform (and "Slice B" for win32 specifically).
 */

import { LinuxBackend } from "./linux.js";
import { MacBackend } from "./mac.js";
import {
  type BackendOptions,
  type InstallCheckResult,
  type InstallResult,
  type PlatformBackend,
  type UninstallResult,
  buildSharedEnvSnippet,
} from "./types.js";

export function detectBackend(platform: NodeJS.Platform): PlatformBackend {
  switch (platform) {
    case "darwin":
      return MacBackend;
    case "linux":
      return LinuxBackend;
    default:
      return makeUnknownBackend(platform);
  }
}

function makeUnknownBackend(platform: NodeJS.Platform): PlatformBackend {
  const sliceBNote = platform === "win32" ? "; Windows arrives in Slice B" : "";

  return {
    name: "unknown",

    installCa(caPath, opts): InstallResult {
      const proxyPort = opts.proxyPort ?? 7727;
      return {
        installed: false,
        caPath,
        fingerprint: "",
        envSnippet: buildSharedEnvSnippet(caPath, proxyPort),
        manualInstallInstructions: this.buildManualInstructions(caPath, proxyPort),
        proxyPort,
        skippedReason: `keychain install skipped on platform=${platform}${sliceBNote}; follow manual instructions to install in your OS trust store`,
      };
    },

    uninstallCa(_caPath, _opts): UninstallResult {
      return {
        removed: false,
        skippedReason: `keychain uninstall skipped on platform=${platform}${sliceBNote}`,
      };
    },

    checkInstall(_caPath, _opts): InstallCheckResult {
      return { caExists: true, inTrustStore: false, fingerprint: null };
    },

    buildEnvSnippet(caPath, proxyPort) {
      return buildSharedEnvSnippet(caPath, proxyPort);
    },

    buildManualInstructions(caPath, proxyPort) {
      return [
        `Native install for platform=${platform} is not yet implemented${sliceBNote}.`,
        "Consult your OS's documentation for adding a trusted root certificate.",
        "",
        "Then add to your shell rc:",
        `  export NODE_EXTRA_CA_CERTS="${caPath}"`,
        `  export HTTPS_PROXY="http://127.0.0.1:${proxyPort}"`,
      ].join("\n");
    },
  };
}

export type { BackendOptions, PlatformBackend };
