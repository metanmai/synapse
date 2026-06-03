import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LAUNCHD_LABEL,
  renderLaunchdPlist,
  renderSystemdUnit,
  resolveDaemonScriptPath,
} from "../../src/capture/os-service.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-os-"));
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
    // Use a platform-absolute fake module path so pathToFileURL accepts it
    // without resolving against CWD (which would prepend the CI runner's
    // drive letter like `D:\fake\...` and break a string-equality assert).
    //   POSIX:   /fake/build/dist/capture/os-service.js
    //   Windows: C:\fake\build\dist\capture\os-service.js
    const fakeBase = process.platform === "win32" ? "C:\\fake\\build" : "/fake/build";
    const fakeModuleUrl = pathToFileURL(path.join(fakeBase, "dist", "capture", "os-service.js")).href;
    const resolved = resolveDaemonScriptPath(fakeModuleUrl);
    const expected = path.join(fakeBase, "dist", "index.js");
    expect(resolved).toBe(expected);
    // The historical bug pointed at cli/commands.js — must never come back.
    expect(resolved).not.toContain(path.join("cli", "commands.js"));
    expect(resolved.endsWith(path.join("dist", "index.js"))).toBe(true);
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

// LAUNCHD_LABEL invariant — appended in Plan 01-01 Task 2. These two cases
// turn GREEN immediately after Task 3 lands (unlike the BUG-02/03/04 tests in
// sibling files which stay RED until Wave 2/3).
//
// Class-correct guards for the bug class "the label is a single source of
// truth, importable, and the plist renders the same string." They do NOT
// grep source text — any rename, shadowing, re-export, or accidental
// double-render is caught at runtime via the actual export + actual
// `renderLaunchdPlist` call.

describe("LAUNCHD_LABEL invariant", () => {
  it("exports LAUNCHD_LABEL as a runtime constant equal to 'app.synapsesync.daemon'", () => {
    expect(LAUNCHD_LABEL).toBe("app.synapsesync.daemon");
  });

  it("renderLaunchdPlist output contains the LAUNCHD_LABEL string exactly once", () => {
    const plist = renderLaunchdPlist({
      node: "/opt/homebrew/bin/node",
      script: "/Users/x/synapse/mcp/dist/index.js",
      log: "/tmp/x.log",
    });
    // Render-equivalence: the label flows from the constant into the plist
    // body exactly once. Catches: missing label, accidental double-render,
    // replacement with a different string.
    const matches = plist.match(/<string>app\.synapsesync\.daemon<\/string>/g);
    expect(matches?.length).toBe(1);
  });
});
