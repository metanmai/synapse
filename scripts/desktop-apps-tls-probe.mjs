#!/usr/bin/env node
// scripts/desktop-apps-tls-probe.mjs
//
// Pre-screen desktop AI apps for cert-pinning signals BEFORE running the
// manual proxy smoke checklist in docs/manual-tests/desktop-apps-proxy-smoke.md.
//
// The smoke checklist takes ~20 min per app. The dominant failure mode (per
// the checklist's own "What fails look like" section) is cert-pinning —
// the app ships its own CA bundle and refuses our proxy's leaf certs. This
// probe catches the most obvious cert-pinning signals statically so the
// user can skip the manual test for cases where the outcome is decided.
//
// macOS-only for v1. Three Electron apps probed: Cursor, Claude Desktop,
// ChatGPT Desktop. The probe is read-only — no network, no app launch,
// no system state changes. It just reads Info.plist + walks Resources/.
//
// Usage:
//   node scripts/desktop-apps-tls-probe.mjs           # human-readable
//   node scripts/desktop-apps-tls-probe.mjs --json    # machine-readable
//
// Exit code is always 0 — this is informational, not a gate.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";

// Apps to probe. `proxyHost` is the API hostname we'd see in NSPinnedDomains
// if the app is doing explicit cert-pinning for its primary LLM endpoint.
const APPS = [
  { name: "Cursor", bundle: "Cursor.app", proxyHost: "api.anthropic.com" },
  // Anthropic ships their desktop app as `Claude.app` on macOS (not
  // "Claude Desktop.app"). Confirmed via the macOS download installer in
  // 2026. If a future Anthropic rename breaks this, the verdict becomes
  // "not-installed" which falls back to the existing manual test path.
  { name: "Claude Desktop", bundle: "Claude.app", proxyHost: "api.anthropic.com" },
  { name: "ChatGPT Desktop", bundle: "ChatGPT.app", proxyHost: "api.openai.com" },
];

// Both system-wide and user-local Applications dirs. Some users install
// from the Mac App Store (writes to /Applications) and some via .dmg
// (often /Applications, but possible at ~/Applications too).
const SEARCH_ROOTS = ["/Applications", path.join(homedir(), "Applications")];

/** Locate an app bundle by name. Returns null if not found in either dir. */
function findApp(bundleName) {
  for (const root of SEARCH_ROOTS) {
    const full = path.join(root, bundleName);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Extract App Transport Security flags from Contents/Info.plist using
 * `plutil` (preinstalled on macOS). Returns the two signals we care
 * about: explicit pinned domains list, and the "allow arbitrary loads"
 * escape hatch.
 *
 * NSAppTransportSecurity is Apple's TLS-policy declaration. If an app
 * pins to a specific hostname, it shows up in NSPinnedDomains. If the
 * app instead disables ATS entirely (rare for AI apps but possible),
 * NSAllowsArbitraryLoads will be true.
 */
function probeInfoPlist(appPath) {
  const plist = path.join(appPath, "Contents", "Info.plist");
  if (!existsSync(plist)) {
    return { atsFound: false, atsLoadsArbitrary: undefined, pinnedDomains: [] };
  }
  try {
    const json = execSync(`plutil -convert json -o - "${plist}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(json);
    const ats = parsed.NSAppTransportSecurity ?? {};
    const pinned = ats.NSPinnedDomains ?? {};
    return {
      atsFound: true,
      atsLoadsArbitrary: ats.NSAllowsArbitraryLoads === true,
      pinnedDomains: Object.keys(pinned),
    };
  } catch {
    // plutil error (corrupt plist, perms, etc.) — treat as no signals,
    // fall through to the bundled-CA check.
    return { atsFound: false, atsLoadsArbitrary: undefined, pinnedDomains: [] };
  }
}

/**
 * Walk Contents/Resources/ for filenames that look like private CA
 * bundles. Most Electron apps that cert-pin do so by shipping a CA
 * bundle and pointing their Node TLS at it instead of the OS trust
 * store, which is the proxy MITM's mortal enemy.
 *
 * Depth is capped at 4 because some apps have node_modules trees that
 * go many levels deep; a depth-2 lookup misses bundles in standard
 * locations, depth-4 hits the common ones without traversing the asar
 * (which isn't directory-walkable anyway).
 */
function probeBundledCAs(appPath) {
  const resourcesDir = path.join(appPath, "Contents", "Resources");
  if (!existsSync(resourcesDir)) return { caFiles: [] };
  try {
    const cmd = `find "${resourcesDir}" -maxdepth 4 -type f \\( -name "cacert*.pem" -o -name "ca-bundle*" -o -name "cacerts*" -o -name "ca-certificates*.crt" \\) 2>/dev/null | head -20`;
    const out = execSync(cmd, { encoding: "utf8" });
    const matches = out.trim().split("\n").filter(Boolean);
    return { caFiles: matches };
  } catch {
    return { caFiles: [] };
  }
}

/**
 * Map raw signals to a single verdict. Confidence reflects how
 * conclusive the signal is:
 *   - high: NSPinnedDomains or NSAllowsArbitraryLoads — definitive
 *   - medium: bundled CA file present — suggestive but not conclusive
 *     (a CA bundle may also be present for cross-platform consistency
 *     without actually disabling system trust)
 *   - low: no signals, the manual smoke test is the only way to know
 */
function classify(app, info, ca) {
  // 1. Explicit NSPinnedDomains for an API host we care about → cert-pinned.
  const pinHit = info.pinnedDomains.find((d) => app.proxyHost.includes(d) || d.includes(app.proxyHost));
  if (pinHit) {
    return {
      verdict: "cert-pinned",
      confidence: "high",
      reason: `NSPinnedDomains in Info.plist lists ${pinHit}`,
    };
  }
  // 2. Bundled CA file → likely cert-pinned.
  if (ca.caFiles.length > 0) {
    const names = ca.caFiles.slice(0, 3).map((f) => path.basename(f));
    return {
      verdict: "likely-cert-pinned",
      confidence: "medium",
      reason: `bundled CA file(s) in Resources/: ${names.join(", ")}`,
    };
  }
  // 3. NSAllowsArbitraryLoads=true → app honors system TLS settings.
  if (info.atsLoadsArbitrary === true) {
    return {
      verdict: "proxy-friendly",
      confidence: "high",
      reason: "NSAllowsArbitraryLoads=true",
    };
  }
  // 4. No signals.
  return {
    verdict: "ambiguous",
    confidence: "low",
    reason: "no static signals; run the manual checklist",
  };
}

function pad(s, n) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printHumanTable(results) {
  console.log("\nSYNAPSE DESKTOP APPS — TLS PROBE");
  console.log("─".repeat(80));
  console.log(`${pad("App", 20)} ${pad("Verdict", 22)} ${pad("Conf.", 8)} Why`);
  console.log("─".repeat(80));
  for (const r of results) {
    if (!r.installed) {
      console.log(`${pad(r.app.name, 20)} ${pad("not-installed", 22)} ${pad("—", 8)} skipped`);
      continue;
    }
    console.log(`${pad(r.app.name, 20)} ${pad(r.verdict, 22)} ${pad(r.confidence, 8)} ${r.reason}`);
  }
  console.log("─".repeat(80));
  console.log("\nRecommendation:");
  let anyAmbiguous = false;
  let anyProxyFriendly = false;
  for (const r of results) {
    if (!r.installed) continue;
    if (r.verdict === "cert-pinned" || r.verdict === "likely-cert-pinned") {
      console.log(`  ${r.app.name}: SKIP manual smoke — record finding as cert-pinned, proxy MITM not viable.`);
    } else if (r.verdict === "proxy-friendly") {
      console.log(`  ${r.app.name}: manual smoke likely PASSES; proceed with the checklist.`);
      anyProxyFriendly = true;
    } else {
      console.log(`  ${r.app.name}: signals ambiguous — run the manual checklist.`);
      anyAmbiguous = true;
    }
  }
  if (anyAmbiguous || anyProxyFriendly) {
    console.log("\nManual checklist: docs/manual-tests/desktop-apps-proxy-smoke.md");
  } else {
    console.log("\nNo manual test needed — all probed apps decided statically.");
  }
  console.log("");
}

function main() {
  if (platform() !== "darwin") {
    console.log(
      "desktop-apps-tls-probe: macOS only for v1. On Linux/Windows, run docs/manual-tests/desktop-apps-proxy-smoke.md directly.",
    );
    process.exit(0);
  }
  const results = APPS.map((app) => {
    const appPath = findApp(app.bundle);
    if (!appPath) return { app, installed: false, verdict: "not-installed" };
    const info = probeInfoPlist(appPath);
    const ca = probeBundledCAs(appPath);
    const c = classify(app, info, ca);
    return { app, installed: true, appPath, info, ca, ...c };
  });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printHumanTable(results);
  }
}

main();
