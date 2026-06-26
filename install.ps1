#!/usr/bin/env pwsh
#
# opencode-moa-fusion — Interactive installer (Windows / PowerShell)
#
# Usage:
#   irm https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.ps1 | iex
#   .\install.ps1
#
# Requires PowerShell 5.1+ (Windows 10+) or PowerShell 7+. The interactive
# multi-select renderer uses ANSI escape sequences and the modern terminal
# input mode — both are supported by Windows Terminal, Windows PowerShell on
# Windows 10+, and pwsh on every supported platform.

$ErrorActionPreference = "Stop"

# Ensure Node.js is installed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js is required but not installed." -ForegroundColor Red
    exit 1
}

# Ensure npm is installed
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Error: npm is required but not installed." -ForegroundColor Red
    exit 1
}

# Embedded Node.js installer. Mirrors the script in install.sh — keep both in
# sync. We use a single-quoted here-string so PowerShell does no variable
# expansion or escaping inside; the JS source is passed to node verbatim.
$nodeScript = @'
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const readline = require("readline");

// Helpers for terminal
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

const MOA_MD_BASE_URL = "https://raw.githubusercontent.com/raultov/opencode-moa-fusion";

// Download a file from the given URL to a local path. Follows up to 5
// redirects (raw.githubusercontent.com sometimes 301s). Used for both
// commands/moa.md and src/install-merge-config.mjs.
function downloadToFile(url, destPath) {
    const https = require("https");
    const http = require("http");
    return new Promise((resolve, reject) => {
        const get = (target, redirects) => {
            if (redirects > 5) return reject(new Error("Too many redirects"));
            const lib = target.startsWith("https") ? https : http;
            lib.get(target, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return get(res.headers.location, redirects + 1);
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

// Fetch commands/moa.md from GitHub for the given version tag (or main if latest).
// Returns the file contents as a string.
function fetchMoaMd(version) {
    const ref = version === "latest" ? "main" : `v${version}`;
    const url = `${MOA_MD_BASE_URL}/${ref}/commands/moa.md`;
    const tmpPath = path.join(require("os").tmpdir(), `opencode-moa-fusion-moa-${Date.now()}.md`);
    return downloadToFile(url, tmpPath).then(
        () => fs.readFileSync(tmpPath, "utf-8"),
        (err) => Promise.reject(err),
    ).finally(() => {
        try { fs.unlinkSync(tmpPath); } catch {}
    });
}

async function runCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = cp.spawn(cmd, args, { stdio: "inherit", shell: true });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command ${cmd} exited with ${code}`));
        });
    });
}

async function captureCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        let out = "";
        const proc = cp.spawn(cmd, args, { shell: true });
        proc.stdout.on("data", d => out += d.toString());
        proc.on("close", (code) => {
            if (code === 0) resolve(out.trim());
            else reject(new Error(`Command ${cmd} exited with ${code}`));
        });
    });
}

function getOpencodeModels() {
    try {
        // Use stdio option to silence stderr portably (no shell redirection).
        const out = cp.execSync("opencode models", { stdio: ["ignore", "pipe", "ignore"] }).toString();
        const models = out.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && l.includes("/"));
        return models;
    } catch (e) {
        return [];
    }
}

// Minimal interactive multiselect prompt
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

            process.stdout.write("\x1B[2J\x1B[0;0H"); // clear screen
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

// Scope Prompt
async function scopePrompt() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });

        process.stdout.write(`\n${C.bold}${C.blue}opencode-moa-fusion — Interactive Installer${C.reset}\n\n`);
        process.stdout.write(`Where should the plugin and /moa command be installed?\n`);
        process.stdout.write(`  ${C.green}1)${C.reset} Local  — current project  (./.opencode/)\n`);
        process.stdout.write(`  ${C.green}2)${C.reset} Global — current user     (~/.config/opencode/)\n`);
        process.stdout.write(`  ${C.yellow}ESC / q)${C.reset} Cancel\n\n`);
        process.stdout.write("Choice: ");

        process.stdin.setRawMode(true);
        process.stdin.once("keypress", (str, key) => {
            process.stdin.setRawMode(false);
            process.stdout.write(str + "\n\n");
            rl.close();

            if (str === "1") resolve("local");
            else if (str === "2") resolve("global");
            else process.exit(0);
        });
    });
}

async function main() {
    // On Unix-like systems, when input is piped (curl | bash), we must explicitly
    // request the TTY for interactive prompts to work. On Windows the equivalent
    // entry point is PowerShell `irm | iex`, which does NOT pipe stdin to the
    // executed script, so process.stdin/stdout are already the terminal.
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

    if (process.platform === "win32" && (!process.stdout.isTTY || !process.stdin.isTTY)) {
        console.error("No TTY detected. Run the installer in an interactive terminal,");
        console.error("for example: irm https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.ps1 -OutFile install.ps1; .\\install.ps1");
        process.exit(1);
    }

    const scope = await scopePrompt();

    console.log(`${C.blue}Fetching latest version of opencode-moa-fusion from npm...${C.reset}`);
    let version = "latest";
    try {
        version = await captureCommand("npm", ["view", "opencode-moa-fusion", "version"]);
        console.log(`${C.green}Found version ${version}${C.reset}`);
    } catch (e) {
        console.log(`${C.yellow}Failed to fetch version from npm, defaulting to 'latest'${C.reset}`);
    }

    const isGlobal = scope === "global";

    let configPath = "";
    let cmdDir = "";

    if (isGlobal) {
        // os.homedir() works on Linux, macOS and Windows. opencode follows the
        // XDG convention on all platforms (~/.config/opencode/...).
        const os = require("os");
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

    // Update opencode.json. We delegate the read/backup/merge/write to a
    // self-contained merge script downloaded from the same release tag, so
    // that the logic is testable and never silently clobbers a malformed
    // file (see src/install-merge-config.mjs and the install-merge-config
    // unit tests in tests/).
    const ref = version === "latest" ? "main" : `v${version}`;
    const mergeScriptUrl = `${MOA_MD_BASE_URL}/${ref}/src/install-merge-config.mjs`;
    const os = require("os");
    const mergeScriptPath = path.join(
        os.tmpdir(),
        `opencode-moa-fusion-merge-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
    );

    console.log(`\n${C.blue}Downloading merge-config script from ${ref}...${C.reset}`);
    try {
        await downloadToFile(mergeScriptUrl, mergeScriptPath);
    } catch (e) {
        console.error(`${C.red}Failed to download merge-config script: ${e.message}${C.reset}`);
        console.error(`${C.yellow}Your existing opencode.json was NOT modified.${C.reset}`);
        process.exit(1);
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
        console.error(`${C.red}Failed to merge plugin entry into opencode.json: ${e.message}${C.reset}`);
        console.error(`${C.yellow}Your existing opencode.json was NOT modified.${C.reset}`);
        process.exit(1);
    } finally {
        try { fs.unlinkSync(mergeScriptPath); } catch {}
    }

    // Fetch /moa command from GitHub (single source of truth: commands/moa.md)
    console.log(`${C.blue}Fetching /moa command for ${ref}...${C.reset}`);
    let moaMd;
    try {
        moaMd = await fetchMoaMd(version);
    } catch (e) {
        console.error(`${C.yellow}Failed to download commands/moa.md: ${e.message}${C.reset}`);
        console.error(`${C.yellow}You can install it manually from: ${MOA_MD_BASE_URL}/${ref}/commands/moa.md${C.reset}`);
        process.exit(1);
    }
    fs.mkdirSync(cmdDir, { recursive: true });
    const cmdPath = path.join(cmdDir, "moa.md");
    fs.writeFileSync(cmdPath, moaMd);
    console.log(`${C.green}✓ Installed /moa command at ${cmdPath}${C.reset}\n`);

    console.log(`${C.bold}All done! Please restart OpenCode to use the /moa command.${C.reset}\n`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
'@

# Write the Node.js script to a temp file and execute it. We avoid `node -e`
# because PowerShell's argument quoting + node's eval string escaping make
# embedding ~300 lines of JS error-prone on Windows.
$tmpFile = Join-Path ([System.IO.Path]::GetTempPath()) ("opencode-moa-fusion-install-" + [System.Guid]::NewGuid().ToString() + ".js")
try {
    [System.IO.File]::WriteAllText($tmpFile, $nodeScript, [System.Text.UTF8Encoding]::new($false))
    & node $tmpFile
    $nodeExit = $LASTEXITCODE
} finally {
    if (Test-Path $tmpFile) {
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
    }
}

if ($nodeExit -ne 0) {
    exit $nodeExit
}
