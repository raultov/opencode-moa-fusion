#!/usr/bin/env bash
#
# opencode-moa-fusion — Interactive installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.sh | bash
#   ./install.sh
#
# Security: this installer verifies the integrity of the /moa command file
# (`commands/moa.md`) downloaded from the GitHub release page using:
#   1. SHA-256 checksum published alongside the release in `SHA256SUMS`.
#   2. Sigstore / cosign keyless signature on `SHA256SUMS`, verified with
#      either `cosign` or `gh attestation verify`.
#
# The ref is always pinned to an immutable tag (`v${version}`); the old
# `latest` → `main` fallback has been removed. Redirects are restricted to
# GitHub-controlled hosts only.
#
# Test flags (used by tests/install_signature.sh):
#   --owner=<login>             Override the GitHub owner (default: raultov).
#   --repo=<name>               Override the GitHub repo (default: opencode-moa-fusion).
#   --version=<semver>          Override the npm-resolved version.
#   --skip-signature            Skip cosign/gh attestation verification (still SHA256).
#   --download-base-url=<url>   Override the download base URL (test-only).

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

if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is required but not installed." >&2
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is required but not installed." >&2
    exit 1
fi

export INSTALL_ARGS="$*"

node -e '
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const readline = require("readline");
const os = require("os");
const crypto = require("crypto");

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  red: "\x1b[31m"
};

const DEFAULT_OWNER = "raultov";
const DEFAULT_REPO = "opencode-moa-fusion";
const ALLOWED_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
]);
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const TAG_RE = /^v\d+\.\d+\.\d+(-[\w.]+)?$/;

function die(msg, code = 1) {
    console.error(`${C.red}${msg}${C.reset}`);
    process.exit(code);
}

function ensureAllowedHost(url) {
    let u;
    try {
        u = new URL(url);
    } catch (e) {
        throw new Error(`Refusing to fetch invalid URL: ${url}`);
    }
    if (u.protocol !== "https:") {
        throw new Error(`Refusing to fetch non-HTTPS URL: ${url}`);
    }
    if (!ALLOWED_HOSTS.has(u.host)) {
        throw new Error(`Refusing to fetch URL with non-GitHub host: ${u.host}`);
    }
    return u;
}

function downloadToFile(url, destPath) {
    const https = require("https");
    const http = require("http");
    return new Promise((resolve, reject) => {
        const get = (target, redirects) => {
            if (redirects > 5) return reject(new Error("Too many redirects"));
            try {
                ensureAllowedHost(target);
            } catch (e) {
                return reject(e);
            }
            const lib = target.startsWith("https") ? https : http;
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
                const file = fs.createWriteStream(destPath);
                res.pipe(file);
                file.on("finish", () => file.close(() => resolve()));
                file.on("error", reject);
            }).on("error", reject);
        };
        get(url, 0);
    });
}

function commandExists(cmd) {
    try {
        cp.execFileSync(cmd, ["--version"], { stdio: "ignore" });
        return true;
    } catch (e) {
        return false;
    }
}

async function runCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = cp.spawn(cmd, args, { stdio: "inherit", shell: false });
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command ${cmd} exited with ${code}`));
        });
    });
}

async function captureCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        let out = "";
        let err = "";
        const proc = cp.spawn(cmd, args, { shell: false });
        proc.stdout.on("data", d => out += d.toString());
        proc.stderr.on("data", d => err += d.toString());
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code === 0) resolve(out.trim());
            else reject(new Error(`Command ${cmd} exited with ${code}: ${err.trim() || out.trim()}`));
        });
    });
}

function getOpencodeModels() {
    try {
        const out = cp.execSync("opencode models", { stdio: ["ignore", "pipe", "ignore"] }).toString();
        const models = out.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && l.includes("/"));
        return models;
    } catch (e) {
        return [];
    }
}

function releaseAssetURL(owner, repo, ref, asset, baseUrl) {
    if (!TAG_RE.test(ref)) {
        throw new Error(`Internal error: ref "${ref}" is not a valid immutable tag`);
    }
    if (baseUrl) {
        return `${baseUrl.replace(/\/+$/, "")}/${owner}/${repo}/releases/download/${ref}/${asset}`;
    }
    return `https://github.com/${owner}/${repo}/releases/download/${ref}/${asset}`;
}

function rawURL(owner, repo, ref, filePath, baseUrl) {
    if (!TAG_RE.test(ref)) {
        throw new Error(`Internal error: ref "${ref}" is not a valid immutable tag`);
    }
    if (baseUrl) {
        return `${baseUrl.replace(/\/+$/, "")}/${owner}/${repo}/${ref}/${filePath}`;
    }
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
}

function parseSha256Sums(text) {
    const out = new Map();
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
        if (m) out.set(m[2].trim(), m[1].toLowerCase());
    }
    return out;
}

function sha256OfBytes(buf) {
    return crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
}

async function verifyMoaMd(opts) {
    const { moaMdBytes, sha256SumsText, sigPath, pemPath, skipSignature, owner, repo, sha256SumsPath } = opts;

    const sums = parseSha256Sums(sha256SumsText);
    const expected = sums.get("moa.md");
    if (!expected) {
        throw new Error("moa.md is not listed in SHA256SUMS — refusing to install.");
    }
    const actual = sha256OfBytes(moaMdBytes);
    if (actual !== expected) {
        throw new Error(
            `SHA256 mismatch for moa.md: expected ${expected}, got ${actual}. ` +
            `The downloaded file has been tampered with or the SHA256SUMS file is wrong. Refusing to install.`
        );
    }
    console.log(`${C.green}  ✓ SHA-256 verified: ${actual}${C.reset}`);

    if (skipSignature) {
        console.log(`${C.yellow}  ! --skip-signature: SHA256SUMS signature NOT verified. Trusting TLS only.${C.reset}`);
        return;
    }

    const repoRegex = `^https://github\\.com/${owner}/${repo}/\\.github/workflows/release\\.yml@refs/tags/v`;
    const oidcIssuer = "https://token.actions.githubusercontent.com";

    if (commandExists("cosign")) {
        console.log(`${C.cyan}  · Verifying cosign signature...${C.reset}`);
        await runCommand("cosign", [
            "verify-blob",
            "--certificate", pemPath,
            "--signature", sigPath,
            "--certificate-identity-regexp", repoRegex,
            "--certificate-oidc-issuer", oidcIssuer,
            sha256SumsPath,
        ]);
        console.log(`${C.green}  ✓ cosign signature verified${C.reset}`);
        return;
    }
    if (commandExists("gh")) {
        console.log(`${C.cyan}  · Verifying with gh attestation...${C.reset}`);
        await runCommand("gh", [
            "attestation", "verify", sha256SumsPath,
            "--owner", owner,
        ]);
        console.log(`${C.green}  ✓ gh attestation verified${C.reset}`);
        return;
    }
    throw new Error(
        "Neither cosign nor gh CLI is installed. Install one to verify release integrity, " +
        "or rerun with --skip-signature (NOT RECOMMENDED — trusts TLS only)."
    );
}

function atomicWriteSync(finalPath, bytes) {
    const dir = path.dirname(finalPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${finalPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const fd = fs.openSync(tmpPath, "w");
    try {
        fs.writeSync(fd, bytes);
        try { fs.fsyncSync(fd); } catch (_e) { /* fsync may not be supported */ }
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, finalPath);
}

async function multiSelectPrompt(models) {
    if (models.length === 0) return [];

    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });

        let selected = new Set();
        let cursorY = 0;
        let filter = "";

        const render = () => {
            const filtered = models.filter(m => m.toLowerCase().includes(filter.toLowerCase()));
            if (cursorY >= filtered.length && filtered.length > 0) cursorY = filtered.length - 1;
            if (filtered.length === 0) cursorY = 0;

            let out = `\n${C.bold}Select worker models (Use arrows to move, SPACE to select, Enter to confirm, type to filter)${C.reset}\n`;
            out += `Filter: ${C.cyan}${filter}${C.reset}\n\n`;

            const maxVisible = 15;
            let startIdx = Math.max(0, cursorY - Math.floor(maxVisible / 2));
            let endIdx = Math.min(filtered.length, startIdx + maxVisible);

            if (endIdx - startIdx < maxVisible) {
                startIdx = Math.max(0, endIdx - maxVisible);
            }

            for (let i = startIdx; i < endIdx; i++) {
                const m = filtered[i];
                const isSelected = selected.has(m);
                const isHovered = i === cursorY;

                const prefix = isHovered ? `${C.cyan}>` : " ";
                const box = isSelected ? `${C.green}[x]${C.reset}` : "[ ]";

                out += `${prefix} ${box} ${m}${isHovered ? C.reset : ""}\n`;
            }
            if (filtered.length === 0) {
                out += `${C.gray}No models match filter.${C.reset}\n`;
            }
            out += `\n${C.gray}(Showing ${filtered.length} of ${models.length} models)${C.reset}\n`;

            process.stdout.write("\x1B[2J\x1B[0;0H");
            process.stdout.write(out);
        };

        const onKeypress = (str, key) => {
            const filtered = models.filter(m => m.toLowerCase().includes(filter.toLowerCase()));

            if (key.name === "return") {
                process.stdin.removeListener("keypress", onKeypress);
                rl.close();
                process.stdout.write("\n");
                resolve(Array.from(selected));
                return;
            }

            if (key.name === "up") {
                if (cursorY > 0) cursorY--;
            } else if (key.name === "down") {
                if (cursorY < filtered.length - 1) cursorY++;
            } else if (key.name === "space") {
                if (filtered.length > 0) {
                    const m = filtered[cursorY];
                    if (selected.has(m)) selected.delete(m);
                    else selected.add(m);
                }
            } else if (key.name === "backspace") {
                filter = filter.slice(0, -1);
            } else if (str && !key.ctrl && !key.meta && str.length === 1) {
                filter += str;
            } else if (key.ctrl && key.name === "c") {
                process.exit(1);
            }
            render();
        };

        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.on("keypress", onKeypress);
        render();
    });
}

async function scopePrompt() {
    return new Promise((resolve) => {
        process.stdout.write(`\n${C.bold}${C.blue}opencode-moa-fusion — Interactive Installer${C.reset}\n\n`);
        process.stdout.write(`Where should the plugin and the slash command be installed?\n`);
        process.stdout.write(`  ${C.green}1)${C.reset} Local  — current project  (./.opencode/)\n`);
        process.stdout.write(`  ${C.green}2)${C.reset} Global — current user     (~/.config/opencode/)\n`);
        process.stdout.write(`  ${C.yellow}q${C.reset}) Cancel\n\n`);

        const ask = () => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: true,
            });
            rl.question(`${C.bold}Choice (1 or 2): ${C.reset}`, (answer) => {
                rl.close();
                const v = (answer || "").trim().toLowerCase();
                if (v === "1" || v === "local") resolve("local");
                else if (v === "2" || v === "global") resolve("global");
                else if (v === "q" || v === "quit" || v === "cancel") process.exit(0);
                else {
                    process.stdout.write(`${C.red}Invalid choice "${answer}". Expected 1 or 2, or q to cancel.${C.reset}\n`);
                    ask();
                }
            });
        };
        ask();
    });
}

const DEFAULT_COMMAND_NAME = "moa";
const COMMAND_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function isValidCommandName(name) {
    return typeof name === "string" && COMMAND_NAME_RE.test(name);
}

function normalizeCommandName(input) {
    if (typeof input !== "string") return null;
    const trimmed = input.trim().toLowerCase().replace(/^\/+/, "");
    return isValidCommandName(trimmed) ? trimmed : null;
}

async function commandNamePrompt(defaultName) {
    const fallback = normalizeCommandName(defaultName) || DEFAULT_COMMAND_NAME;
    return new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const ask = () => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: true,
            });
            rl.on("close", () => {
                settle(fallback);
            });
            rl.question(`${C.bold}Slash command name${C.reset} ${C.gray}(Enter for ${fallback}): ${C.reset}`, (answer) => {
                if (answer === undefined) {
                    rl.close();
                    return;
                }
                const trimmed = answer.trim();
                if (trimmed === "") {
                    rl.close();
                    return;
                }
                const normalized = normalizeCommandName(trimmed);
                if (normalized) {
                    settle(normalized);
                    rl.close();
                    return;
                }
                process.stdout.write(`${C.red}Invalid command name "${trimmed}".${C.reset}\n`);
                process.stdout.write(`${C.gray}  Must start with a letter, then lowercase letters / digits / hyphens / underscores (1-32 chars, no slashes).${C.reset}\n`);
                rl.close();
                ask();
            });
        };
        ask();
    });
}

function parseInstallArgs(argv) {
    const opts = {
        skipSignature: false,
        versionOverride: null,
        owner: DEFAULT_OWNER,
        repo: DEFAULT_REPO,
        downloadBaseUrl: null,
        commandName: null,
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
        } else if (arg.startsWith("--command-name=")) {
            opts.commandName = arg.slice("--command-name=".length);
        }
    }
    return opts;
}

async function main() {
    const installArgs = parseInstallArgs(process.env.INSTALL_ARGS ? process.env.INSTALL_ARGS.split(/\s+/) : []);

    // When --download-base-url is set, extend the host allowlist with the
    // base URL host. This is test-only: end users never set this flag.
    if (installArgs.downloadBaseUrl) {
        try {
            const baseHost = new URL(installArgs.downloadBaseUrl).host;
            if (baseHost) ALLOWED_HOSTS.add(baseHost);
        } catch (e) {
            die(`Invalid --download-base-url: ${installArgs.downloadBaseUrl}`);
        }
    }

    if (process.platform !== "win32" && (!process.stdout.isTTY || !process.stdin.isTTY)) {
        try {
            const tty = require("tty");
            const ttyFd = fs.openSync("/dev/tty", "r+");
            const ttyReadStream = new tty.ReadStream(ttyFd);
            const ttyWriteStream = new tty.WriteStream(ttyFd);

            Object.defineProperty(process, "stdin", { value: ttyReadStream });
            Object.defineProperty(process, "stdout", { value: ttyWriteStream });
        } catch (e) {
            console.error("No TTY available. Cannot run interactive installer.");
            process.exit(1);
        }
    }

    const scope = await scopePrompt();

    let commandName;
    if (installArgs.commandName) {
        const normalized = normalizeCommandName(installArgs.commandName);
        if (!normalized) {
            die(`Invalid --command-name: "${installArgs.commandName}". Must start with a letter, then lowercase letters / digits / hyphens / underscores (1-32 chars, no slashes).`);
        }
        commandName = normalized;
        console.log(`${C.blue}Slash command: /${commandName}${C.reset}`);
    } else {
        commandName = await commandNamePrompt(DEFAULT_COMMAND_NAME);
    }

    let version;
    if (installArgs.versionOverride) {
        version = installArgs.versionOverride;
        if (typeof version !== "string" || version.length === 0 || version.length > 64 || !SEMVER_RE.test(version)) {
            die(`Invalid --version: "${version}". Expected semver like 1.2.7 or 1.3.0-rc.1.`);
        }
    } else {
        console.log(`${C.blue}Fetching latest version of opencode-moa-fusion from npm...${C.reset}`);
        try {
            const rawVersion = await captureCommand("npm", ["view", "opencode-moa-fusion", "version"]);
            if (typeof rawVersion !== "string" || rawVersion.length === 0 || rawVersion.length > 64 || !SEMVER_RE.test(rawVersion)) {
                die(`npm returned a non-semver version: "${rawVersion}". Refusing to install.`);
            }
            version = rawVersion;
            console.log(`${C.green}Found version ${version}${C.reset}`);
        } catch (e) {
            die(`Failed to fetch version from npm: ${e.message}\nRe-run with --version=<semver> if the registry is unreachable.`);
        }
    }

    const ref = `v${version}`;
    if (!TAG_RE.test(ref)) {
        die(`Internal error: computed ref "${ref}" is not a valid tag.`);
    }

    const isGlobal = scope === "global";

    let configPath = "";
    let cmdDir = "";

    if (isGlobal) {
        const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
        configPath = path.join(xdgConfig, "opencode", "opencode.json");
        cmdDir = path.join(xdgConfig, "opencode", "command");
    } else {
        configPath = path.join(process.cwd(), "opencode.json");
        cmdDir = path.join(process.cwd(), ".opencode", "command");
    }

    let workers = [];
    console.log(`\n${C.blue}Fetching available models...${C.reset}`);
    const models = getOpencodeModels();
    if (models.length > 0) {
        workers = await multiSelectPrompt(models);
    } else {
        console.log(`${C.yellow}Could not fetch models. You can add them to opencode.json manually later.${C.reset}`);
    }

    const mergeScriptUrl = rawURL(installArgs.owner, installArgs.repo, ref, "src/install-merge-config.mjs", installArgs.downloadBaseUrl);
    const mergeScriptPath = path.join(
        os.tmpdir(),
        `opencode-moa-fusion-merge-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
    );

    console.log(`\n${C.blue}Downloading merge-config script from tag ${ref}...${C.reset}`);
    try {
        await downloadToFile(mergeScriptUrl, mergeScriptPath);
    } catch (e) {
        die(`Failed to download merge-config script: ${e.message}`);
    }

    try {
        const pluginSpec = `opencode-moa-fusion@${version}`;
        const workersArg = workers.join(",");
        await runCommand("node", [
            mergeScriptPath,
            `--config-path=${configPath}`,
            `--plugin-spec=${pluginSpec}`,
            `--workers=${workersArg}`,
        ]);
        console.log(`\n${C.green}✓ Updated ${configPath}${C.reset}`);
    } catch (e) {
        die(`Failed to merge plugin entry into opencode.json: ${e.message}\nYour existing opencode.json was NOT modified.`);
    } finally {
        try { fs.unlinkSync(mergeScriptPath); } catch {}
    }

    console.log(`\n${C.blue}Downloading /${commandName} command for ${ref}...${C.reset}`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-moa-fusion-verify-"));
    const moaTmp = path.join(tmpDir, "moa.md");
    const sumsTmp = path.join(tmpDir, "SHA256SUMS");
    const sigTmp = path.join(tmpDir, "SHA256SUMS.sig");
    const pemTmp = path.join(tmpDir, "SHA256SUMS.pem");

    try {
        await Promise.all([
            downloadToFile(releaseAssetURL(installArgs.owner, installArgs.repo, ref, "moa.md", installArgs.downloadBaseUrl), moaTmp),
            downloadToFile(releaseAssetURL(installArgs.owner, installArgs.repo, ref, "SHA256SUMS", installArgs.downloadBaseUrl), sumsTmp),
            downloadToFile(releaseAssetURL(installArgs.owner, installArgs.repo, ref, "SHA256SUMS.sig", installArgs.downloadBaseUrl), sigTmp),
            downloadToFile(releaseAssetURL(installArgs.owner, installArgs.repo, ref, "SHA256SUMS.pem", installArgs.downloadBaseUrl), pemTmp),
        ]);

        const moaMdBytes = fs.readFileSync(moaTmp);
        const sha256SumsText = fs.readFileSync(sumsTmp, "utf-8");

        await verifyMoaMd({
            moaMdBytes,
            sha256SumsText,
            sha256SumsPath: sumsTmp,
            sigPath: sigTmp,
            pemPath: pemTmp,
            skipSignature: installArgs.skipSignature,
            owner: installArgs.owner,
            repo: installArgs.repo,
        });

        fs.mkdirSync(cmdDir, { recursive: true });
        const cmdPath = path.join(cmdDir, `${commandName}.md`);
        atomicWriteSync(cmdPath, moaMdBytes);
        console.log(`${C.green}✓ Installed /${commandName} command at ${cmdPath}${C.reset}\n`);
    } catch (e) {
        die(`Failed to install /${commandName} command: ${e.message}\n` +
            `No file was written to ${path.join(cmdDir, `${commandName}.md`)}.`);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }

    console.log(`${C.bold}All done! Please restart OpenCode to use the /${commandName} command.${C.reset}\n`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
'