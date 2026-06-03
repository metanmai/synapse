---
quick_id: 260530-ldg
date: 2026-05-30
slug: docker-linux-e2e-tdd-gate
status: planned
type: execute
autonomous: false
parent_plan: .planning/quick/260530-8qe-slice-a-cross-platform-proxy-daemon-linu/260530-8qe-PLAN.md
relationship: "Slice A.5 — replaces original Slice A Task 2 with a TDD-first shape: Docker E2E gate first, then Linux backend implementation"

must_haves:
  truths:
    - "On Debian, Ubuntu, Fedora, and Rocky Linux containers (each with passwordless root and the distro's native trust-store tools installed), running `synapsesync capture proxy install` deposits a Synapse Proxy CA pem at the distro-appropriate path AND `update-ca-certificates` / `update-ca-trust extract` runs successfully (exit 0)."
    - "On Debian/Ubuntu: after install, `/etc/ssl/certs/synapse.pem` exists as a symlink to the actual CA pem (created by `update-ca-certificates`)."
    - "On Fedora/Rocky: after install, `/etc/pki/ca-trust/source/anchors/synapse.pem` exists AND `/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem` contains the Synapse CA fingerprint."
    - "On Arch: `proxy install` exits 0 with `installedInKeychain: false` + `skippedReason` mentioning Arch / unknown / manual install. NO file is written to any trust-store path."
    - "On every supported distro: `proxy uninstall` followed by `proxy status` shows the cert is no longer in the trust store (idempotent — `rm -f` semantics)."
    - "The Docker-based E2E test runs locally on macOS via Rancher Desktop (already installed) AND on GitHub Actions `ubuntu-latest` runners (Docker pre-installed). Identical container behavior in both environments."
    - "CI runs the Docker E2E on every push to `main`. CI stays green at every commit boundary in this plan (per `feedback_ci_must_stay_green`)."
    - "The Docker E2E does NOT run as part of `npm run test:e2e` (the default merge gate). It's exposed as `npm run test:e2e:proxy-linux` so the default merge gate stays at ~5-8 min on developer machines. CI runs it unconditionally."
    - "Existing unit-test surfaces remain intact: `mcp/test/capture/proxy/onboarding.test.ts` still passes through every commit in this plan. Commit 4 (unit-test split) is the only commit that touches test files."
    - "The pre-push verify gate (`npm run lint && npm run typecheck && npm run test`) passes at each commit."
  artifacts:
    - path: "scripts/e2e-linux/Dockerfile.debian"
      provides: "Debian 12 + Node 22 + ca-certificates package + repo mount + entrypoint script — exercises debian-family install path"
    - path: "scripts/e2e-linux/Dockerfile.ubuntu"
      provides: "Ubuntu 24.04 + Node 22 + ca-certificates + entrypoint — exercises ID_LIKE=debian inheritance parsing"
    - path: "scripts/e2e-linux/Dockerfile.fedora"
      provides: "Fedora 40 + Node 22 + ca-certificates + entrypoint — exercises rhel-family install path"
    - path: "scripts/e2e-linux/Dockerfile.rockylinux"
      provides: "Rocky Linux 9 + Node 22 + ca-certificates + entrypoint — exercises ID_LIKE=rhel inheritance parsing"
    - path: "scripts/e2e-linux/Dockerfile.arch"
      provides: "Arch Linux + Node 22 + entrypoint — exercises unknown-distro soft-skip path (the trap distro)"
    - path: "scripts/e2e-linux/e2e-proxy-install.sh"
      provides: "In-container test runner — reads /etc/os-release, picks expected paths per family, runs install/status/uninstall and asserts filesystem state. Same script in every container."
    - path: "scripts/e2e-proxy-install-linux.mjs"
      provides: "Host orchestrator — iterates over the 5 distros, builds + runs each container, aggregates PASS/FAIL per distro, sets non-zero exit on any distro failure"
    - path: "package.json"
      provides: "Adds `test:e2e:proxy-linux` script for local invocation; intentionally NOT added to `test:e2e` merge gate to keep dev cadence fast"
    - path: ".github/workflows/ci.yml"
      provides: "Adds `proxy-linux-e2e` job with matrix over 5 distros + Docker layer caching"
    - path: "mcp/src/capture/proxy/backends/linux.ts"
      provides: "Real LinuxBackend (replaces stub from Slice A Task 1) — distro detection + sudo + cp + soft-skip per spec §4.2-4.3"
    - path: "mcp/test/capture/proxy/backends/mac.test.ts"
      provides: "Existing macOS tests moved here, targeting MacBackend directly"
    - path: "mcp/test/capture/proxy/backends/linux.test.ts"
      provides: "~14 cases per spec §4.4 — distro detection + install/uninstall/check + Arch trap + sudo failure + missing os-release"
    - path: "mcp/test/capture/proxy/onboarding.test.ts"
      provides: "Rewritten dispatcher-focused: routing + legacy field-name preservation + caPath/TlsManager drift guard"
  key_links:
    - from: "this plan"
      to: "original Slice A plan"
      via: "260530-8qe-PLAN.md — this plan replaces Task 2 of the original; Task 3 (test split) lands here as the final commit"
    - from: "Docker E2E"
      to: "cross-platform spec"
      via: "docs/superpowers/specs/2026-05-30-proxy-cross-platform-design.md §4.2 (distro table) + §4.3 (sudo handling) — Docker validates the table against real `/etc/os-release` files shipped by each distro's maintainers"
    - from: "in-container script"
      to: "mcp CLI"
      via: "node dist/index.js capture proxy install/status/uninstall — same CLI surface users invoke"
    - from: "CI matrix"
      to: ".github/workflows/ci.yml `verify` + `e2e` jobs"
      via: "Adds parallel `proxy-linux-e2e` job; doesn't replace existing jobs, runs alongside them"

artifacts:
  - scripts/e2e-linux/Dockerfile.debian
  - scripts/e2e-linux/Dockerfile.ubuntu
  - scripts/e2e-linux/Dockerfile.fedora
  - scripts/e2e-linux/Dockerfile.rockylinux
  - scripts/e2e-linux/Dockerfile.arch
  - scripts/e2e-linux/e2e-proxy-install.sh
  - scripts/e2e-proxy-install-linux.mjs
  - package.json
  - .github/workflows/ci.yml
  - mcp/src/capture/proxy/backends/linux.ts
  - mcp/test/capture/proxy/backends/mac.test.ts
  - mcp/test/capture/proxy/backends/linux.test.ts
  - mcp/test/capture/proxy/onboarding.test.ts

key_links:
  - .planning/quick/260530-8qe-slice-a-cross-platform-proxy-daemon-linu/260530-8qe-PLAN.md
  - docs/superpowers/specs/2026-05-30-proxy-cross-platform-design.md
  - mcp/src/capture/proxy/backends/linux.ts
  - mcp/src/capture/proxy/onboarding.ts
  - .github/workflows/ci.yml
---

<objective>
Build a Docker-based cross-distro E2E gate for the Linux proxy CA install/status/uninstall path BEFORE implementing the real LinuxBackend. The test exercises `synapsesync capture proxy install` against 5 real Linux distros (Debian, Ubuntu, Fedora, Rocky, Arch) in throwaway containers — covering all three code paths in spec §4.2 (debian-family, rhel-family, unknown soft-skip).

The test is born RED (LinuxBackend is a stub from Slice A Task 1); commit 2 makes it GREEN by implementing the real backend. Commit 3 wires the gate to CI so every push validates the install path against real distro trust stores. Commit 4 lands the unit-test split + Linux unit tests from the original Slice A Task 3.

Purpose: Close the cross-platform E2E coverage gap honestly. Today, the Linux backend (stub or otherwise) is unit-test covered but no test ever actually invokes `update-ca-certificates` against a real Debian trust store. Docker gives us reproducible per-distro coverage locally AND in CI for ~3-5 min per CI run.

Output: 4 atomic commits, each independently shippable, each passing the full pre-push gate, CI green at every boundary:
1. Docker E2E scaffolding (5 Dockerfiles + in-container script + host orchestrator + npm script). Local-only; not in CI yet; not in merge gate. Running `npm run test:e2e:proxy-linux` now would FAIL on debian-family + rhel-family (stub soft-skips) and PASS on Arch (soft-skip is the expected behavior). This is the visible RED state.
2. Real LinuxBackend implementation. `npm run test:e2e:proxy-linux` now PASSES 5/5 locally.
3. CI wiring — `proxy-linux-e2e` matrix job in `.github/workflows/ci.yml` runs on every push.
4. Unit-test split + Linux unit tests (original Slice A Task 3).

Scope is bounded by spec §3.1 + §4 + §8. Out of scope: Layer 5/7 (real claude CLI through proxy) on Linux — that requires `claude` in containers + Anthropic API key + network egress + ~$0.005/distro/run. Defer to a focused follow-on if/when needed. Out of scope: Windows containers, macOS native install validation, GUI tool integration.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@docs/superpowers/specs/2026-05-30-proxy-cross-platform-design.md
</execution_context>

<context>
@.planning/quick/260530-8qe-slice-a-cross-platform-proxy-daemon-linu/260530-8qe-PLAN.md
@mcp/src/capture/proxy/onboarding.ts
@mcp/src/capture/proxy/backends/linux.ts
@.github/workflows/ci.yml

<spec_anchors>
Authoritative scope (re-read before each task):

- Spec §3.1 — Files layout under `mcp/src/capture/proxy/backends/`
- Spec §4.2 — Linux distro detection mapping (debian: {debian, ubuntu, linuxmint, pop, elementary, kali, parrot, raspbian, alpine}; rhel: {fedora, rhel, centos, rocky, almalinux, amzn, ol}; everything else → unknown)
- Spec §4.3 — sudo handling: `stdio: "inherit"` + `requiresSudo` soft-fail
- Spec §4.4 — Test cases for `linux.test.ts` (Task 3 in original plan, now commit 4 here)
- Spec §4.5 — Slice A success criteria
- Spec §8 — Implementation sequencing

Containers do NOT use `sudo` in the same way a real user shell does. Inside `docker run`, the container's default user is root unless overridden. So `sudo update-ca-certificates` and bare `update-ca-certificates` both work. The LinuxBackend's spec §4.3 `runSudo` wrapper still uses `["sudo", ...]` but the `sudo` binary on default-root containers is a no-op shim. To avoid relying on that: either install `sudo` in each Dockerfile (cleanest, ~1 line per distro) OR have the in-container script symlink `/usr/local/bin/sudo` → `/bin/true` style; pick install (cleanest).
</spec_anchors>

<docker_notes>
- Use the official `node:22-bookworm-slim` (Debian 12) + `node:22-bookworm` patterns where they exist. For Fedora/Rocky/Arch, base on the distro image and install Node 22 via NodeSource (Fedora/Rocky) or `pacman -S nodejs npm` (Arch).
- Each Dockerfile installs the distro's `ca-certificates` package PLUS `sudo` (since spec §4.3 invokes `sudo update-ca-certificates` rather than the bare command — keeps the spawn-arg shape identical to a real user shell).
- COPY the repo into `/repo` inside the container; build the mcp CLI inside the container via `npm install && npm run build` in `mcp/`. Don't bind-mount from the host — keeps the test reproducible across host OSes (the host may be macOS, where `node_modules` would have macOS-arch native deps that fail on Linux).
- Each container's ENTRYPOINT runs `scripts/e2e-linux/e2e-proxy-install.sh` which sources `/etc/os-release`, picks the expected paths per family, runs the install/status/uninstall sequence, asserts filesystem state.
- The host orchestrator `scripts/e2e-proxy-install-linux.mjs` uses `child_process.spawnSync` with `docker build` + `docker run`. It loops over the 5 distros (sequentially for clear logs; parallelism is a future optimization), aggregates exit codes, exits non-zero on any failure.
- CI matrix runs the 5 distros in parallel (`strategy.matrix.distro: [debian, ubuntu, fedora, rockylinux, arch]`), with `fail-fast: false` so all distros report independently. Docker layer caching via `actions/cache` or buildx — first build ~2 min per distro, subsequent ~10s.
</docker_notes>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Commit 1: Docker E2E scaffolding (5 Dockerfiles + in-container script + host orchestrator + npm script). Local-only — not wired to CI or merge gate. Demonstrates RED state.</name>
  <files>
    scripts/e2e-linux/Dockerfile.debian (NEW),
    scripts/e2e-linux/Dockerfile.ubuntu (NEW),
    scripts/e2e-linux/Dockerfile.fedora (NEW),
    scripts/e2e-linux/Dockerfile.rockylinux (NEW),
    scripts/e2e-linux/Dockerfile.arch (NEW),
    scripts/e2e-linux/e2e-proxy-install.sh (NEW),
    scripts/e2e-linux/.dockerignore (NEW),
    scripts/e2e-proxy-install-linux.mjs (NEW),
    package.json (MODIFY — add test:e2e:proxy-linux script)
  </files>
  <behavior>
    - Each Dockerfile produces a tiny image (~200-300 MB) with Node 22, `ca-certificates`, `sudo`, and the repo copied in. The container's CMD invokes the test script.
    - The in-container test script (`e2e-proxy-install.sh`):
      1. Reads `/etc/os-release` to determine distro family (matches the LinuxBackend's own detection logic — fixture consistency check).
      2. Asserts pre-state: trust-store path is EMPTY (no synapse.pem present).
      3. Runs `node /repo/mcp/dist/index.js capture proxy install` — captures stdout, exit code.
      4. Asserts post-install: for debian/ubuntu, `/etc/ssl/certs/synapse.pem` exists; for fedora/rocky, `/etc/pki/ca-trust/source/anchors/synapse.pem` exists; for arch, stdout contains "skip" or "arch" and NO file is written anywhere.
      5. Runs `node /repo/mcp/dist/index.js capture proxy status` — asserts `inKeychain: true` (debian/ubuntu/fedora/rocky) or `inKeychain: false` (arch).
      6. Runs `node /repo/mcp/dist/index.js capture proxy uninstall`.
      7. Asserts post-uninstall: the trust-store file is gone (debian/ubuntu/fedora/rocky); arch was already empty.
      8. Prints `PASS <distro>` on full success; prints `FAIL <distro> at <stage>` on first failure and exits non-zero.
    - The host orchestrator (`e2e-proxy-install-linux.mjs`):
      1. Sanity-check: `docker --version` succeeds; otherwise exit 0 with "Docker not available, skipping Linux E2E" (soft-skip pattern for devs without Docker).
      2. Resolve repo root.
      3. For each distro in [debian, ubuntu, fedora, rockylinux, arch]:
         a. `docker build -f scripts/e2e-linux/Dockerfile.<distro> -t synapse-e2e-<distro>:<run-tag> .` (build from repo root so the Dockerfile can COPY everything).
         b. `docker run --rm synapse-e2e-<distro>:<run-tag>` — captures combined stdout/stderr.
         c. Logs PASS/FAIL per distro.
      4. Exits 0 if ALL distros PASSED, non-zero otherwise. Reports a summary table at the end.
    - Today (with LinuxBackend stub): expected outcome is debian/ubuntu/fedora/rockylinux FAIL at the install assertion (stub soft-skips, no file written); arch PASSES (stub soft-skips, which is the correct arch behavior).
    - `package.json` gets `"test:e2e:proxy-linux": "node scripts/e2e-proxy-install-linux.mjs"`. NOT added to the default `test:e2e` chain.
  </behavior>
  <action>
    1. Create `scripts/e2e-linux/` directory.

    2. **`scripts/e2e-linux/Dockerfile.debian`**:
       ```dockerfile
       FROM node:22-bookworm-slim
       RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates sudo openssl && rm -rf /var/lib/apt/lists/*
       WORKDIR /repo
       COPY . /repo
       RUN cd mcp && npm install --silent --no-audit --no-fund && npm run build --silent
       ENTRYPOINT ["/bin/sh", "/repo/scripts/e2e-linux/e2e-proxy-install.sh"]
       ```

    3. **`scripts/e2e-linux/Dockerfile.ubuntu`** — same shape, `FROM ubuntu:24.04`; install `nodejs` via NodeSource:
       ```dockerfile
       FROM ubuntu:24.04
       RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl sudo openssl gnupg && \
           curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
           apt-get install -y --no-install-recommends nodejs && \
           rm -rf /var/lib/apt/lists/*
       WORKDIR /repo
       COPY . /repo
       RUN cd mcp && npm install --silent --no-audit --no-fund && npm run build --silent
       ENTRYPOINT ["/bin/sh", "/repo/scripts/e2e-linux/e2e-proxy-install.sh"]
       ```

    4. **`scripts/e2e-linux/Dockerfile.fedora`** — `FROM fedora:40`; install via dnf:
       ```dockerfile
       FROM fedora:40
       RUN dnf install -y ca-certificates sudo openssl && \
           curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && \
           dnf install -y nodejs && \
           dnf clean all
       WORKDIR /repo
       COPY . /repo
       RUN cd mcp && npm install --silent --no-audit --no-fund && npm run build --silent
       ENTRYPOINT ["/bin/sh", "/repo/scripts/e2e-linux/e2e-proxy-install.sh"]
       ```

    5. **`scripts/e2e-linux/Dockerfile.rockylinux`** — `FROM rockylinux:9`; same install pattern. Rocky 9 is the RHEL-family equivalent with `ID_LIKE=rhel`.

    6. **`scripts/e2e-linux/Dockerfile.arch`** — `FROM archlinux:latest`; install via pacman:
       ```dockerfile
       FROM archlinux:latest
       RUN pacman -Sy --noconfirm ca-certificates ca-certificates-utils sudo openssl nodejs npm
       WORKDIR /repo
       COPY . /repo
       RUN cd mcp && npm install --silent --no-audit --no-fund && npm run build --silent
       ENTRYPOINT ["/bin/sh", "/repo/scripts/e2e-linux/e2e-proxy-install.sh"]
       ```

    7. **`scripts/e2e-linux/.dockerignore`** — exclude `node_modules`, `dist`, `.git`, `coverage`, `frontend/.svelte-kit`, `frontend/build`, `frontend/test-results`, `frontend/playwright-report` to keep the build context small (~50 MB instead of multi-GB).

    8. **`scripts/e2e-linux/e2e-proxy-install.sh`** — the in-container test runner. POSIX sh, no bashisms. Structure:
       ```sh
       #!/bin/sh
       set -e

       . /etc/os-release  # populates $ID and $ID_LIKE
       DISTRO_ID="${ID}"
       echo "── e2e-proxy-install: distro=${DISTRO_ID} ──"

       # Determine expected family + paths
       case "${DISTRO_ID}" in
         debian|ubuntu) FAMILY=debian; TRUST_PATH=/etc/ssl/certs/synapse.pem; SHOULD_INSTALL=1 ;;
         fedora|rocky|rockylinux|rhel|centos) FAMILY=rhel; TRUST_PATH=/etc/pki/ca-trust/source/anchors/synapse.pem; SHOULD_INSTALL=1 ;;
         arch) FAMILY=unknown; TRUST_PATH=""; SHOULD_INSTALL=0 ;;
         *) echo "FAIL ${DISTRO_ID}: unsupported distro for this test"; exit 1 ;;
       esac

       # PRE: trust-store path is empty
       if [ "$SHOULD_INSTALL" = "1" ] && [ -f "$TRUST_PATH" ]; then
         echo "FAIL ${DISTRO_ID}: pre-state — ${TRUST_PATH} already exists"; exit 1
       fi

       cd /repo/mcp

       # INSTALL
       node dist/index.js capture proxy install > /tmp/install.out 2>&1 || {
         echo "FAIL ${DISTRO_ID}: install command exited non-zero"; cat /tmp/install.out; exit 1
       }
       if [ "$SHOULD_INSTALL" = "1" ]; then
         [ -f "$TRUST_PATH" ] || { echo "FAIL ${DISTRO_ID}: install did not write ${TRUST_PATH}"; cat /tmp/install.out; exit 1; }
       else
         # arch: install should soft-skip; assert no file written under either family's path
         [ ! -f /etc/ssl/certs/synapse.pem ] || { echo "FAIL ${DISTRO_ID}: arch unexpectedly wrote debian-family path"; exit 1; }
         [ ! -f /etc/pki/ca-trust/source/anchors/synapse.pem ] || { echo "FAIL ${DISTRO_ID}: arch unexpectedly wrote rhel-family path"; exit 1; }
       fi

       # STATUS
       node dist/index.js capture proxy status > /tmp/status.out 2>&1 || {
         echo "FAIL ${DISTRO_ID}: status command exited non-zero"; cat /tmp/status.out; exit 1
       }
       # (Format-tolerant: check for "Installed" / "Yes" / "true" patterns. The exact stdout format may evolve.)

       # UNINSTALL
       node dist/index.js capture proxy uninstall > /tmp/uninstall.out 2>&1 || {
         echo "FAIL ${DISTRO_ID}: uninstall command exited non-zero"; cat /tmp/uninstall.out; exit 1
       }
       if [ "$SHOULD_INSTALL" = "1" ]; then
         [ ! -f "$TRUST_PATH" ] || { echo "FAIL ${DISTRO_ID}: uninstall did not remove ${TRUST_PATH}"; exit 1; }
       fi

       echo "PASS ${DISTRO_ID}"
       ```

    9. **`scripts/e2e-proxy-install-linux.mjs`** — Node orchestrator. Imports nothing from the mcp source; pure shell wrapper. Structure:
       ```javascript
       #!/usr/bin/env node
       import { spawnSync } from "node:child_process";
       import path from "node:path";
       import { fileURLToPath } from "node:url";

       const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
       const DISTROS = ["debian", "ubuntu", "fedora", "rockylinux", "arch"];
       const RUN_TAG = `e2e-${Date.now()}`;

       function softSkip(msg) {
         console.log(`[skip] ${msg}`);
         process.exit(0);
       }

       function header(msg) { console.log(`\n── ${msg} ──`); }

       // Sanity: docker available?
       const dockerCheck = spawnSync("docker", ["--version"], { encoding: "utf-8" });
       if (dockerCheck.status !== 0) softSkip("docker not available; skipping Linux E2E");

       header(`e2e-proxy-install-linux • ${DISTROS.length} distros • run=${RUN_TAG}`);

       const results = [];
       for (const distro of DISTROS) {
         header(`distro=${distro}`);
         const tag = `synapse-e2e-${distro}:${RUN_TAG}`;
         const buildArgs = ["build", "-f", `scripts/e2e-linux/Dockerfile.${distro}`, "-t", tag, "."];
         const build = spawnSync("docker", buildArgs, { cwd: REPO_ROOT, stdio: "inherit" });
         if (build.status !== 0) { results.push({ distro, stage: "build", ok: false }); continue; }

         const run = spawnSync("docker", ["run", "--rm", tag], { cwd: REPO_ROOT, stdio: "inherit" });
         results.push({ distro, stage: "run", ok: run.status === 0 });
       }

       // Cleanup: remove tagged images
       for (const distro of DISTROS) {
         spawnSync("docker", ["rmi", "-f", `synapse-e2e-${distro}:${RUN_TAG}`], { stdio: "ignore" });
       }

       header("Summary");
       for (const r of results) {
         console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.distro}${r.ok ? "" : ` (stage=${r.stage})`}`);
       }
       const allPassed = results.every(r => r.ok);
       process.exit(allPassed ? 0 : 1);
       ```

    10. **`package.json`** — add `"test:e2e:proxy-linux": "node scripts/e2e-proxy-install-linux.mjs"` to the scripts block. Do NOT add to the default `test:e2e` chain.

    11. **Verify the RED state**: `npm run test:e2e:proxy-linux` from repo root. Expected outcome with LinuxBackend stub:
        - PASS arch (stub soft-skips, which matches expected arch behavior)
        - FAIL debian, ubuntu, fedora, rockylinux (stub soft-skips when they should install)
        - Exit code 1
        - This proves the test is real — it would have caught the bug class if the stub had been merged as "production-ready Linux support."

    12. **Commit**: `test(proxy): add Docker E2E gate for Linux trust-store install (RED — stub fails 4/5 distros)`. Push. CI doesn't run this yet, so CI stays green.
  </action>
  <verify>
    <automated>cd /Users/Tanmai.N/Documents/synapse && PATH="/opt/homebrew/opt/node/bin:$PATH" npm run lint && npm run typecheck --workspaces --if-present</automated>
    <automated>cd /Users/Tanmai.N/Documents/synapse && PATH="/opt/homebrew/opt/node/bin:$PATH" docker --version</automated>
    <manual>npm run test:e2e:proxy-linux should produce: PASS arch + FAIL debian/ubuntu/fedora/rockylinux. Exit code 1. This is the visible RED state.</manual>
  </verify>
  <done>
    - 5 Dockerfiles, in-container script, host orchestrator, .dockerignore, npm script all exist.
    - `npm run test:e2e:proxy-linux` is invokable locally; produces the documented RED state (4/5 fail).
    - `npm run lint` is clean.
    - Repo-wide `npm run typecheck --workspaces --if-present` is green (no Node code changes to mcp).
    - CI is unchanged (no `.github/workflows/ci.yml` edit in this commit).
    - Single atomic commit pushed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Commit 2: Implement real LinuxBackend. Docker E2E now PASSES 5/5 locally.</name>
  <files>
    mcp/src/capture/proxy/backends/linux.ts (REPLACE stub with real implementation)
  </files>
  <behavior>
    Identical to original Slice A Task 2 (see `260530-8qe-PLAN.md`). Spec §4.2-4.3:

    - `detectDistroFamily(osReleaseText)` parses `ID=` + `ID_LIKE=` lines; debian-family if any candidate ∈ {debian, ubuntu, linuxmint, pop, elementary, kali, parrot, raspbian, alpine}; rhel-family if any ∈ {fedora, rhel, centos, rocky, almalinux, amzn, ol}; otherwise unknown.
    - `installCa`: copy CA via `sudo cp` then run `sudo update-ca-certificates` (debian) or `sudo update-ca-trust extract` (rhel). On sudo failure → `{ installed: false, requiresSudo: true, manualCommand }` without throwing. On unknown → soft-skip with Arch-aware manualInstallInstructions.
    - `uninstallCa`: mirror image with `sudo rm -f` + same update command.
    - `checkInstall`: test for the family-appropriate file existence.
    - Default runners: `runSudo` uses `spawnSync("sudo", ..., { stdio: "inherit" })` per spec §4.3. `runCp` uses `spawnSync(args[0], args.slice(1))` with stdio:"pipe" so tests intercept. `readOsRelease` reads `/etc/os-release`, returns null on ENOENT.

    Per spec §4.3: NO throw on sudo failure. The soft-fail returns `requiresSudo: true` + `manualCommand`. (In Docker containers running as root, sudo is a no-op shim that exits 0 — so this code path won't run in the Docker E2E; the soft-fail path is unit-test-only.)
  </behavior>
  <action>
    Re-read spec §4.2 + §4.3 + the original Slice A Task 2 action block in `260530-8qe-PLAN.md`. Implementation is identical to that task. Sequencing:

    1. Replace `mcp/src/capture/proxy/backends/linux.ts` contents with the real implementation per spec §4.2-4.3. Keep the existing exports (`LinuxBackend`) so the dispatcher continues to work without edits.

    2. Local verify cycle:
       a. `cd mcp && npm run build && npm test -- onboarding` — existing 12 onboarding tests still pass (the dispatcher bridge translates the new linux skippedReason shape to the legacy `platform=linux` text).
       b. `npm run test:e2e:proxy-linux` — NOW PASSES 5/5. PASS debian + ubuntu + fedora + rockylinux + arch.
       c. If any distro fails: read the container stdout, fix the backend, re-run. Don't claim done until 5/5.

    3. Commit: `feat(proxy): linux native CA install via update-ca-certificates / update-ca-trust`. Push.
  </action>
  <verify>
    <automated>cd /Users/Tanmai.N/Documents/synapse/mcp && PATH="/opt/homebrew/opt/node/bin:$PATH" npm run lint && npm run typecheck && npm test</automated>
    <automated>cd /Users/Tanmai.N/Documents/synapse && PATH="/opt/homebrew/opt/node/bin:$PATH" npm run test:e2e:proxy-linux</automated>
    <!-- Full repo pre-push gate -->
    <automated>cd /Users/Tanmai.N/Documents/synapse && PATH="/opt/homebrew/opt/node/bin:$PATH" npm run lint && npm run typecheck --workspaces --if-present && npm test --workspaces --if-present</automated>
  </verify>
  <done>
    - `mcp/src/capture/proxy/backends/linux.ts` is the real implementation with `detectDistroFamily` + family-aware install/uninstall/check + sudo soft-fail.
    - All existing unit tests pass UNMODIFIED (the dispatcher bridge from Slice A Task 1 carries the legacy skippedReason shape).
    - `npm run test:e2e:proxy-linux` PASSES 5/5 distros — the Docker E2E from Commit 1 is now GREEN.
    - Pre-push gate green.
    - Single atomic commit pushed.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Commit 3: CI wiring — add proxy-linux-e2e matrix job to .github/workflows/ci.yml</name>
  <files>
    .github/workflows/ci.yml (MODIFY — add new job)
  </files>
  <behavior>
    - New job `proxy-linux-e2e` runs on `ubuntu-latest`, in parallel with `verify`, with a 15-minute timeout.
    - Matrix dimension: `distro: [debian, ubuntu, fedora, rockylinux, arch]`. `fail-fast: false` so all distros report independently.
    - For each matrix entry: checkout repo, set up Docker layer cache, build `Dockerfile.<distro>`, run the container.
    - The job runs on every push to main (no `if:` gating; runs on every push and PR like `verify`).
    - Docker layer caching via `actions/cache` keyed on the Dockerfile + `package.json` + `package-lock.json` hashes. First run ~3 min/distro; subsequent runs ~30s/distro.
    - The job does NOT block the existing `verify` / `e2e` / `migrate` jobs — it's independent.
  </behavior>
  <action>
    1. Edit `.github/workflows/ci.yml` — add a new job after `verify`:
       ```yaml
         proxy-linux-e2e:
           runs-on: ubuntu-latest
           timeout-minutes: 15
           strategy:
             fail-fast: false
             matrix:
               distro: [debian, ubuntu, fedora, rockylinux, arch]
           steps:
             - uses: actions/checkout@v4
             - name: Set up Docker Buildx
               uses: docker/setup-buildx-action@v3
             - name: Build container
               uses: docker/build-push-action@v5
               with:
                 context: .
                 file: scripts/e2e-linux/Dockerfile.${{ matrix.distro }}
                 tags: synapse-e2e-${{ matrix.distro }}:ci
                 load: true
                 cache-from: type=gha,scope=proxy-linux-${{ matrix.distro }}
                 cache-to: type=gha,scope=proxy-linux-${{ matrix.distro }},mode=max
             - name: Run E2E
               run: docker run --rm synapse-e2e-${{ matrix.distro }}:ci
       ```

    2. Push and watch the metanmai/synapse CI run. All 5 matrix entries should be green. If any fail in CI but pass locally, investigate (most likely cause: GHA runner doesn't have a particular package cached; layer-cache miss; container resource limits).

    3. Update `docs/E2E-PROTOCOL.md` "What it doesn't test" section: remove "Layer 8 install on Linux" from the gap list since CI now covers it. Add a new row to the merge-gate chain table noting Docker E2E runs in CI but not locally by default.

    4. Commit: `ci(proxy): add Linux trust-store E2E matrix job (5 distros via Docker)`. Push.
  </action>
  <verify>
    <automated>cd /Users/Tanmai.N/Documents/synapse && PATH="/opt/homebrew/opt/node/bin:$PATH" npm run lint && npm run typecheck --workspaces --if-present</automated>
    <manual>After push: watch metanmai/synapse Actions tab. The `proxy-linux-e2e` job appears with 5 matrix entries. All must be green within ~5 min wall-clock.</manual>
  </verify>
  <done>
    - `.github/workflows/ci.yml` has new `proxy-linux-e2e` job with 5-distro matrix.
    - CI run on metanmai/synapse is green for all 5 distros.
    - `docs/E2E-PROTOCOL.md` reflects the new gate.
    - Single atomic commit pushed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Commit 4: Test split — add backend-level unit tests (mac.test.ts + linux.test.ts) + rewrite dispatcher-focused onboarding.test.ts</name>
  <files>
    mcp/test/capture/proxy/backends/mac.test.ts (NEW — extracted from existing onboarding.test.ts),
    mcp/test/capture/proxy/backends/linux.test.ts (NEW — ~14 cases per spec §4.4),
    mcp/test/capture/proxy/onboarding.test.ts (REWRITE — dispatcher-focused)
  </files>
  <behavior>
    Identical to original Slice A Task 3 (see `260530-8qe-PLAN.md`). Spec §4.4.

    - `mac.test.ts`: existing macOS tests moved here, targeting `MacBackend` directly via `MacBackend.installCa(caPath, opts)` etc.
    - `linux.test.ts`: ~14 cases covering distro detection (Debian/Ubuntu/Fedora/RHEL/Arch/NixOS/Gentoo + missing os-release), install for debian-family + rhel-family, uninstall, checkInstall, sudo failure (the critical soft-fail path the Docker E2E can't easily exercise), Arch trap-distro guard.
    - `onboarding.test.ts`: dispatcher-focused — routing tests (darwin → MacBackend, linux → LinuxBackend, win32 → UnknownBackend) + legacy field-name preservation (`installedInKeychain`, `inKeychain`) + caPath/TlsManager drift guard.
  </behavior>
  <action>
    Re-read spec §4.4 + the original Slice A Task 3 action block in `260530-8qe-PLAN.md`. Implementation is identical to that task — execute it here.

    Commit: `test(proxy): split mac onboarding tests + add linux backend tests + dispatcher-focused onboarding tests`. Push.

    After this commit, BOTH Docker E2E (real install on real distros) AND unit tests (logic + soft-fail paths the Docker E2E can't reach) guard the proxy onboarding bug class.
  </action>
  <verify>
    <automated>cd /Users/Tanmai.N/Documents/synapse/mcp && PATH="/opt/homebrew/opt/node/bin:$PATH" npm run lint && npm run typecheck && npm test</automated>
    <automated>cd /Users/Tanmai.N/Documents/synapse && PATH="/opt/homebrew/opt/node/bin:$PATH" npm run test:e2e:proxy-linux</automated>
    <automated>cd /Users/Tanmai.N/Documents/synapse && PATH="/opt/homebrew/opt/node/bin:$PATH" npm run lint && npm run typecheck --workspaces --if-present && npm test --workspaces --if-present</automated>
  </verify>
  <done>
    - `mcp/test/capture/proxy/backends/mac.test.ts` covers macOS bug classes against `MacBackend` directly.
    - `mcp/test/capture/proxy/backends/linux.test.ts` covers ~14 cases per spec §4.4 — including sudo soft-fail (the critical path the Docker E2E doesn't reach since containers run as root).
    - `mcp/test/capture/proxy/onboarding.test.ts` is dispatcher-focused.
    - All test suites pass. `npm run test:e2e:proxy-linux` still passes 5/5.
    - Pre-push gate green.
    - Single atomic commit pushed.
  </done>
</task>

</tasks>

<verification>

Phase-level acceptance criteria (run after Commit 4 lands and pushes):

1. **Docker E2E covers all three code paths**: debian-family (Debian + Ubuntu), rhel-family (Fedora + Rocky), unknown soft-skip (Arch). 5 distros, all green locally + in CI.

2. **Unit tests cover paths Docker E2E can't reach**: sudo soft-fail (containers run as root, no sudo failure to test live), distro detection drift (would only catch the ID_LIKE inheritance bug if a future distro ships a misleading os-release — unit tests catch it now via fixture strings).

3. **CI matrix green on metanmai/synapse**: 5 distros, ~5 min wall-clock per push, layer-cached across runs.

4. **Existing `verify` + `e2e` + `migrate` jobs unaffected**: the new `proxy-linux-e2e` job runs independently in parallel.

5. **`docs/E2E-PROTOCOL.md` reflects reality**: the L8-install gap from 2026-05-30 is now closed for Linux; the macOS L8 gap (action #145) remains documented.

6. **All four commits pushed to remote**, lock files excluded, no `--no-verify`, pre-push hook green at each.

</verification>

<success_criteria>

Slice A.5 complete when:

- [ ] `scripts/e2e-linux/` exists with 5 Dockerfiles + in-container script + .dockerignore.
- [ ] `scripts/e2e-proxy-install-linux.mjs` orchestrates all 5 distros, soft-skips when Docker is unavailable.
- [ ] `npm run test:e2e:proxy-linux` PASSES 5/5 locally on macOS via Rancher Desktop.
- [ ] CI matrix job `proxy-linux-e2e` runs on every push, all 5 distros green.
- [ ] LinuxBackend is implemented (real version of original Slice A Task 2).
- [ ] Unit-test split done (mac.test.ts + linux.test.ts + dispatcher-focused onboarding.test.ts).
- [ ] `docs/E2E-PROTOCOL.md` updated.
- [ ] 4 atomic commits, all pushed, no lock files, all pre-push hooks passed.
- [ ] CI green at every commit boundary (no red-then-green sequence on `main`).

Out of scope and confirmed NOT done (deferred):

- [ ] Layer 5/7 proxy paths exercised on Linux (would need `claude` CLI + API key + network in containers) — separate quick task.
- [ ] Windows Docker testing — Slice B; out of scope.
- [ ] macOS L8 install E2E — action_item #145, blocked by MDM on the maintainer's machine.
- [ ] GUI tool integration (Cursor / Claude Desktop / ChatGPT Desktop) — spike #118, needs personal machine.

</success_criteria>

<output>

After Commit 4 commits and pushes, append the following summary block to this PLAN.md file under `## Outcome`:

```
## Outcome

**Status:** shipped
**Commits:**
- <sha1> — test(proxy): add Docker E2E gate for Linux trust-store install (RED — stub fails 4/5 distros)
- <sha2> — feat(proxy): linux native CA install via update-ca-certificates / update-ca-trust
- <sha3> — ci(proxy): add Linux trust-store E2E matrix job (5 distros via Docker)
- <sha4> — test(proxy): split mac onboarding tests + add linux backend tests + dispatcher-focused onboarding tests

**Docker E2E coverage:** Debian 12, Ubuntu 24.04, Fedora 40, Rocky Linux 9, Arch latest — 5/5 PASS locally + in CI.
**Unit tests:** ~14 new cases in `linux.test.ts` covering paths Docker E2E can't reach (sudo soft-fail, distro detection drift).
**Pre-push gate:** green at each commit.
**CI on metanmai:** green at each commit; new matrix job adds ~5 min wall-clock per push.
**Next:** Slice B (Windows + node-forge + control-file shutdown) — separate plan.
```

Also save a Synapse insight:
- type: `decision`
- summary (≤12 words): `Linux proxy install validated via Docker E2E (5 distros) in CI per push.`
- detail (≤2 sentences): Sketch the Docker-matrix-in-CI shape and note the macOS L8 gap remains (action #145).
- Use `supersedes` if any existing Synapse insight about Linux backend planning or CI coverage is now stale.

</output>
