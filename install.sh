#!/usr/bin/env bash
#
# opencode-moa-fusion — /moa command installer
#
# Installs the `/moa` slash command for OpenCode, which invokes the
# `moa_fusion` tool without requiring the user to mention it explicitly in
# every prompt.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.sh | bash
#   ./install.sh                  # interactive menu
#   ./install.sh --global         # non-interactive: install globally
#   ./install.sh --local          # non-interactive: install in current project
#
# The installer asks where to install the command:
#   1) Local — current project (./.opencode/command/moa.md)
#   2) Global — current user  (~/.config/opencode/command/moa.md)
#   ESC / q — cancel

# Re-exec under bash if invoked under sh/dash/ash.
if [ -z "${BASH_VERSION:-}" ]; then
  if command -v bash >/dev/null 2>&1; then
    exec bash "$0" "$@"
  else
    printf 'bash is required to run this installer.\n' >&2
    exit 1
  fi
fi

set -e
set -u
set -o pipefail

MODE=""
for arg in "$@"; do
  case "$arg" in
    --local)  MODE="local" ;;
    --global) MODE="global" ;;
    -h|--help)
      cat <<'USAGE'
Usage: install.sh [--local|--global]

Options:
  --local    Install /moa into ./.opencode/command/moa.md (current project)
  --global   Install /moa into ~/.config/opencode/command/moa.md (current user)
  -h, --help Show this message

With no flags, the installer shows an interactive menu.
USAGE
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

# Colours (skip if not a TTY)
if [ -t 1 ] && [ -n "${TERM:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  GREEN=$(printf '\033[0;32m')
  YELLOW=$(printf '\033[1;33m')
  BLUE=$(printf '\033[0;34m')
  BOLD=$(printf '\033[1m')
  NC=$(printf '\033[0m')
else
  GREEN=""; YELLOW=""; BLUE=""; BOLD=""; NC=""
fi

# The /moa command payload. Single-quoted heredoc so $ARGUMENTS is preserved
# literally for OpenCode to expand at runtime.
read -r -d '' MOA_MD <<'MOA_EOF' || true
---
description: Fan out a prompt to multiple worker models in parallel using moa_fusion and synthesize a unified answer
---

# /moa — Mixture-of-Agents

You **MUST** invoke the `moa_fusion` tool with the request below. Do not answer
the request yourself: fan it out to the configured worker models first, then
synthesize a single unified answer from their outputs.

## Rules

1. **Always call `moa_fusion`** as the very first action. Do not attempt to
   answer the request from your own knowledge before consulting the workers.
2. Pass the user's request verbatim as the `prompt` argument.
3. If the user mentions specific worker models (e.g. `google/gemini-2.5-pro`),
   pass them as the `workers` argument. Otherwise, omit `workers` so the
   plugin defaults from `opencode.json` are used.
4. Once the tool returns the labelled worker outputs, **synthesize** a single
   coherent answer:
   - Treat consensus across workers as authoritative.
   - Discard claims unique to one worker that no other corroborates.
   - **Never** mention the workers, their model names, or this synthesis step
     in your final answer to the user.

## Request

$ARGUMENTS
MOA_EOF

prompt_choice() {
  # Read a single keypress from the controlling terminal. When piped via
  # `curl | bash`, stdin is the script body, so we explicitly read from /dev/tty.
  if [ ! -r /dev/tty ]; then
    printf '%sNo TTY available. Re-run with --local or --global.%s\n' "$YELLOW" "$NC" >&2
    exit 1
  fi

  printf '\n%s%sopencode-moa-fusion — /moa command installer%s\n' "$BOLD" "$BLUE" "$NC"
  printf '\nWhere should the /moa command be installed?\n\n'
  printf '  %s1)%s Local  — current project  (./.opencode/command/moa.md)\n' "$GREEN" "$NC"
  printf '  %s2)%s Global — current user     (~/.config/opencode/command/moa.md)\n' "$GREEN" "$NC"
  printf '  %sESC / q)%s Cancel\n\n' "$YELLOW" "$NC"
  printf 'Choice: '

  # Read one char from /dev/tty without requiring Enter.
  local key
  IFS= read -rsn1 key </dev/tty
  printf '\n'

  case "$key" in
    1) MODE="local" ;;
    2) MODE="global" ;;
    q|Q|$'\033'|'')
      printf '%sCancelled.%s\n' "$YELLOW" "$NC"
      exit 0
      ;;
    *)
      printf '%sInvalid choice: %q%s\n' "$YELLOW" "$key" "$NC" >&2
      exit 1
      ;;
  esac
}

if [ -z "$MODE" ]; then
  prompt_choice
fi

case "$MODE" in
  local)
    TARGET_DIR="$(pwd)/.opencode/command"
    SCOPE_LABEL="project (local)"
    ;;
  global)
    TARGET_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/command"
    SCOPE_LABEL="user (global)"
    ;;
esac

TARGET_FILE="$TARGET_DIR/moa.md"

mkdir -p "$TARGET_DIR"
printf '%s' "$MOA_MD" > "$TARGET_FILE"
chmod 0644 "$TARGET_FILE"

printf '\n%s✓%s Installed %s/moa%s command for %s%s%s\n' \
  "$GREEN" "$NC" "$BOLD" "$NC" "$BOLD" "$SCOPE_LABEL" "$NC"
printf '  %s%s%s\n' "$BLUE" "$TARGET_FILE" "$NC"
printf '\nNext steps:\n'
printf '  1. Make sure the %sopencode-moa-fusion%s plugin is registered in your opencode.json.\n' "$BOLD" "$NC"
printf '  2. Restart OpenCode.\n'
printf '  3. Run %s/moa <your prompt>%s to fan out to your worker models.\n\n' "$BOLD" "$NC"
