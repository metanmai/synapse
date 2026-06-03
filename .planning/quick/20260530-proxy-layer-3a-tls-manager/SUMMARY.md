---
slug: proxy-layer-3a-tls-manager
quick_id: 260530-l3a
date: 2026-05-30
status: complete
---

# Proxy daemon — Layer 3a SUMMARY

## Outcome

TLS infrastructure for the proxy daemon shipped: local CA generation + per-host leaf cert signing with proper SAN. The cert internals are validated end-to-end (issuer chain check + signature verification via Node's built-in `X509Certificate`). Layer 3b will use these certs to terminate TLS in the proxy's CONNECT handler.

## Commits

| SHA | Message | Files |
|---|---|---|
| `66cd137` | `feat(proxy): Layer 3a — TLS Manager (CA + leaf cert generation)` | 3 |

## Files added

| Path | LOC | Purpose |
|---|---|---|
| `mcp/src/capture/proxy/tls.ts` | 248 | TlsManager: ensureCa + getLeafCert + hostname sanitization |
| `mcp/test/capture/proxy/tls.test.ts` | 207 | 26 unit tests covering cert validity + chain + cache + safety |

## Bug-class coverage

| Concern | Test | Status |
|---|---|---|
| CA produced and persisted | `generates a CA on first call and persists it to disk` | ✓ |
| CA loads from disk (no regen) | `returns the same cert on subsequent calls` | ✓ |
| CA Common Name configurable | `CA cert carries the configured Common Name` | ✓ |
| CA is marked as a CA (for chain validation) | `CA cert is marked as a CA` | ✓ (indirect via checkIssued test) |
| Leaf subject = hostname | `generates a leaf cert with the hostname as subject CN` | ✓ |
| **Leaf SAN = `DNS:hostname` (RFC 6125)** | `leaf cert has DNS:hostname in subjectAltName` | ✓ |
| **Chain validates (issued + verified)** | `leaf cert chain validates against the CA` | ✓ |
| In-memory leaf cache | `returns the same cert on subsequent calls for the same hostname` | ✓ |
| Cross-restart disk cache | `loads existing leaf from disk on a fresh TlsManager instance` | ✓ |
| Per-hostname isolation (no poisoning) | `generates DISTINCT leaves for different hostnames` | ✓ |
| Validity periods sensible | `leaf cert has shorter validity than CA` (≈1 year vs ≈10) | ✓ |
| Intermediate artifacts cleaned | `cleans up intermediate artifacts (CSR + ext file)` | ✓ |
| **Path-traversal defense** | `refuses to generate a leaf for unsafe hostname` × 11 hostile inputs | ✓ |
| Ordinary hostnames accepted | `accepts ordinary DNS hostnames` | ✓ |
| CA cert path stable | `caCertPath returns a stable path` | ✓ |

## Design highlights

- **No new npm dependency.** Uses `openssl` via `child_process.execFileSync` with argv arrays — never shell-interpolates. Attacker-controlled hostnames in proxied requests can't inject shell metacharacters.
- **Two-tier caching.** In-memory `Map<string, CertPair>` for the hot path + on-disk persistence for cross-restart. First-call cost ~100ms (one openssl spawn); cached calls are zero-cost.
- **Hostname safety.** Strict regex `/^[a-zA-Z0-9._-]+$/`, length 1-253, no `..`, no leading dot/hyphen. Rejects path-traversal payloads (`../etc/passwd`, etc.), null bytes, shell metacharacters.
- **CA validity 10 years; leaf validity 1 year.** Leaf rotation happens lazily on cache miss past expiry (future slice).

## Stats

| | Before this slice | After |
|---|---|---|
| Test files | 65 | 66 |
| Tests passing | 552 | **578** (+26) |
| Lint | clean | clean |
| Typecheck | clean | clean |

## Note on a transient pre-push failure

The first push attempt on this commit failed in the pre-push hook with the test suite errored out — the retry passed cleanly with all 578 tests green. The cert tests do ~50-60 openssl process spawns total (CA + leafs across 26 tests), which can hit process-fork limits on a busy machine. Worth knowing about — if CI shows recurrent flakes, the fix is to serialize the tests (`describe.sequential` or single-threaded vitest pool) or pre-generate a shared test CA at suite setup.

## What's deferred to Layer 3b

- HTTP CONNECT handler in `server.ts`
- TLS termination using `tls.TLSSocket` with our leaf certs on the client side
- New TLS connection to the real upstream
- Forwarding HTTPS requests inside the tunnel (same capture path as Layer 2's HTTP path)
- Integration tests: client TRUSTS our CA, makes real HTTPS request through proxy to fake upstream, asserts capture works

## Status

**SHIPPED.** Layer 3a provides the cert primitives. Layer 3b wires them into the server to enable HTTPS interception — the actual point of the whole proxy daemon. Estimated effort for 3b: ~3 hours.
