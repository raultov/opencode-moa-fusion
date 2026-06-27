#!/usr/bin/env bash
# scripts/dev-drive-installer.sh
#
# Drives install.sh against a running dev-install-server in a fake PTY.
# Requires: socat (creates the PTY).
#
# Usage:
#   ./scripts/dev-drive-installer.sh
#
# What it does:
#   1. Starts scripts/dev-install-server.mjs on a free port.
#   2. Allocates a PTY with socat.
#   3. Runs install.sh with INSTALL_ARGS pointing at the local server.
#   4. Sends keystrokes: 2<CR>  (global scope).
#   5. Lets the multi-select prompt run; if the host has 'opencode' on PATH
#      it'll show models — we send a few CRs to confirm with empty selection.
#   6. Cleans up.
#
# Exits 0 if the installer reaches "All done!".

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-18765}"
VERSION="$(node -e 'console.log("v" + JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8")).version)' "$REPO_ROOT/package.json")"
SEMVER="${VERSION#v}"

# Start the dev-install-server in the background (HTTPS to satisfy the installer's HTTPS-only check)
node "$REPO_ROOT/scripts/dev-install-server.mjs" --https --port="$PORT" --version="$VERSION" \
    > /tmp/dev-install-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

# Give the server a moment
sleep 1

if ! curl -kfsS -o /dev/null "https://127.0.0.1:$PORT/raultov/opencode-moa-fusion/releases/download/$VERSION/SHA256SUMS"; then
    echo "ERROR: dev-install-server did not start. Log:"
    cat /tmp/dev-install-server.log
    exit 1
fi

echo "[dev-drive-installer] server up at https://127.0.0.1:$PORT (ref=$VERSION)"
echo "[dev-drive-installer] running install.sh in a fake PTY..."

# Drive the installer with socat providing a PTY. We feed keystrokes via stdin
# to socat. The keystrokes are: 2<CR> (global), <CR> (accept default
# command name), then a few CRs to dismiss the model picker if it appears,
# then CR to confirm.
#
# Override the keystroke sequence (and the expected install path) by
# setting CMD_NAME=foo before invoking this script.
#
# The installer runs `node` internally; the spawned node process inherits our
# NODE_TLS_REJECT_UNAUTHORIZED=0 so the self-signed cert is accepted.

mkdir -p /tmp/moa-dev-home
export HOME=/tmp/moa-dev-home
export NODE_TLS_REJECT_UNAUTHORIZED=0
CMD_NAME="${CMD_NAME:-}"

cat > /tmp/run-install.sh <<EOF
#!/usr/bin/env bash
exec env NODE_TLS_REJECT_UNAUTHORIZED=0 bash "$REPO_ROOT/install.sh" \
    --skip-signature \
    --download-base-url=https://127.0.0.1:$PORT \
    --owner=raultov \
    --repo=opencode-moa-fusion \
    --version=$SEMVER \
    ${CMD_NAME:+--command-name="$CMD_NAME"}
EOF
chmod +x /tmp/run-install.sh

# Build keystroke sequence based on CMD_NAME. We use \r (CR) because the
# installer's prompts (scopePrompt, multiSelectPrompt) interpret \r as the
# Enter key in raw mode, and readline treats \r as line terminator too.
{
  sleep 0.3
  printf '2\r'              # global scope
  sleep 1
  if [ -n "$CMD_NAME" ]; then
    printf '%s\r' "$CMD_NAME"   # type the custom command name + CR
  else
    printf '\r'             # accept default 'moa'
  fi
  sleep 3
  printf '\r\r\r\r'         # dismiss multi-select
} | socat - EXEC:"/tmp/run-install.sh",pty,stderr,setsid,sigint,sane \
    2>&1 | tee /tmp/moa-dev-install.log

INSTALL_EXIT=${PIPESTATUS[1]}
rm -f /tmp/run-install.sh

if grep -q "All done!" /tmp/moa-dev-install.log; then
    INSTALLED_CMD="${CMD_NAME:-moa}"
    echo ""
    echo "[dev-drive-installer] SUCCESS — installer reached 'All done!'."
    echo "[dev-drive-installer] Resulting ~/.config/opencode/opencode.json:"
    cat ~/.config/opencode/opencode.json 2>/dev/null || echo "(not found)"
    echo ""
    echo "[dev-drive-installer] /${INSTALLED_CMD} command installed?"
    ls -la ~/.config/opencode/command/${INSTALLED_CMD}.md 2>/dev/null || echo "(not found)"
    exit 0
fi

echo ""
echo "[dev-drive-installer] Installer did NOT reach 'All done!'. Exit=$INSTALL_EXIT."
echo "[dev-drive-installer] Last 30 lines of install log:"
tail -30 /tmp/moa-dev-install.log
exit 1