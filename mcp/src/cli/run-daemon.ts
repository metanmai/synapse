/**
 * `synapsesync daemon` subcommand entry point.
 *
 * The OS service unit installed by `synapsesync init` (launchd plist on macOS,
 * systemd unit on Linux) invokes `<bin> daemon`. This function discovers
 * tracked projects from `~/.synapse/projects/`, reads the API key from
 * `~/.synapse/config.json`, and hands off to `startHandoffLoop` which owns
 * the per-project flush/pull cycle and the healthcheck heartbeat.
 *
 * `_testStartLoop` and `_exitImmediately` are escape hatches for unit tests
 * so they can assert on the discovery output without spinning real intervals
 * or installing signal handlers in the test process.
 */

import fs from "node:fs";
import path from "node:path";
import { type HandoffLoopArgs, startHandoffLoop } from "../capture/daemon.js";
import { synapseRoot } from "../capture/handoff-paths.js";
import { readUserIdFromConfig } from "../capture/identity.js";

const API_URL = "https://api.synapsesync.app";

export interface RunDaemonOpts {
  _testStartLoop?: (a: HandoffLoopArgs) => () => void;
  _exitImmediately?: boolean;
}

export function runDaemon(opts: RunDaemonOpts = {}): () => void {
  const startFn = opts._testStartLoop ?? startHandoffLoop;
  const root = synapseRoot();
  const configPath = path.join(root, "config.json");
  const config = fs.existsSync(configPath)
    ? (JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
        api_key?: string;
      })
    : {};
  const apiKey = config.api_key ?? process.env.SYNAPSE_API_KEY;
  if (!apiKey) {
    console.error("[synapsesync daemon] no API key configured. Run `synapsesync init` first.");
    return () => {};
  }

  const projectsDir = path.join(root, "projects");
  const projects = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
  if (projects.length === 0) {
    console.log("[synapsesync daemon] no projects tracked yet — waiting for hook activity to populate.");
  }

  const stop = startFn({
    projects,
    projects_dir: projectsDir,
    api_key: apiKey,
    api_url: API_URL,
    user_id: readUserIdFromConfig(),
  });

  if (!opts._exitImmediately) {
    process.on("SIGTERM", () => {
      stop();
      process.exit(0);
    });
    process.on("SIGINT", () => {
      stop();
      process.exit(0);
    });
  }
  return stop;
}
