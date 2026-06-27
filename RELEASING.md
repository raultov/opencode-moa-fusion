# Releasing `opencode-moa-fusion`

This document describes the maintainer-only release flow.

## Release flow

1. **Pick the next version.** We follow [semver](https://semver.org/spec/v2.0.0.html):
   - **patch** (`1.2.7` → `1.2.8`): backwards-compatible bug fixes.
   - **minor** (`1.2.7` → `1.3.0`): backwards-compatible features.
   - **major** (`1.2.7` → `2.0.0`): breaking changes.
2. **Update `package.json`.**
   ```bash
   npm version <patch|minor|major>
   ```
   This bumps the `version` field and creates a matching `vX.Y.Z` git tag.
3. **Push the tag.**
   ```bash
   git push --follow-tags
   ```
4. **CI runs `.github/workflows/release.yml`.** The job:
   1. checks out the repo,
   2. installs deps, runs `bun run build` and `bun test`,
   3. creates an empty GitHub Release (for the changelog),
   4. publishes to npm with `npm publish --no-git-checks`.
5. **Smoke-test the installer.** Before announcing the release, run:
   ```bash
   npx opencode-moa-fusion@latest --command-name=smoketest
   ```
   Confirm that the installer succeeds and the slash command is correctly placed.

## Tagging

- The `npx` installer is directly tied to the npm version published.
- Pre-release tags (`v1.4.0-rc.1`) are fine; npm will mark them as pre-releases automatically.

## Required permissions on the GitHub org

The release workflow needs:

- `contents: write` — required to create the GitHub Release.