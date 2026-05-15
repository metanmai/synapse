import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderLaunchdPlist, renderSystemdUnit } from "../../src/capture/os-service.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-os-");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("os-service installers", () => {
  it("launchd plist contains synapse binary path and RunAtLoad=true", () => {
    const plist = renderLaunchdPlist({ bin: "/usr/local/bin/synapse", log: "/tmp/x.log" });
    expect(plist).toContain("/usr/local/bin/synapse");
    expect(plist).toContain("<key>RunAtLoad</key>");
  });

  it("systemd unit has the right Restart and ExecStart", () => {
    const unit = renderSystemdUnit({ bin: "/usr/local/bin/synapse", log: "/tmp/x.log" });
    expect(unit).toContain("ExecStart=/usr/local/bin/synapse daemon");
    expect(unit).toContain("Restart=always");
  });
});
