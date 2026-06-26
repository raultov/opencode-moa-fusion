# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security (PR `security/hardening-2026-06`)

#### Step 1 — Worker tool allowlist (consensus #1, Critical)

- **Workers are now sandboxed to a read-only tool allowlist by default.**
  The new `workerTools` plugin option lets users extend the allowlist;
  default is `["read", "glob", "grep"]`. `bash`, `write`, `edit`,
  `webfetch`, `patch`, and `todowrite` are explicitly denied unless the
  user opts in by listing them. `moa_fusion` is always forced off inside
  workers to prevent recursion. See `README.md` for details.

#### Step 2 — Installer integrity (consensus #2, Critical)

- **Installer now verifies release integrity** via Sigstore/cosign
  keyless signatures and SHA-256 checksums published with every GitHub
  release. Pinning is to immutable tags only — the `main`/`latest`
  fallback is gone. Redirects are restricted to an allowlist of
  GitHub-controlled hosts (`github.com`,
  `objects.githubusercontent.com`, `raw.githubusercontent.com`); any
  other redirect target is refused.
- New `--skip-signature` escape hatch (still SHA-256 verified,
  recommended only for CI smoke tests where installing `cosign` is
  impractical). Documented in `RELEASING.md`.
- New `src/install-verify.mjs` module exposes the verification helpers
  for unit testing without touching the embedded installer scripts.
- New end-to-end test (`tests/install_signature.sh` /
  `tests/install_signature_e2e.mjs`) spins up a local HTTP server and
  exercises the verify flow against tampered fixtures.

#### Step 3 — `agent` removed from public schema (consensus #3, High)

- **BREAKING**: `agent` is no longer accepted as a tool argument to
  `moa_fusion`. It can only be set via the `agent` plugin option in
  `opencode.json`. This closes a privilege-escalation vector where a
  compromised orchestrator agent could pick an elevated-permission
  worker profile. The `/moa` slash command never passed `agent` in
  args, so real-world impact is expected to be zero. A clear Zod error
  is raised if any orchestrator does try to pass `agent` as a tool
  argument (the field is silently stripped before `execute()` runs;
  callers using `moaFusionTool` directly see the `general` default).

#### Step 4 — Worker cap and dedup (consensus #4, High)

- **Up to 8 workers per call.** Enforced at two layers:
  1. The schema-level `z.array(...).max(8)` on `args.workers` rejects
     oversized arrays at parse time (before any side effect).
  2. `resolveRoles` checks the post-dedup count and throws
     `TOO_MANY_WORKERS` for either input path (args or plugin options).
- **Duplicates are silently dropped** after `parseModelRef`, comparing
  by `${providerID}/${modelID}`. The first occurrence wins. This
  prevents cost amplification when a user accidentally lists the same
  model twice.
- New `TOO_MANY_WORKERS` error code in `RoleResolutionError`.
- New tests in `tests/roles.spec.ts` (dedup, cap) and `tests/tool.spec.ts`
  (schema rejection at parse time, dedup at spawn time).

#### Step 5 — `READ_ONLY_DIRECTIVE` moved to the `system` channel (consensus #5, Medium)

- **The read-only directive is now sent as the `system` field** of
  `session.prompt`, no longer concatenated into the user message.
  Combined with Step 1 (tool allowlist) and Step 3 (agent pinned by the
  user), this is defence-in-depth against prompt-injection payloads:
  the directive lives on a separate channel that the model is
  instructed to treat as authoritative.
- **The user prompt is wrapped in `<user_prompt>...</user_prompt>`**
  boundary markers, giving the model an unambiguous start/end even if a
  provider ignores the `system` channel.
- `wrapReadOnly` is removed; replaced by `wrapUserPrompt` (only does
  the boundary wrap, no directive concatenation).
- The legacy `[USER PROMPT BELOW]` textual marker is removed from
  `READ_ONLY_DIRECTIVE` — the boundary is now structural, not textual.
- Caller-supplied `opts.system` is appended after the directive
  (directive always wins), so no caller can shadow it.
- New tests in `tests/callModel.spec.ts` assert the directive is in
  `system`, the prompt is wrapped, the legacy marker is gone, and a
  caller-supplied `system` cannot shadow the directive.

## [1.2.7] - 2026-06-26

### Fixed (CRITICAL)

- **Installer no longer destroys the user's `opencode.json`.** When the
  existing config was not parseable as strict JSON — for example because it
  contained `//` or `/* */` comments, trailing commas, or a BOM — the
  installer used to fall through to a default `{ "plugin": [] }` object and
  **silently overwrite** the entire file, dropping every other top-level key
  (`model`, `provider`, `mcp`, `theme`, agent overrides, etc.). This was
  reported by a user whose `opencode.json` was reduced to a bare plugin
  entry after running `curl -fsSL .../install.sh | bash`. The fix:

  1. **Backup first.** Before writing, the existing file is copied to
     `<configPath>.bak.<iso-timestamp>`, so the user can always recover
     their previous config from the same directory.
  2. **Tolerate JSON5/JSONC.** The reader strips `//` and `/* */` comments
     and trailing commas before retrying `JSON.parse`, so common
     hand-edited configs (the kind `JSON.parse` chokes on) are now
     accepted and merged. The stripper is string-aware, so URLs and other
     `//` text inside JSON strings are preserved.
  3. **Refuse to overwrite a malformed file.** If the config still cannot
     be parsed after sanitization — or if its top-level value is not an
     object — the installer exits non-zero with a clear error and the
     file on disk is **not** modified.

### Changed

- The config-read/backup/merge/write logic now lives in a self-contained
  CLI at `src/install-merge-config.mjs`. Both `install.sh` and
  `install.ps1` download that file from the same release tag and invoke
  it with `--config-path`, `--plugin-spec` and `--workers` arguments.
  This keeps the install scripts thin and makes the merge behaviour
  unit-testable (see `tests/install-merge-config.spec.ts`).
- Added the `red` ANSI color to the terminal palette used by the
  installers for error messages.

## [1.2.6] - 2026-06-25

### Added

- **`timeoutMs` is now configurable from plugin options**: the per-worker
  timeout can be set in `opencode.json` under `plugin.options.moa_fusion.timeoutMs`
  in addition to the existing per-call `args.timeoutMs`. A new
  `resolveTimeoutMs()` helper in `src/roles.ts` centralizes the precedence
  rule (`args > options > default`), validates that the value is a positive
  number, and defaults to **300000 ms (5 min)** instead of the previous
  hardcoded 120000 ms. The `ArgsSchema` description was updated to reflect
  the new default.

### Changed

- **`callModel` per-worker timeout raised from 120000 to 300000 ms (5 min)**:
  the previous 2-minute default was too tight for slower models and large
  prompts; the new default gives all workers enough headroom to finish
  without prematurely aborting legitimate long-running calls. Users who
  need a tighter bound can still pass `timeoutMs` explicitly via args or
  plugin options.

### Tests

- Added unit tests for `resolveTimeoutMs` covering empty inputs, args
  precedence over options, fallback semantics for non-positive or
  non-numeric values, and custom fallbacks.
- Added an integration test verifying that `options.timeoutMs` is forwarded
  to `callModel` (slow worker aborted with `timeout` error).

## [1.2.5] - 2026-06-21

### Added

- **Workarounds in Disclaimer**: Added curl pipeline workarounds for environment variables in the installer disclaimer.

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

[1.2.7]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/raultov/opencode-moa-fusion/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/raultov/opencode-moa-fusion/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/raultov/opencode-moa-fusion/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/raultov/opencode-moa-fusion/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/raultov/opencode-moa-fusion/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/raultov/opencode-moa-fusion/releases/tag/v1.0.0
