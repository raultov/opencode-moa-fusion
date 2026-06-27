#!/usr/bin/env node
// src/install-verify.mjs
//
// Helpers used by install.sh / install.ps1 to verify the integrity of
// `commands/moa.md` downloaded from the GitHub release page.
//
// Why this file exists:
//   - It keeps the verification logic in one place (both installers share it).
//   - It's a pure-JS, no-transpile-needed module so we can ship it
//     alongside the installer and unit-test it under Bun.
//   - It's downloaded from the GitHub release tag by the installer at
//     install time (next to install-merge-config.mjs).
//
// The installer DOES verify this file's integrity indirectly: it's
// downloaded over HTTPS from raw.githubusercontent.com, which is in
// ALLOWED_HOSTS. The trust anchor is the cosign-signed SHA256SUMS file
// (which lists moa.md). Anything else — install-verify.mjs,
// install-merge-config.mjs — is on best-effort: HTTPS + redirect
// allowlist, no separate signature.

import crypto from "node:crypto";

// GitHub hosts we permit downloads from. Keep this list narrow — every
// additional host is an additional supply-chain attack surface.
export const ALLOWED_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
]);

const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const TAG_RE = /^v\d+\.\d+\.\d+(-[\w.]+)?$/;

/**
 * Throws if `url` is not https:// or not hosted on an allow-listed GitHub
 * domain. Returns the parsed URL on success.
 *
 * `allowHttp` is a test-only escape hatch that lets callers fetch from
 * `http://127.0.0.1` / `http://localhost` (used by the installer's E2E
 * tests). It must NOT be set by end-user callers.
 */
export function ensureAllowedHost(url, { allowHttp = false } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch (_e) {
    throw new Error(`Refusing to fetch invalid URL: ${url}`);
  }
  if (u.protocol !== "https:") {
    if (!(allowHttp && (u.protocol === "http:"))) {
      throw new Error(`Refusing to fetch non-HTTPS URL: ${url}`);
    }
    // allowHttp path: only permit 127.0.0.1 / localhost.
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      throw new Error(`Refusing to fetch http:// URL outside localhost: ${url}`);
    }
  }
  if (!ALLOWED_HOSTS.has(u.host)) {
    // Test-only escape: allow loopback when the caller opted into HTTP.
    if (!(allowHttp && (u.hostname === "127.0.0.1" || u.hostname === "localhost"))) {
      throw new Error(`Refusing to fetch URL with non-GitHub host: ${u.host}`);
    }
  }
  return u;
}

/**
 * Returns true if `version` looks like a valid semver string.
 * Used to validate `npm view ... version` output before interpolating
 * into URLs.
 */
export function isSemver(version) {
  return typeof version === "string" && SEMVER_RE.test(version);
}

/**
 * Returns true if `ref` looks like a valid immutable tag (`vX.Y.Z` or
 * `vX.Y.Z-prerelease`). Used to refuse branch names and `latest`.
 */
export function isValidTag(ref) {
  return typeof ref === "string" && TAG_RE.test(ref);
}

/**
 * Build a release-asset URL. Refuses non-tag inputs.
 *
 * `baseUrl` is a test-only override: when set, it replaces
 * `https://github.com` (and the redirect chain is skipped because the
 * caller points directly at a server it controls).
 */
export function releaseAssetURL({ owner, repo, ref, asset, baseUrl = null }) {
  if (!isValidTag(ref)) {
    throw new Error(`Refusing to build release URL for non-tag ref: "${ref}"`);
  }
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, "")}/${owner}/${repo}/releases/download/${ref}/${asset}`;
  }
  return `https://github.com/${owner}/${repo}/releases/download/${ref}/${asset}`;
}

/**
 * Build a raw.githubusercontent.com URL. Refuses non-tag inputs.
 *
 * `baseUrl` is a test-only override (see `releaseAssetURL`).
 */
export function rawURL({ owner, repo, ref, path: filePath, baseUrl = null }) {
  if (!isValidTag(ref)) {
    throw new Error(`Refusing to build raw URL for non-tag ref: "${ref}"`);
  }
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, "")}/${owner}/${repo}/${ref}/${filePath}`;
  }
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
}

/**
 * Parse a `sha256sum`-style manifest into a Map<filename>, sha256>.
 * Tolerates the optional `*` prefix that GNU sha256sum adds in binary
 * mode (e.g. `abc123  *moa.md`).
 */
export function parseSha256Sums(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m) out.set(m[2].trim(), m[1].toLowerCase());
  }
  return out;
}

/**
 * Compute SHA-256 of a byte buffer or string. Returns lowercase hex.
 */
export function sha256OfBytes(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf-8");
  return crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
}

/**
 * Compute SHA-256 of a file. Returns lowercase hex.
 */
export function sha256OfFile(filePath) {
  return sha256OfBytes(require("node:fs").readFileSync(filePath));
}

/**
 * Verify a downloaded moa.md payload against the SHA256SUMS manifest and
 * (unless `skipSignature`) the cosign signature on SHA256SUMS.
 *
 * `runCommand` is an async function that runs a child process given
 * (cmd, args) and rejects on non-zero exit. It's injected so this module
 * has no I/O dependencies of its own.
 *
 * Throws on any verification failure. Returns void on success.
 */
export async function verifyMoaMd({
  moaMdBytes,
  sha256SumsText,
  sha256SumsPath,
  sigPath,
  pemPath,
  owner,
  repo,
  skipSignature = false,
  runCommand,
  hasCommand,
}) {
  // 1. SHA-256 must match the entry for moa.md.
  const sums = parseSha256Sums(sha256SumsText);
  const expected = sums.get("moa.md");
  if (!expected) {
    throw new Error("moa.md is not listed in SHA256SUMS — refusing to install.");
  }
  const actual = sha256OfBytes(moaMdBytes);
  if (actual !== expected) {
    throw new Error(
      `SHA256 mismatch for moa.md: expected ${expected}, got ${actual}. ` +
        `The downloaded file has been tampered with or the SHA256SUMS file is wrong. Refusing to install.`,
    );
  }

  if (skipSignature) return;

  // 2. Signature verification.
  if (!runCommand || typeof runCommand !== "function") {
    throw new Error("verifyMoaMd: runCommand callback is required");
  }
  if (typeof hasCommand !== "function") {
    throw new Error("verifyMoaMd: hasCommand callback is required");
  }

  const repoRegex = `^https://github\\.com/${owner}/${repo}/\\.github/workflows/release\\.yml@refs/tags/v`;
  const oidcIssuer = "https://token.actions.githubusercontent.com";

  if (hasCommand("cosign")) {
    await runCommand("cosign", [
      "verify-blob",
      "--certificate", pemPath,
      "--signature", sigPath,
      "--certificate-identity-regexp", repoRegex,
      "--certificate-oidc-issuer", oidcIssuer,
      sha256SumsPath,
    ]);
    return;
  }
  if (hasCommand("gh")) {
    await runCommand("gh", [
      "attestation", "verify", sha256SumsPath,
      "--owner", owner,
    ]);
    return;
  }
  throw new Error(
    "Neither cosign nor gh CLI is installed. Install one to verify release integrity, " +
      "or set skipSignature=true (NOT RECOMMENDED — trusts TLS only).",
  );
}

/**
 * Parse the installer's CLI flags. Recognised:
 *   --skip-signature            Skip cosign/gh attestation verification.
 *   --version=<semver>          Override the npm-resolved version (used by tests).
 *   --owner=<login>             Override the GitHub owner (used by tests).
 *   --repo=<name>               Override the GitHub repo (used by tests).
 *   --download-base-url=<url>   Override the download base URL (test-only).
 *                               When set, the installer downloads from this
 *                               URL instead of github.com. The redirect host
 *                               allowlist is also relaxed for this origin.
 */
export function parseInstallArgs(argv) {
  const opts = {
    skipSignature: false,
    versionOverride: null,
    owner: null,
    repo: null,
    downloadBaseUrl: null,
    allowHttp: false,
  };
  for (const arg of argv) {
    if (arg === "--skip-signature") {
      opts.skipSignature = true;
    } else if (arg.startsWith("--version=")) {
      opts.versionOverride = arg.slice("--version=".length);
    } else if (arg.startsWith("--owner=")) {
      opts.owner = arg.slice("--owner=".length);
    } else if (arg.startsWith("--repo=")) {
      opts.repo = arg.slice("--repo=".length);
    } else if (arg.startsWith("--download-base-url=")) {
      opts.downloadBaseUrl = arg.slice("--download-base-url=".length);
    } else if (arg === "--allow-http") {
      opts.allowHttp = true;
    }
  }
  return opts;
}

/**
 * Atomic write: write `bytes` to a temp file in the same directory,
 * fsync, then rename to `finalPath`. Avoids partial files on disk if
 * the process is killed mid-write.
 */
export function atomicWriteSync({ finalPath, bytes, fs: fsMod = require("node:fs"), path: pathMod = require("node:path") }) {
  const dir = pathMod.dirname(finalPath);
  fsMod.mkdirSync(dir, { recursive: true });
  const tmpPath = `${finalPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const fd = fsMod.openSync(tmpPath, "w");
  try {
    fsMod.writeSync(fd, bytes);
    try { fsMod.fsyncSync(fd); } catch (_e) { /* fsync may not be supported on some FS */ }
  } finally {
    fsMod.closeSync(fd);
  }
  fsMod.renameSync(tmpPath, finalPath);
}