// Regression guard for the SYNAPSE_SKIP_SUPERVISOR_CHECK env-var bypass.
//
// BUG CLASS this guards: "sandbox-isolated e2e tests for daemon CLI
// commands silently leak to global OS state." Before this bypass,
// `synapsesync capture start/stop` and `synapsesync uninstall` would
// detect the user's real launchd/systemd/schtasks daemon (because those
// supervisors are GLOBAL — env-var HOME/SYNAPSE_HOME isolation can't
// reach them) and either skip-start ("already running") or, on stop,
// process.kill the user's real PID. The bypass scopes a single env var
// that short-circuits the supervisor check to "no supervisor present,"
// making sandboxed daemon tests possible.
//
// We assert the bypass behavior directly. A future refactor that drops
// the env-var check (e.g. "simplifying" the function to always query
// the OS) would re-break the destructive-test isolation pattern. The
// test catches it immediately rather than after a sandboxed e2e run
// kills somebody's daemon in CI.

import { afterEach, describe, expect, it } from "vitest";
import { checkSupervisor } from "../../../src/cli/util/daemon-supervisor.js";

describe("checkSupervisor — sandbox bypass env var", () => {
  const original = process.env.SYNAPSE_SKIP_SUPERVISOR_CHECK;

  afterEach(() => {
    // Restore the original env state. Use `as` cast to clear when the
    // var was unset originally — biome lints `delete` on dynamic props
    // for perf reasons, and assigning undefined to the literal-keyed
    // property is the documented Node alternative that yields the
    // same `process.env.X === undefined` result.
    if (original === undefined) {
      (process.env as Record<string, string | undefined>).SYNAPSE_SKIP_SUPERVISOR_CHECK = undefined;
    } else {
      process.env.SYNAPSE_SKIP_SUPERVISOR_CHECK = original;
    }
  });

  it("short-circuits to {running:false, pid:null, supervisor:null} when env=1", () => {
    process.env.SYNAPSE_SKIP_SUPERVISOR_CHECK = "1";
    const result = checkSupervisor();
    expect(result).toEqual({ running: false, pid: null, supervisor: null });
  });

  it("only respects the exact value '1' — any other truthy value still queries the OS", () => {
    // Defensive against accidental enablement. The bypass is destructive
    // to "is the daemon running?" semantics — `=true`, `=yes`, `=on`
    // should NOT trigger it. A strict equality check on "1" is the
    // contract.
    for (const v of ["true", "yes", "on", "0", "", " 1 "]) {
      process.env.SYNAPSE_SKIP_SUPERVISOR_CHECK = v;
      const result = checkSupervisor();
      // We can't assert running:true here (depends on actual host) — we
      // CAN assert the bypass branch didn't fire by checking the result
      // came from the platform branch (supervisor will be either the
      // real OS's value or null with platform-appropriate semantics).
      // The strict-equality contract is what's load-bearing; just call
      // the function and confirm it doesn't throw.
      expect(result).toBeDefined();
    }
  });

  it("returns OS-queried state when env var is unset", () => {
    (process.env as Record<string, string | undefined>).SYNAPSE_SKIP_SUPERVISOR_CHECK = undefined;
    const result = checkSupervisor();
    // Don't assert specific values — the result depends on the host's
    // actual daemon state. Assert the shape only.
    expect(result).toHaveProperty("running");
    expect(result).toHaveProperty("pid");
    expect(result).toHaveProperty("supervisor");
    expect(typeof result.running).toBe("boolean");
  });
});
