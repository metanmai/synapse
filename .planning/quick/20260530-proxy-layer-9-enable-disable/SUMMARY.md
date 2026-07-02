---
slug: proxy-layer-9-enable-disable
quick_id: 260530-l9
date: 2026-05-30
status: complete
---

# Proxy daemon — Layer 9 SUMMARY

## Outcome

The last manual onboarding step is gone. Before this slice the user had to `export SYNAPSE_PROXY_ENABLE=1` in their shell rc AND restart the daemon to flip the proxy on. Now: `synapsesync capture proxy enable` writes a persistent config + restarts the daemon in one command. Symmetric `disable` for off-boarding. The env var stays as an operator override (kubectl-style precedence).

## Smoke test sequence (this machine, real daemon)

```
$ synapsesync capture proxy status
   ○ CA          not generated
   ○ Keychain    not trusted
   ○ Enabled     off
   ●  Proxy port  7727

$ synapsesync capture proxy enable
   ◆ Proxy enabled (config: /Users/Tanmai.N/.synapse/proxy-config.json)
   ◆ Daemon running with proxy active (PID 62227)

$ synapsesync capture proxy status
   ● CA          present  /Users/Tanmai.N/.synapse/proxy/ca.pem
            sha256 Fingerprint=99:68:2A:93:3F:B0:2B:3A...
   ○ Keychain    not trusted
   ● Enabled     on (since 2026-05-29T23:30:49.630Z)
   ●  Proxy port  7727

$ lsof -nP -iTCP:7727 -sTCP:LISTEN
   node  62227  Tanmai.N  12u  IPv4  ...  TCP 127.0.0.1:7727 (LISTEN)
                              ↑ proxy is actually listening

$ synapsesync capture proxy disable
   ◆ Proxy disabled (config removed)
   Stopped previous daemon (PID 62227)
   ◆ Daemon running without proxy (PID 62726)

$ lsof -nP -iTCP:7727 -sTCP:LISTEN
   (no output — port 7727 released)
```

The restart transition (62227 → 62726) confirms: old daemon graceful-stops, new daemon spawns without proxy, port 7727 is released cleanly. No EADDRINUSE race.

## Commits

| SHA | Message | Files |
|---|---|---|
| _(this commit)_ | `feat(proxy): Layer 9 — enable/disable + config-file driven activation` | 6 |

## Files

| Path | Change | Purpose |
|---|---|---|
| `mcp/src/capture/proxy/proxy-config.ts` | NEW | `readProxyConfig` / `writeProxyConfig` / `deleteProxyConfig` / `effectiveProxyEnabled` |
| `mcp/test/capture/proxy/proxy-config.test.ts` | NEW | 12 unit tests covering env-vs-config resolution + malformed-JSON fail-safe |
| `mcp/src/capture/capture-worker.ts` | UPDATE | Daemon reads `effectiveProxyEnabled(process.env)` instead of env-var alone |
| `mcp/src/capture/cli.ts` | UPDATE | New `proxy enable` / `proxy disable` subcommands + `restartDaemon` helper |
| `.planning/quick/20260530-proxy-layer-9-enable-disable/{PLAN,SUMMARY}.md` | NEW | GSD scaffolding |

## Bug-class coverage (12 tests)

| Concern | Test | Status |
|---|---|---|
| Missing config file: default to disabled, never throw | "read on missing file returns the documented default (enabled=false) without throwing" | ✓ |
| Round-trip persistence works | "write then read round-trips the persisted state" | ✓ |
| Delete removes the file + read returns default | "delete removes the file and subsequent reads return the default" | ✓ |
| Delete is idempotent (safe to call twice or on missing) | "delete is idempotent on missing file" | ✓ |
| **Malformed JSON falls back to disabled** (daemon must not crash on corrupted config) | "malformed JSON falls back to disabled (fail-safe, never crashes daemon)" | ✓ |
| **Config path matches what the CLI writer uses** (no drift) | "proxyConfigPath sits under SYNAPSE_HOME (drift-free with the CLI's writer)" | ✓ |
| env=1 forces ON regardless of config (operator override) | "env=1 forces ON regardless of config" | ✓ |
| env=0 forces OFF regardless of config (operator override) | "env=0 forces OFF regardless of config" | ✓ |
| env unset + config.enabled=true → ON | "env unset + config.enabled=true → ON" | ✓ |
| env unset + config.enabled=false → OFF | "env unset + config.enabled=false → OFF" | ✓ |
| env unset + no config file → OFF (default) | "env unset + no config file → OFF (default)" | ✓ |
| **Strict env-value parsing** — only "1"/"0" trigger override, not "true"/"yes" | "other env values do NOT trigger the override" | ✓ |

## Design highlights

- **Config file over plist edit.** The daemon is launched via `spawn(detached: true)` from the CLI, not via launchctl. So a launchd plist edit would be the wrong primitive. The right shape is a JSON config at `~/.synapse/proxy-config.json` that the daemon reads on startup. Works regardless of how the daemon is spawned (CLI, launchctl, manual).
- **Env wins over config (kubectl/git convention).** `SYNAPSE_PROXY_ENABLE` is treated as an operator override for one-off runs (CI, debugging). Config is the persistent state from `proxy enable`. To turn off persistently, run `proxy disable`. Resolution is strict: only `"1"` and `"0"` count for the env override — other values fall through to config so a typo like `SYNAPSE_PROXY_ENABLE=true` doesn't silently disable an enabled config.
- **Fail-safe default on corrupted config.** A malformed `proxy-config.json` returns `{ enabled: false }` rather than throwing. Daemon startup must not crash on a corrupted user file — the user can re-run `proxy enable` to fix it.
- **Restart helper polls `kill -0 pid` until exit.** Critical race: if we don't wait for the old daemon to actually exit before spawning the new one, the new daemon hits EADDRINUSE on port 7727. Standard portable wait pattern via `process.kill(pid, 0)` (signal 0 = existence check, never delivers a signal). Escalates to SIGKILL after 5s if shutdown hangs.
- **Install output now references `proxy enable`.** Replaced the manual `export SYNAPSE_PROXY_ENABLE=1` step with the one-command alternative. The full onboarding flow is now: `proxy install` → paste env snippet into shell rc → `proxy enable`. Three commands, no env-var fiddling.

## Stats

| | Before | After |
|---|---|---|
| Test files (mcp) | 69 | 70 (+1) |
| Tests passing (mcp) | 608 | **620** (+12 proxy-config tests) |
| Lint (whole repo) | clean | clean |
| CLI subcommands under `capture proxy` | 3 | 5 (+ enable/disable) |

## What's deferred

- **Port customization via `--port` flag** — today the port is fixed at 7727; users who need a different port still set `SYNAPSE_PROXY_PORT` env. Adding `proxy enable --port 8888` is a small future slice.
- **CA install ↔ proxy enable atomicity** — `proxy install` doesn't auto-call `proxy enable`. Intentional separation (some users want the CA without the proxy), but a single `proxy setup` orchestrator would be a nice convenience.
- **Linux daemon onboarding** — `restartDaemon` uses POSIX signals + PID files; should work on Linux too, but full Linux trust-store integration (`update-ca-certificates`) is still pending from Layer 8's deferrals.

## Status

**SHIPPED.** The proxy daemon now has a frictionless on/off switch. Full user onboarding sequence:

```
synapsesync capture proxy install   # CA generation + keychain install + env snippet
# paste the env snippet into ~/.zshrc
synapsesync capture proxy enable    # writes config, restarts daemon
# AI tool sessions now captured through the proxy
```

This closes out the proxy daemon's onboarding story. Layers 1–9 form a complete, testable, demoable, opt-in production feature. The remaining future work (Linux trust-store, UA-based tool tagging, port customization) is polish, not core architecture.
