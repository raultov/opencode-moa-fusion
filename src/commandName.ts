/**
 * Helpers for the installer's "slash command name" feature.
 *
 * The installer lets the user pick the name of the slash command that gets
 * installed (default: "moa"). The chosen name is used as the on-disk
 * filename (`<name>.md`) and as the literal name the user types after `/`
 * in OpenCode.
 *
 * The validators are deliberately exported from this module so both
 * install.sh and install.ps1 (which inline Node code blocks) can share
 * the exact same logic — and so the same regex is unit-testable under Bun
 * without spawning a TTY.
 *
 * Rules (must all hold for a name to be valid):
 *   - Non-empty after trim + lowercase + strip leading slashes.
 *   - Starts with a lowercase ASCII letter.
 *   - Remaining characters are lowercase ASCII letters, digits, hyphen, or
 *     underscore.
 *   - Total length is 1..32 characters.
 *
 * Examples of valid names: `moa`, `team`, `council`, `mix-3`, `agents_v2`.
 * Examples of invalid names: `MOA` (uppercase), `/moa` (leading slash,
 * stripped before validation), `3moa` (starts with digit), `moa cmd`
 * (space), `moa.md` (dot), `` (empty).
 */

const COMMAND_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const DEFAULT_COMMAND_NAME = "moa";

export function isValidCommandName(name: unknown): boolean {
  return typeof name === "string" && COMMAND_NAME_RE.test(name);
}

/**
 * Normalize a user-typed name into the canonical form:
 *   - trim whitespace
 *   - lowercase
 *   - strip any leading "/" characters (so `/moa` becomes `moa`)
 * Returns the normalized name if valid, or null otherwise.
 */
export function normalizeCommandName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase().replace(/^\/+/, "");
  return isValidCommandName(trimmed) ? trimmed : null;
}

export { COMMAND_NAME_RE, DEFAULT_COMMAND_NAME };
