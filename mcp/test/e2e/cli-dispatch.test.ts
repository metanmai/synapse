/**
 * Regression test for the CLI subcommand dispatcher.
 *
 * Guards against the "allow-list vs dispatcher drift" bug that shipped
 * in 0.7.3 (see commit history): a subcommand had a handler wired up
 * but was missing from the allow-list, so it was rejected as "Unknown
 * command" before reaching the handler.
 *
 * This test asserts that every registered subcommand dispatches — i.e.
 * the CLI does NOT print "Unknown command: <name>" for any of them.
 * It does not run the commands to completion (most require network or
 * prompts); it just verifies the dispatch path is intact.
 *
 * Run: TEST_E2E=1 npm run test:e2e
 */
import child_process from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RUN = process.env.TEST_E2E === "1";
const suite = RUN ? describe : describe.skip;

const BIN = path.resolve(__dirname, "../../dist/index.js");

// Every subcommand registered in the HANDLERS map in mcp/src/index.ts.
// If you add a new command there, add it here too.
const REGISTERED_COMMANDS = [
  "brief",
  "wizard",
  "help",
  "stats",
  "tree",
  "status",
  "refresh",
  "upgrade",
  "whoami",
  "capture",
  "reset",
  "uninstall",
];

function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching control chars
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Spawn the CLI with the given args and return its first second of output.
 * Stdin is closed immediately so interactive prompts exit fast rather than
 * hang waiting for input.
 */
function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = child_process.spawn("node", [BIN, ...args], {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    // Close stdin immediately so @clack/prompts sees EOF and exits.
    proc.stdin.end();

    // Hard timeout — we only need the first moment of output.
    const timer = setTimeout(() => proc.kill("SIGTERM"), 3000);

    proc.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) });
    });
  });
}

suite("CLI dispatcher", () => {
  describe("registered subcommands dispatch", () => {
    for (const cmd of REGISTERED_COMMANDS) {
      it(`\`${cmd}\` is not rejected as Unknown command`, async () => {
        const { stdout, stderr } = await runCli([cmd]);
        const all = stdout + stderr;
        expect(all).not.toMatch(/Unknown command:/);
        expect(all).not.toMatch(/Unknown option:/);
      });
    }
  });

  describe("unknown commands are rejected", () => {
    it("prints Unknown command for an unregistered name", async () => {
      const { stderr } = await runCli(["notarealcommand"]);
      expect(stderr).toMatch(/Unknown command: notarealcommand/);
    });

    it("prints Unknown option for an unrecognised flag", async () => {
      const { stderr } = await runCli(["--notarealflag"]);
      expect(stderr).toMatch(/Unknown option: --notarealflag/);
    });
  });

  describe("help and version flags", () => {
    it("--help prints the help banner", async () => {
      const { stdout } = await runCli(["--help"]);
      expect(stdout).toMatch(/synapsesync/);
      expect(stdout).toMatch(/Setup/);
    });

    it("--version prints the package version", async () => {
      const { stdout } = await runCli(["--version"]);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("-v is an alias for --version", async () => {
      const { stdout } = await runCli(["-v"]);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
