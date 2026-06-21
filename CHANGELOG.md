# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.4] - 2026-06-21

### Added

- **Disclaimer in README.md**: Explained that the interactive installers might not show all available models if those models require specific runtime environment variables to be visible (because it uses `opencode models` internally).

## [1.2.3] - 2026-06-21

### Added

- **Windows installer (`install.ps1`)**: native PowerShell entry point
  (`irm <url> | iex`) that mirrors the Linux/macOS `install.sh` flow — same
  scope prompt, npm version lookup, interactive model picker and config
  writeout. Bundles the same embedded Node.js logic so both installers stay
  byte-for-byte in sync on the generated `moa.md` and `opencode.json`.
- **macOS support documented**: `install.sh` already works on macOS (uses
  bash, `/dev/tty`, and the same XDG path as Linux); the README now states
  this explicitly.
- **Worker completion progress block** in the `/moa` slash command: the
  invoking agent must now emit a one-line-per-worker block (model, elapsed
  time, ok/failure) before its synthesized answer, since worker subagents
  are not navigable from the OpenCode TUI.

### Changed

- **Single Source of Truth for `/moa`**: the installers no longer embed a
  hardcoded copy of `commands/moa.md`. Instead, they dynamically download the
  file from GitHub at install time (matching the version tag being installed).
  This ensures the generated slash command is always perfectly in sync with
  the upstream repository.
- `install.sh`'s embedded Node.js is now portable: `getOpencodeModels()`
  uses `stdio: ["ignore", "pipe", "ignore"]` instead of `2>/dev/null`,
  `os.homedir()` replaces `process.env.HOME`, and the `/dev/tty` fallback
  is gated on `process.platform !== "win32"`. This makes the embedded
  script reusable verbatim from `install.ps1` and from Git Bash / WSL on
  Windows.

## [1.2.2] - 2025-06-20

### Fixed

- Remove `npm install` step from the interactive installer. OpenCode resolves
  plugins from npm automatically and caches them under
  `~/.cache/opencode/packages/`; running `npm install` in the user's project
  polluted its `node_modules` and triggered peer-dependency conflicts (e.g.
  `react@18` vs `@opentui/keymap`'s optional `react@>=19` range).

## [1.2.1] - 2025-06-20

### Fixed

- Pass `--legacy-peer-deps` to `npm install` in the installer to bypass the
  optional `react@>=19` peer conflict from `@opentui/keymap`. (Superseded by
  1.2.2 which removes the `npm install` step entirely.)

## [1.2.0] - 2025-06-20

### Added

- Interactive one-line curl installer (`install.sh`) with scope selection
  (local/global), automatic version detection from npm, and interactive
  multi-select model picker.

## [1.1.0] - 2025-06-19

### Added

- `/moa` slash command file for OpenCode.
- One-line curl installer script.

## [1.0.2] - 2025-06-19

### Fixed

- Add `main` and `files` fields to `package.json` so the compiled plugin is
  correctly published to npm.

### Changed

- Update installation instructions for npm package.
- Add troubleshooting steps for enterprise proxies.

## [1.0.1] - 2025-06-19

### Added

- GitHub Actions workflows for CI and npm publish.

## [1.0.0] - 2025-06-19

### Added

- Initial release of `opencode-moa-fusion`.
- Mixture-of-Agents plugin for OpenCode: fans out prompts to multiple worker
  models in parallel and synthesizes a unified answer.

[1.2.4]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/raultov/opencode-moa-fusion/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/raultov/opencode-moa-fusion/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/raultov/opencode-moa-fusion/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/raultov/opencode-moa-fusion/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/raultov/opencode-moa-fusion/releases/tag/v1.0.0
