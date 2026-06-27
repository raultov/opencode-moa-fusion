#!/usr/bin/env node
// scripts/dev-install-server.mjs
//
// Stand-alone HTTP server that emulates the GitHub release layout enough to
// let install.sh / install.ps1 install the plugin from the local checkout.
//
// Usage:
//   node scripts/dev-install-server.mjs [--port=NNNN] [--version=vX.Y.Z]
//
// What it serves:
//   GET /<owner>/<repo>/releases/download/<ref>/moa.md
//   GET /<owner>/<repo>/releases/download/<ref>/SHA256SUMS
//   GET /<owner>/<repo>/releases/download/<ref>/SHA256SUMS.sig
//   GET /<owner>/<repo>/releases/download/<ref>/SHA256SUMS.pem
//   GET /<owner>/<repo>/<ref>/src/install-merge-config.mjs
//
// It also auto-generates a SHA256SUMS on disk so the installer can verify it
// (pass --skip-signature to skip the cosign/gh step; this server does NOT
// provide a real signature).

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const opts = { port: 0, version: null, owner: "raultov", repo: "opencode-moa-fusion", https: false };
  const takeValue = (i, name) => {
    const eq = argv[i].indexOf("=");
    if (eq >= 0) return argv[i].slice(eq + 1);
    if (i + 1 < argv.length) return argv[i + 1];
    throw new Error(`${name} requires a value (use --${name}=VALUE or --${name} VALUE)`);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--https") {
      opts.https = true;
    } else if (arg === "--port" || arg.startsWith("--port=")) {
      const v = takeValue(i, "port");
      opts.port = Number(v);
      if (arg === "--port") i++;
    } else if (arg === "--version" || arg.startsWith("--version=")) {
      opts.version = takeValue(i, "version");
      if (arg === "--version") i++;
    } else if (arg === "--owner" || arg.startsWith("--owner=")) {
      opts.owner = takeValue(i, "owner");
      if (arg === "--owner") i++;
    } else if (arg === "--repo" || arg.startsWith("--repo=")) {
      opts.repo = takeValue(i, "repo");
      if (arg === "--repo") i++;
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const REPO_ROOT = path.resolve(process.cwd());
const REF = opts.version || `v${JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")).version}`;

const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), "moa-dev-install-"));
const moaSrc = fs.readFileSync(path.join(REPO_ROOT, "commands", "moa.md"));
const moaSha = crypto.createHash("sha256").update(moaSrc).digest("hex");

const moaPath = path.join(STAGE, "moa.md");
const sumsPath = path.join(STAGE, "SHA256SUMS");
const sigPath = path.join(STAGE, "SHA256SUMS.sig");
const pemPath = path.join(STAGE, "SHA256SUMS.pem");
fs.writeFileSync(moaPath, moaSrc);
fs.writeFileSync(sumsPath, `${moaSha}  moa.md\n`);
fs.writeFileSync(sigPath, "");
fs.writeFileSync(pemPath, "");

function sendFile(res, filePath, type) {
  try {
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length });
    res.end(buf);
  } catch (e) {
    res.writeHead(500);
    res.end(`read error: ${e.message}`);
  }
}

const mergeScriptPath = path.join(REPO_ROOT, "src", "install-merge-config.mjs");

const handler = (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  const releasePrefix = `/${opts.owner}/${opts.repo}/releases/download/${REF}/`;
  const rawPrefix = `/${opts.owner}/${opts.repo}/${REF}/`;

  if (p.startsWith(releasePrefix)) {
    const asset = p.slice(releasePrefix.length);
    if (asset === "moa.md") return sendFile(res, moaPath, "application/octet-stream");
    if (asset === "SHA256SUMS") return sendFile(res, sumsPath, "text/plain");
    if (asset === "SHA256SUMS.sig") return sendFile(res, sigPath, "application/octet-stream");
    if (asset === "SHA256SUMS.pem") return sendFile(res, pemPath, "application/x-pem-file");
  }
  if (p.startsWith(rawPrefix)) {
    const relPath = p.slice(rawPrefix.length);
    const fullPath = path.join(REPO_ROOT, relPath);
    if (!fullPath.startsWith(REPO_ROOT)) {
      res.writeHead(403); return res.end("forbidden");
    }
    return sendFile(res, fullPath, "application/octet-stream");
  }

  res.writeHead(404);
  res.end(`not found: ${p}`);
};

let server;
let baseUrl;
let scheme;

if (opts.https) {
  const certPath = path.join(STAGE, "server.crt");
  const keyPath = path.join(STAGE, "server.key");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath,
    "-out", certPath,
    "-days", "1",
    "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
  ], { stdio: "ignore" });
  server = https.createServer({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  }, handler);
  scheme = "https";
} else {
  server = http.createServer(handler);
  scheme = "http";
}

server.listen(opts.port, "127.0.0.1", () => {
  const port = server.address().port;
  baseUrl = `${scheme}://127.0.0.1:${port}`;
  console.log(`[dev-install-server] serving repo=${opts.owner}/${opts.repo} ref=${REF}`);
  console.log(`[dev-install-server] base URL: ${baseUrl}`);
  console.log(`[dev-install-server] stage dir: ${STAGE}`);
  console.log(`[dev-install-server] moa.md sha256: ${moaSha}`);
  console.log("");
  console.log("Run the installer in another terminal:");
  console.log("");
  console.log(`  bash ${REPO_ROOT}/install.sh --skip-signature --download-base-url=${baseUrl} --owner=${opts.owner} --repo=${opts.repo} --version=${REF.slice(1)}`);
  console.log("");
  if (scheme === "https") {
    console.log(`NOTE: using a self-signed cert. NODE_TLS_REJECT_UNAUTHORIZED=0 is NOT needed because the installer's https.get does not perform cert verification by default — but if your TLS version is strict, set it.`);
  } else {
    console.log("NOTE: install.sh refuses plain HTTP. Re-run with --https for an HTTPS server.");
  }
  console.log("");
  console.log("Press Ctrl-C to stop.");
});

process.on("SIGINT", () => {
  console.log("\n[dev-install-server] shutting down");
  server.close();
  try { fs.rmSync(STAGE, { recursive: true, force: true }); } catch {}
  process.exit(0);
});