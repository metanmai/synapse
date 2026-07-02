---
slug: proxy-layer-3a-tls-manager
quick_id: 260530-l3a
date: 2026-05-30
status: in-progress
---

# Proxy daemon — Layer 3a: TLS Manager (CA + leaf signing)

## Goal

The TLS-MITM mechanism for the proxy daemon. Layer 3a is just the CERT INFRASTRUCTURE: generate a local CA, generate per-host leaf certs signed by it, with the SAN required for the client's TLS validation to succeed. Layer 3b will use these to terminate TLS in the proxy's CONNECT handler.

## Files

```
mcp/src/capture/proxy/
└── tls.ts                                ← NEW: TlsManager class

mcp/test/capture/proxy/
└── tls.test.ts                           ← NEW: ~10 cases for cert gen + cache + validation
```

## Design

**No new npm deps.** Uses `openssl` via `child_process.execFileSync` (universally available on macOS/Linux). Trade: ~100ms per cert generation cost on first call; cached after that. For typical usage (a few hostnames per session), this is fine.

**No shell interpolation.** Use `execFileSync(cmd, [arg1, arg2, ...])` so hostname / path strings never hit a shell. Defense against command injection if the proxy is ever pointed at an attacker-controlled hostname.

**File layout:**
```
~/.synapse/proxy/                    (mode 0700)
├── ca.key                           (mode 0600 — never leaves this machine)
├── ca.pem                           (the cert the client must trust)
└── leaves/
    ├── api.anthropic.com.key
    ├── api.anthropic.com.pem
    ├── api.openai.com.key
    └── ...
```

CA is valid 10 years (long-lived, generated once). Leaf certs are valid 1 year (rotated lazily on cache miss).

## Bug class under test

> The TLS manager produces certs that don't validate (wrong SAN, invalid signature, expired) OR leaks state across hostnames (cache hit for wrong hostname returns wrong cert) OR creates files outside the configured cert directory (path traversal via attacker-controlled hostname).

Tests target:
- CA generation on first call (file created on disk)
- CA persistence (second call loads, doesn't regen)
- CA cert Common Name matches config
- Leaf cert subject = hostname; SAN = `DNS:hostname`
- Leaf cert chain validates against the CA (`.checkIssued()` + `.verify()`)
- Leaf cert cached in memory (same instance returned on repeat call)
- Different hostnames produce different leafs (no cache poisoning)
- Hostname sanitization (path traversal attempt doesn't escape caDir)

## Out of scope (deferred to Layer 3b)

- HTTP CONNECT handler in server.ts
- TLS termination using these leaves on a real socket
- Forwarding HTTPS requests inside a tunnel
- Integration tests with real HTTPS through proxy

## Definition of done

- `npm run typecheck` passes
- `npm run test` shows +tests passing
- `npx biome check` clean
- Atomic commit + push
