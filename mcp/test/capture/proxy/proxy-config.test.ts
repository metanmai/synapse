// mcp/test/capture/proxy/proxy-config.test.ts
//
// Bug class: "the proxy-config persistence (a) crashes on missing
// file, (b) resolves the env-vs-config precedence incorrectly,
// (c) leaves stale data after delete, (d) reads a different path
// than the daemon writes (drift), OR (e) silently accepts malformed
// JSON instead of falling back to disabled."

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteProxyConfig,
  effectiveProxyEnabled,
  proxyConfigPath,
  readProxyConfig,
  writeProxyConfig,
} from "../../../src/capture/proxy/proxy-config.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "synapse-proxy-config-"));
  // synapseRoot() reads SYNAPSE_HOME first — isolate this test's writes
  // to tmpRoot instead of touching the user's real ~/.synapse/.
  vi.stubEnv("SYNAPSE_HOME", tmpRoot);
  vi.stubEnv("SYNAPSE_PROXY_ENABLE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* */
  }
});

describe("readProxyConfig / writeProxyConfig / deleteProxyConfig", () => {
  it("read on missing file returns the documented default (enabled=false) without throwing", () => {
    // Bug class: daemon startup must NOT throw if the user has never
    // run `proxy enable`. The default is "off".
    const cfg = readProxyConfig();
    expect(cfg).toEqual({ enabled: false });
    expect(existsSync(proxyConfigPath())).toBe(false);
  });

  it("write then read round-trips the persisted state", () => {
    writeProxyConfig({ enabled: true, enabledAt: "2026-05-30T12:00:00.000Z" });
    expect(existsSync(proxyConfigPath())).toBe(true);
    const read = readProxyConfig();
    expect(read.enabled).toBe(true);
    expect(read.enabledAt).toBe("2026-05-30T12:00:00.000Z");
  });

  it("delete removes the file and subsequent reads return the default", () => {
    writeProxyConfig({ enabled: true });
    expect(existsSync(proxyConfigPath())).toBe(true);
    deleteProxyConfig();
    expect(existsSync(proxyConfigPath())).toBe(false);
    expect(readProxyConfig()).toEqual({ enabled: false });
  });

  it("delete is idempotent on missing file (no-throw)", () => {
    expect(() => deleteProxyConfig()).not.toThrow();
    expect(() => deleteProxyConfig()).not.toThrow();
  });

  it("malformed JSON falls back to disabled (fail-safe, never crashes daemon)", () => {
    // Bug class: a corrupted ~/.synapse/proxy-config.json must NOT
    // prevent the daemon from starting — it should just default to
    // "proxy off" and let the user re-run `proxy enable`.
    writeFileSync(proxyConfigPath(), "{not valid json[");
    const cfg = readProxyConfig();
    expect(cfg).toEqual({ enabled: false });
  });

  it("proxyConfigPath sits under SYNAPSE_HOME (drift-free with the CLI's writer)", () => {
    // Bug class: if the CLI's `proxy enable` writes to one path and
    // the daemon's readProxyConfig() reads from another, the user
    // would see "enabled" in the CLI status but the daemon would
    // never spawn the proxy.
    expect(proxyConfigPath()).toBe(path.join(tmpRoot, "proxy-config.json"));
  });
});

describe("effectiveProxyEnabled", () => {
  it("env=1 forces ON regardless of config (operator override)", () => {
    writeProxyConfig({ enabled: false });
    expect(effectiveProxyEnabled({ SYNAPSE_PROXY_ENABLE: "1" })).toBe(true);
  });

  it("env=0 forces OFF regardless of config (operator override)", () => {
    writeProxyConfig({ enabled: true });
    expect(effectiveProxyEnabled({ SYNAPSE_PROXY_ENABLE: "0" })).toBe(false);
  });

  it("env unset + config.enabled=true → ON (persistent state from `proxy enable`)", () => {
    writeProxyConfig({ enabled: true });
    expect(effectiveProxyEnabled({})).toBe(true);
  });

  it("env unset + config.enabled=false → OFF", () => {
    writeProxyConfig({ enabled: false });
    expect(effectiveProxyEnabled({})).toBe(false);
  });

  it("env unset + no config file → OFF (default)", () => {
    expect(effectiveProxyEnabled({})).toBe(false);
  });

  it("other env values (e.g. 'true', 'yes') do NOT trigger the override — only the literal '1' and '0' count", () => {
    // Bug class: lax env-var parsing could let a typo like
    // SYNAPSE_PROXY_ENABLE=true silently disable an enabled config.
    // The override semantics are strict ("1" or "0" only) so config
    // wins for everything else.
    writeProxyConfig({ enabled: true });
    expect(effectiveProxyEnabled({ SYNAPSE_PROXY_ENABLE: "true" })).toBe(true);
    expect(effectiveProxyEnabled({ SYNAPSE_PROXY_ENABLE: "yes" })).toBe(true);
    writeProxyConfig({ enabled: false });
    expect(effectiveProxyEnabled({ SYNAPSE_PROXY_ENABLE: "true" })).toBe(false);
    expect(effectiveProxyEnabled({ SYNAPSE_PROXY_ENABLE: "yes" })).toBe(false);
  });
});
