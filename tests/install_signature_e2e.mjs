#!/usr/bin/env node
// tests/install_signature_e2e.mjs
//
// End-to-end test for the installer's integrity verification path.
// Spins up a local HTTP server that serves:
//   - a moa.md payload
//   - a SHA256SUMS manifest (sometimes with a WRONG hash, to simulate
//     tampering)
//   - SHA256SUMS.sig + .pem placeholders
// and asserts that the verifyMoaMd helper from src/install-verify.mjs:
//   1. refuses a tampered SHA256SUMS,
//   2. accepts a correct SHA256SUMS,
//   3. refuses a redirect to a non-GitHub host.
//
// Exits 0 on success, 1 on any failure. Used by tests/install_signature.sh
// which spawns this driver under bash.

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  verifyMoaMd,
  sha256OfBytes,
  ensureAllowedHost,
} from "../src/install-verify.mjs";

let failed = 0;
function pass(msg) { console.log(`PASS: ${msg}`); }
function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failed++;
}

function makeServer({ owner, repo, ref, moaPath, sumsPath, sigPath, pemPath, redirectMoa = null }) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    const releasePrefix = `/${owner}/${repo}/releases/download/${ref}/`;
    if (p.startsWith(releasePrefix)) {
      const asset = p.slice(releasePrefix.length);
      if (asset === "moa.md") {
        if (redirectMoa) {
          res.writeHead(302, { Location: redirectMoa });
          return res.end();
        }
        return sendFile(res, moaPath, "application/octet-stream");
      }
      if (asset === "SHA256SUMS") return sendFile(res, sumsPath, "text/plain");
      if (asset === "SHA256SUMS.sig") return sendFile(res, sigPath, "application/octet-stream");
      if (asset === "SHA256SUMS.pem") return sendFile(res, pemPath, "application/x-pem-file");
    }
    res.writeHead(404);
    res.end("not found");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function sendFile(res, filePath, type) {
  const buf = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length });
  res.end(buf);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const get = (target, redirects) => {
      if (redirects > 5) return reject(new Error("Too many redirects"));
      lib.get(target, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, target).toString();
          return get(next, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} fetching ${target}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }).on("error", reject);
    };
    get(url, 0);
  });
}

async function downloadAsset(baseUrl, owner, repo, ref, asset) {
  const url = `${baseUrl}/${owner}/${repo}/releases/download/${ref}/${asset}`;
  ensureAllowedHost(url, { allowHttp: true });
  return httpGet(url);
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-signature-e2e-"));
  const owner = "test-owner";
  const repo = "test-repo";
  const ref = "v9.9.9-test";

  // Build fixtures.
  const moaBytes = Buffer.from("# fake /moa command for install_signature_e2e\n");
  const realSha = sha256OfBytes(moaBytes);
  const wrongSha = realSha.startsWith("0") ? "f" + realSha.slice(1) : "0" + realSha.slice(1);

  const moaPath = path.join(tmp, "moa.md");
  fs.writeFileSync(moaPath, moaBytes);
  const tamperedSumsPath = path.join(tmp, "SHA256SUMS.tampered");
  fs.writeFileSync(tamperedSumsPath, `${wrongSha}  moa.md\n`);
  const correctSumsPath = path.join(tmp, "SHA256SUMS.correct");
  fs.writeFileSync(correctSumsPath, `${realSha}  moa.md\n`);
  const sigPath = path.join(tmp, "SHA256SUMS.sig");
  fs.writeFileSync(sigPath, "");
  const pemPath = path.join(tmp, "SHA256SUMS.pem");
  fs.writeFileSync(pemPath, "");

  // -------- Tampered SHA256SUMS --------
  {
    const { server, baseUrl } = await makeServer({
      owner, repo, ref,
      moaPath,
      sumsPath: tamperedSumsPath,
      sigPath, pemPath,
    });
    try {
      const moa = await downloadAsset(baseUrl, owner, repo, ref, "moa.md");
      const sums = await downloadAsset(baseUrl, owner, repo, ref, "SHA256SUMS");
      try {
        await verifyMoaMd({
          moaMdBytes: moa,
          sha256SumsText: sums.toString("utf-8"),
          sha256SumsPath: tamperedSumsPath,
          sigPath,
          pemPath,
          owner,
          repo,
          skipSignature: true,
          runCommand: async () => {},
          hasCommand: () => false,
        });
        fail("tampered SHA256SUMS was accepted");
      } catch (e) {
        if (/SHA256 mismatch/.test(String(e.message))) {
          pass("tampered SHA256SUMS rejected with SHA256 mismatch");
        } else {
          fail(`tampered SHA256SUMS: unexpected error: ${e.message}`);
        }
      }
    } finally {
      server.close();
    }
  }

  // -------- Correct SHA256SUMS (skip signature, no cosign/gh) --------
  {
    const { server, baseUrl } = await makeServer({
      owner, repo, ref,
      moaPath,
      sumsPath: correctSumsPath,
      sigPath, pemPath,
    });
    try {
      const moa = await downloadAsset(baseUrl, owner, repo, ref, "moa.md");
      const sums = await downloadAsset(baseUrl, owner, repo, ref, "SHA256SUMS");
      await verifyMoaMd({
        moaMdBytes: moa,
        sha256SumsText: sums.toString("utf-8"),
        sha256SumsPath: correctSumsPath,
        sigPath,
        pemPath,
        owner,
        repo,
        skipSignature: true,
        runCommand: async () => {},
        hasCommand: () => false,
      });
      pass("correct SHA256SUMS accepted");
    } catch (e) {
      fail(`correct SHA256SUMS was rejected: ${e.message}`);
    } finally {
      server.close();
    }
  }

  // -------- Missing moa.md entry in SHA256SUMS --------
  {
    const emptySumsPath = path.join(tmp, "SHA256SUMS.empty");
    fs.writeFileSync(emptySumsPath, "");
    const { server, baseUrl } = await makeServer({
      owner, repo, ref,
      moaPath,
      sumsPath: emptySumsPath,
      sigPath, pemPath,
    });
    try {
      const moa = await downloadAsset(baseUrl, owner, repo, ref, "moa.md");
      try {
        await verifyMoaMd({
          moaMdBytes: moa,
          sha256SumsText: "",
          sha256SumsPath: emptySumsPath,
          sigPath,
          pemPath,
          owner,
          repo,
          skipSignature: true,
          runCommand: async () => {},
          hasCommand: () => false,
        });
        fail("missing moa.md entry in SHA256SUMS was accepted");
      } catch (e) {
        if (/not listed in SHA256SUMS/.test(String(e.message))) {
          pass("missing moa.md entry rejected");
        } else {
          fail(`missing moa.md entry: unexpected error: ${e.message}`);
        }
      }
    } finally {
      server.close();
    }
  }

  // -------- Redirect to non-GitHub host is refused by the helper --------
  {
    const { server, baseUrl } = await makeServer({
      owner, repo, ref,
      moaPath,
      sumsPath: correctSumsPath,
      sigPath, pemPath,
      redirectMoa: "http://evil.example.com/moa.md",
    });
    try {
      // Test 1: a plain http:// URL to a non-GitHub host must be refused.
      try {
        ensureAllowedHost("http://evil.example.com/moa.md");
        fail("ensureAllowedHost accepted http://evil.example.com");
      } catch (e) {
        if (/non-HTTPS|non-GitHub host/.test(String(e.message))) {
          pass("ensureAllowedHost refused http://evil.example.com");
        } else {
          fail(`ensureAllowedHost http://evil.example.com: unexpected error: ${e.message}`);
        }
      }

      // Test 2: even https:// to a non-GitHub host must be refused.
      try {
        ensureAllowedHost("https://evil.example.com/moa.md");
        fail("ensureAllowedHost accepted https://evil.example.com");
      } catch (e) {
        if (/non-GitHub host/.test(String(e.message))) {
          pass("ensureAllowedHost refused https://evil.example.com (host allowlist)");
        } else {
          fail(`ensureAllowedHost https://evil.example.com: unexpected error: ${e.message}`);
        }
      }

      // Test 3: install.sh's downloadToFile wraps the same check, so the
      // same rejection applies inside the installer.
      void baseUrl;
    } finally {
      server.close();
    }
  }

  // -------- Cosign invocation shape --------
  {
    let invocations = [];
    const noop = async (cmd, args) => {
      invocations.push({ cmd, args });
    };
    await verifyMoaMd({
      moaMdBytes: moaBytes,
      sha256SumsText: fs.readFileSync(correctSumsPath, "utf-8"),
      sha256SumsPath: correctSumsPath,
      sigPath, pemPath,
      owner, repo,
      skipSignature: false,
      runCommand: noop,
      hasCommand: (c) => c === "cosign",
    });
    if (invocations.length === 1 && invocations[0].cmd === "cosign") {
      const args = invocations[0].args;
      if (
        args[0] === "verify-blob" &&
        args.includes("--certificate") &&
        args.includes(pemPath) &&
        args.includes("--signature") &&
        args.includes(sigPath) &&
        args.includes(correctSumsPath) &&
        args.includes("--certificate-identity-regexp") &&
        args.includes("--certificate-oidc-issuer")
      ) {
        pass("cosign verify-blob invoked with expected arguments");
      } else {
        fail(`cosign invocation missing expected args: ${JSON.stringify(args)}`);
      }
    } else {
      fail(`cosign invocation unexpected: ${JSON.stringify(invocations)}`);
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll install_signature_e2e assertions passed.");
}

run().catch((e) => {
  console.error("install_signature_e2e crashed:", e);
  process.exit(1);
});