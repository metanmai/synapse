import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStartCommand, installHooks, isInstalled, uninstallHooks } from "../../../src/capture/hooks.js";

describe("Capture Hooks", () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syn-hooks-"));
    settingsPath = path.join(tmpDir, "settings.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("buildStartCommand", () => {
    it("returns a bash command referencing the worker path", () => {
      const cmd = buildStartCommand("/fake/capture-worker.js");
      expect(cmd).toContain("capture-worker.js");
      expect(cmd).toContain("PID_FILE=");
      expect(cmd).toContain("kill -0");
      expect(cmd).toContain("nohup node");
    });

    it("is idempotent — checks PID before starting", () => {
      const cmd = buildStartCommand("/fake/capture-worker.js");
      expect(cmd).toContain("exit 0");
      expect(cmd).toContain("kill -0");
    });

    it("creates .synapse directory", () => {
      const cmd = buildStartCommand("/fake/capture-worker.js");
      expect(cmd).toContain("mkdir -p");
      expect(cmd).toContain(".synapse");
    });
  });

  describe("installHooks", () => {
    it("creates settings file if it does not exist", () => {
      const result = installHooks(settingsPath);
      expect(result.installed).toBe(true);
      expect(result.alreadyInstalled).toBe(false);
      expect(fs.existsSync(settingsPath)).toBe(true);
    });

    it("adds SessionStart hook with capture-worker command", () => {
      installHooks(settingsPath);
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toHaveLength(1);
      expect(settings.hooks.SessionStart[0].hooks[0].type).toBe("command");
      expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("capture-worker.js");
      expect(settings.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
    });

    it("preserves existing settings and hooks", () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          theme: "dark",
          hooks: {
            PostToolUse: [{ hooks: [{ type: "command", command: "echo done" }] }],
          },
        }),
      );

      installHooks(settingsPath);
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.theme).toBe("dark");
      expect(settings.hooks.PostToolUse).toHaveLength(1);
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it("does not duplicate if already installed", () => {
      installHooks(settingsPath);
      const second = installHooks(settingsPath);
      expect(second.installed).toBe(false);
      expect(second.alreadyInstalled).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it("appends to existing SessionStart hooks", () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "echo other" }] }],
          },
        }),
      );

      installHooks(settingsPath);
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toHaveLength(2);
    });
  });

  describe("isInstalled", () => {
    it("returns false when no settings file exists", () => {
      expect(isInstalled(settingsPath)).toBe(false);
    });

    it("returns false when no hooks configured", () => {
      fs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
      expect(isInstalled(settingsPath)).toBe(false);
    });

    it("returns true after install", () => {
      installHooks(settingsPath);
      expect(isInstalled(settingsPath)).toBe(true);
    });

    it("returns false after uninstall", () => {
      installHooks(settingsPath);
      uninstallHooks(settingsPath);
      expect(isInstalled(settingsPath)).toBe(false);
    });
  });

  describe("uninstallHooks", () => {
    it("removes Synapse hook from SessionStart", () => {
      installHooks(settingsPath);
      const result = uninstallHooks(settingsPath);
      expect(result.removed).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks).toBeUndefined();
    });

    it("returns removed=false when no settings file", () => {
      const result = uninstallHooks(settingsPath);
      expect(result.removed).toBe(false);
    });

    it("returns removed=false when no hooks to remove", () => {
      fs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
      const result = uninstallHooks(settingsPath);
      expect(result.removed).toBe(false);
    });

    it("preserves other SessionStart hooks", () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: "echo other" }] },
              { hooks: [{ type: "command", command: "nohup node /x/capture-worker.js &" }] },
            ],
          },
        }),
      );

      uninstallHooks(settingsPath);
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toHaveLength(1);
      expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("echo other");
    });

    it("preserves other hook events", () => {
      installHooks(settingsPath);

      // Add another event
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      settings.hooks.PostToolUse = [{ hooks: [{ type: "command", command: "echo lint" }] }];
      fs.writeFileSync(settingsPath, JSON.stringify(settings));

      uninstallHooks(settingsPath);
      const after = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(after.hooks.PostToolUse).toHaveLength(1);
      expect(after.hooks.SessionStart).toBeUndefined();
    });
  });
});
