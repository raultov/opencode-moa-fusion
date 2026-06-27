#!/usr/bin/env bash
#
# tests/install_signature.sh — End-to-end test for installer integrity.
#
# Spins up a local HTTP server and runs the verifyMoaMd flow against
# fixtures that simulate three scenarios:
#   1. tampered SHA256SUMS (wrong hash for moa.md) — must be rejected.
#   2. correct SHA256SUMS — must be accepted.
#   3. SHA256SUMS that does not list moa.md — must be rejected.
#
# Plus two URL-host tests:
#   4. http:// to a non-GitHub host — must be refused.
#   5. https:// to a non-GitHub host — must be refused.
#
# This test wraps tests/install_signature_e2e.mjs, which is itself
# spawned by `bun test` via tests/install_signature_e2e.spec.ts. Both
# entry points run the same driver so CI gets full coverage whether the
# harness invokes `bun test` or this script directly.
#
# Usage:
#   bash tests/install_signature.sh
#
# Exit code:
#   0  all assertions passed
#   1  a test failed

set -e
set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRIVER="$REPO_ROOT/tests/install_signature_e2e.mjs"

if ! command -v node >/dev/null 2>&1; then
    echo "FAIL: node is required for this test" >&2
    exit 1
fi

if [ ! -f "$DRIVER" ]; then
    echo "FAIL: driver not found at $DRIVER" >&2
    exit 1
fi

node "$DRIVER"