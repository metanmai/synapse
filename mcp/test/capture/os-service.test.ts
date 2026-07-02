import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderLaunchdPlist, renderSystemdUnit, resolveDaemonScriptPath } from "../../src/capture/os-service.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-os-");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("os-service installers", () => {
  it("launchd plist contains node + script paths and RunAtLoad=true", () => {
    const plist = renderLaunchdPlist({
      node: "/opt/homebrew/bin/node",
      script: "/Users/x/synapse/mcp/dist/cli/commands.js",
      log: "/tmp/x.log",
    });
    expect(plist).toContain("/opt/homebrew/bin/node");
    expect(plist).toContain("/Users/x/synapse/mcp/dist/cli/commands.js");
    expect(plist).toContain("<key>RunAtLoad</key>");
  });

  // Regression: node and script must be separate <string> elements in
  // ProgramArguments. launchd treats each <string> as one argv entry, so
  // a single string containing "node /path" would try to exec a literal
  // file named "node /path" (status 19968 = 127 << 8, "command not found").
  it("launchd plist splits node + script + 'daemon' into 3 separate <string> argv entries", () => {
    const plist = renderLaunchdPlist({
      node: "/opt/homebrew/bin/node",
      script: "/Users/x/synapse/mcp/dist/cli/commands.js",
      log: "/tmp/x.log",
    });
    // Each token must appear as its own <string>...</string> element inside
    // ProgramArguments. The combined "node /path/to/commands.js" form is
    // explicitly what we must NOT produce.
    expect(plist).toMatch(/<string>\/opt\/homebrew\/bin\/node<\/string>/);
    expect(plist).toMatch(/<string>\/Users\/x\/synapse\/mcp\/dist\/cli\/commands\.js<\/string>/);
    expect(plist).toMatch(/<string>daemon<\/string>/);
    // The bug shape: node and script combined into one <string>.
    expect(plist).not.toContain("<string>/opt/homebrew/bin/node /Users/x/synapse/mcp/dist/cli/commands.js");
  });

  // Regression: writeServiceFile must point launchd/systemd at dist/index.js
  // (the real entry with the dispatcher), NOT dist/cli/commands.js (helper
  // module with no top-level main — exec'ing it loads the module and exits
  // cleanly with no daemon running). After build, os-service.js sits at
  // dist/capture/os-service.js so the script path resolves up one level.
  it("resolveDaemonScriptPath resolves to dist/index.js relative to dist/capture/", () => {
    const fakeModuleUrl = pathToFileURL("/fake/build/dist/capture/os-service.js").href;
    const resolved = resolveDaemonScriptPath(fakeModuleUrl);
    expect(resolved).toBe("/fake/build/dist/index.js");
    // The historical bug pointed at cli/commands.js — must never come back.
    expect(resolved).not.toContain("/cli/commands.js");
    expect(resolved.endsWith("/dist/index.js")).toBe(true);
  });

  it("systemd unit has the right Restart and a shell-style ExecStart with node + script + arg", () => {
    const unit = renderSystemdUnit({
      node: "/usr/bin/node",
      script: "/opt/synapse/dist/cli/commands.js",
      log: "/tmp/x.log",
    });
    expect(unit).toContain("ExecStart=/usr/bin/node /opt/synapse/dist/cli/commands.js daemon");
    expect(unit).toContain("Restart=always");
  });
});
