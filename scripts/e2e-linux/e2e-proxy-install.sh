#!/bin/sh
# Synapse proxy Layer 8 E2E — in-container trust-store install assertions.
#
# Runs INSIDE a distro-specific container (Debian/Ubuntu/Fedora/Rocky/Arch).
# Reads /etc/os-release to determine the distro family + expected paths,
# then drives `synapsesync capture proxy install/status/uninstall` and
# asserts the real filesystem state against spec §4.2.
#
# Exits 0 on PASS, non-zero on any FAIL. Single source of truth for all
# 5 distros — Dockerfile per distro, but one assertion script.

set -e

. /etc/os-release  # populates $ID, $ID_LIKE
DISTRO_ID="${ID:-unknown}"
echo "── e2e-proxy-install: distro=${DISTRO_ID} (ID_LIKE='${ID_LIKE:-}') ──"

# Map distro → expected family + trust-store path (spec §4.2).
# debian-family symlinks ca-cert into /etc/ssl/certs/ via update-ca-certificates.
# rhel-family writes anchor into /etc/pki/ca-trust/source/anchors/ + update-ca-trust extract.
# arch → soft-skip; assert NO file written to either family's path.
case "${DISTRO_ID}" in
  debian|ubuntu|linuxmint|pop|elementary|kali|parrot|raspbian)
    FAMILY=debian
    TRUST_PATH=/etc/ssl/certs/synapse.pem
    SHOULD_INSTALL=1
    ;;
  fedora|rhel|centos|rocky|rockylinux|almalinux|amzn|ol)
    FAMILY=rhel
    TRUST_PATH=/etc/pki/ca-trust/source/anchors/synapse.pem
    SHOULD_INSTALL=1
    ;;
  arch|manjaro|endeavouros|nixos|gentoo|void|alpine)
    FAMILY=unknown
    TRUST_PATH=""
    SHOULD_INSTALL=0
    ;;
  *)
    echo "FAIL ${DISTRO_ID}: unsupported in this E2E (extend the case statement above)"
    exit 1
    ;;
esac

echo "  family=${FAMILY} trust_path=${TRUST_PATH:-<n/a>} should_install=${SHOULD_INSTALL}"

# Pre-state: trust-store paths must be empty (clean container).
if [ "${SHOULD_INSTALL}" = "1" ] && [ -f "${TRUST_PATH}" ]; then
  echo "FAIL ${DISTRO_ID}: pre-state — ${TRUST_PATH} already exists before install"
  exit 1
fi
if [ "${SHOULD_INSTALL}" = "0" ]; then
  # Unknown-family containers must have NEITHER family's path populated.
  [ ! -f /etc/ssl/certs/synapse.pem ] || { echo "FAIL ${DISTRO_ID}: pre-state debian path populated"; exit 1; }
  [ ! -f /etc/pki/ca-trust/source/anchors/synapse.pem ] || { echo "FAIL ${DISTRO_ID}: pre-state rhel path populated"; exit 1; }
fi

cd /repo/mcp
CLI="node /repo/mcp/dist/index.js"

# ── STAGE 1: install ───────────────────────────────────────────────────
echo "  [install] ${CLI} capture proxy install"
if ! ${CLI} capture proxy install > /tmp/install.out 2>&1; then
  echo "FAIL ${DISTRO_ID}: 'capture proxy install' exited non-zero"
  cat /tmp/install.out
  exit 1
fi

if [ "${SHOULD_INSTALL}" = "1" ]; then
  if [ ! -f "${TRUST_PATH}" ]; then
    echo "FAIL ${DISTRO_ID}: install did NOT create ${TRUST_PATH}"
    echo "── install stdout: ──"; cat /tmp/install.out
    exit 1
  fi
  echo "  [install] PASS — ${TRUST_PATH} exists"
else
  if [ -f /etc/ssl/certs/synapse.pem ] || [ -f /etc/pki/ca-trust/source/anchors/synapse.pem ]; then
    echo "FAIL ${DISTRO_ID}: install on unknown-family distro unexpectedly wrote a trust-store file"
    exit 1
  fi
  echo "  [install] PASS — unknown-family soft-skipped, no file written"
fi

# ── STAGE 2: status (smoke check — non-zero exit is the regression) ───
echo "  [status] ${CLI} capture proxy status"
if ! ${CLI} capture proxy status > /tmp/status.out 2>&1; then
  echo "FAIL ${DISTRO_ID}: 'capture proxy status' exited non-zero"
  cat /tmp/status.out
  exit 1
fi
echo "  [status] PASS"

# ── STAGE 3: uninstall ────────────────────────────────────────────────
echo "  [uninstall] ${CLI} capture proxy uninstall"
if ! ${CLI} capture proxy uninstall > /tmp/uninstall.out 2>&1; then
  echo "FAIL ${DISTRO_ID}: 'capture proxy uninstall' exited non-zero"
  cat /tmp/uninstall.out
  exit 1
fi

if [ "${SHOULD_INSTALL}" = "1" ]; then
  if [ -f "${TRUST_PATH}" ]; then
    echo "FAIL ${DISTRO_ID}: uninstall did NOT remove ${TRUST_PATH}"
    cat /tmp/uninstall.out
    exit 1
  fi
  echo "  [uninstall] PASS — ${TRUST_PATH} removed"
else
  echo "  [uninstall] PASS — unknown-family no-op"
fi

echo "PASS ${DISTRO_ID}"
