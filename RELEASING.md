# Releasing `opencode-moa-fusion`

This document describes the maintainer-only release flow. End-users do not
need to read this — the installer is fully automated and verifies release
integrity at install time (see [`SECURITY_PLAN.md`](./SECURITY_PLAN.md) step 2
for the threat model).

## Release flow

1. **Pick the next version.** We follow [semver](https://semver.org/spec/v2.0.0.html):
   - **patch** (`1.2.7` → `1.2.8`): backwards-compatible bug fixes.
   - **minor** (`1.2.7` → `1.3.0`): backwards-compatible features.
   - **major** (`1.2.7` → `2.0.0`): breaking changes. The current
     security-hardening branch (`security/hardening-2026-06`) introduces
     breaking changes (notably step 3 — `agent` removed from public tool
     args) and will therefore ship as `1.3.0` minimum, possibly `2.0.0`.
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
   3. computes `SHA256SUMS` over `commands/moa.md`,
   4. signs `SHA256SUMS` with `cosign sign-blob` in **keyless mode**
      (OIDC identity from GitHub Actions),
   5. uploads the release assets:
      - `commands/moa.md`
      - `SHA256SUMS`
      - `SHA256SUMS.sig`
      - `SHA256SUMS.pem`
   6. publishes to npm with `npm publish --no-git-checks`.
5. **Verify on the GitHub release page.** Confirm all four assets are
   present and the `.pem` certificate identity is
   `https://github.com/raultov/opencode-moa-fusion/.github/workflows/release.yml@refs/tags/vX.Y.Z`.
6. **Smoke-test the installer in a clean VM.** Before announcing the
   release, run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.sh | bash
   ```
   Confirm:
   - `cosign verify-blob` succeeds (or `gh attestation verify` if cosign
     is not installed),
   - the `✓ SHA-256 verified` and `✓ cosign signature verified` log lines
     appear,
   - `moa.md` is installed at the expected path.
7. **Tamper test.** From a second machine, host a copy of `moa.md` with
   one byte changed on a local HTTP server, point the installer at the
   local URL (or temporarily edit `releaseAssetURL` to a custom host and
   add it to `ALLOWED_HOSTS`), confirm the installer refuses with a
   `SHA256 mismatch` error and writes nothing to disk.

## Tagging

- The installer **always** pins to an immutable `vX.Y.Z` tag. The
  previous `latest` → `main` fallback has been removed. Tags must match
  `^v\d+\.\d+\.\d+(-[\w.]+)?$` (validated in the installer).
- Pre-release tags (`v1.3.0-rc.1`) are fine; npm will mark them as
  pre-releases automatically.

## Required permissions on the GitHub org

The release workflow needs two permissions:

- `id-token: write` — required for OIDC token issuance to Sigstore.
  If your org blocks OIDC → Sigstore, fall back to a long-lived public key
  committed to the repo and replace `cosign sign-blob` with
  `cosign sign-blob --key cosign.pub`.
- `contents: write` — required to upload release assets.

If the OIDC integration is blocked, the release CI will fail at the
`cosign sign-blob` step and no release assets will be uploaded. This is
intentional — we do not want to ship a release whose integrity cannot be
verified by end users.

## Emergency: re-signing a release

If a tag was published before the signing infra was enabled, or if the
`.pem` was lost, you can re-sign from the tag's commit:

```bash
git checkout v1.2.7
cd commands
sha256sum moa.md > ../SHA256SUMS
cd ..
COSIGN_EXPERIMENTAL=1 cosign sign-blob --yes \
  --output-signature SHA256SUMS.sig \
  --output-certificate SHA256SUMS.pem \
  SHA256SUMS
```

Then upload the three files with `gh release upload v1.2.7 SHA256SUMS SHA256SUMS.sig SHA256SUMS.pem`.

## `--skip-signature` (escape hatch)

The installer accepts `--skip-signature`, which disables the cosign /
`gh attestation` check but still verifies the SHA-256 of `moa.md` against
`SHA256SUMS`. This is provided for CI smoke tests where installing
`cosign` is impractical; it is **not** advertised to end-users and is
**not** a substitute for full signature verification. The installer logs
a clear warning when this flag is used.