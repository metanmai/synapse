---
slug: proxy-layer-9-enable-disable
quick_id: 260530-l9
date: 2026-05-30
status: in-progress
---

# Proxy daemon — Layer 9: enable/disable (config-file driven)

## Goal

Eliminate the last manual onboarding step. Before this slice, the user had to manually `export SYNAPSE_PROXY_ENABLE=1` in their shell rc + restart the daemon. After: `synapsesync capture proxy enable` does it all — writes a persistent config + restarts the daemon. Symmetric `disable` for off-boarding.

## Files

```
mcp/src/capture/proxy/
└── proxy-config.ts                       ← NEW: read/write/delete + effectiveProxyEnabled

mcp/test/capture/proxy/
└── proxy-config.test.ts                  ← NEW: ~8 tests covering env-vs-config resolution

mcp/src/capture/
├── capture-worker.ts                     ← UPDATE: use effectiveProxyEnabled(process.env)
└── cli.ts                                ← UPDATE: + `proxy enable` / `proxy disable` subcommands
                                                    + update `install` output to reference enable
```

## Design

**Config file at `~/.synapse/proxy-config.json`** with shape `{ enabled: boolean, enabledAt?: string }`. Created/deleted by the CLI; read by the daemon at startup.

**Resolution order (env wins over config) — matches kubectl / git convention.**
```
env SYNAPSE_PROXY_ENABLE="1"  → proxy ON  (operator override)
env SYNAPSE_PROXY_ENABLE="0"  → proxy OFF (operator override)
env unset, config.enabled=true   → proxy ON  (persistent state from `proxy enable`)
env unset, config.enabled=false  → proxy OFF
env unset, no config file        → proxy OFF (default)
```

**Restart helper inline in cli.ts.** SIGTERM the existing daemon, poll `kill -0 pid` until exit or 5s timeout (escalate to SIGKILL if hung), then re-spawn via the same code path as `capture start`. Returns the old + new PIDs for logging.

**Update `install` output.** Today the install command prints `export SYNAPSE_PROXY_ENABLE=1` as the "now enable the daemon" step. Replace with `synapsesync capture proxy enable` — one command, no env-var fiddling, automatic restart.

## Bug class under test

> The Layer 9 wiring: (a) writes config but the daemon doesn't read it (path drift), (b) env and config disagree and we resolve incorrectly, (c) restart leaves two daemons running on port 7727, (d) disable removes the file but the daemon still has proxy active because it wasn't restarted, OR (e) read on missing config crashes instead of returning the documented default.

Tests:
- read returns `{ enabled: false }` when file is absent (default behavior)
- write then read round-trips correctly
- delete then read returns `{ enabled: false }` (idempotent removal)
- `effectiveProxyEnabled({ SYNAPSE_PROXY_ENABLE: "1" })` → true regardless of config
- `effectiveProxyEnabled({ SYNAPSE_PROXY_ENABLE: "0" })` → false regardless of config
- `effectiveProxyEnabled({})` with config `{ enabled: true }` → true
- `effectiveProxyEnabled({})` with config `{ enabled: false }` → false
- `effectiveProxyEnabled({})` with no config file → false

## Out of scope

- Port customization via `proxy enable --port N` (env-var override still works)
- Auto-rotation of CA on expiry
- Cross-platform daemon launchers (currently macOS via `spawn(detached)`)
- Auto-enabling at `proxy install` time (intentionally kept as separate concerns)

## Definition of done

- Typecheck + lint clean
- 608 + 8 = 616 mcp tests passing
- `synapsesync capture proxy enable` smoke test starts a daemon with proxy active
- `synapsesync capture proxy disable` smoke test restarts daemon with proxy off
- Atomic commit + push
- Insight saved
