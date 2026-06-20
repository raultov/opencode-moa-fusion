#!/usr/bin/env bash
#
# opencode-moa-fusion — Interactive installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.sh | bash
#   ./install.sh

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

# Ensure Node.js is installed
if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is required but not installed." >&2
    exit 1
fi

# Ensure npm is installed
if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is required but not installed." >&2
    exit 1
fi

# Export args to use them inside node
export INSTALL_ARGS="$*"

# Execute embedded Node.js script
node -e '
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
  gray: "\x1b[90m"
};

const MOA_MD = `---
description: Fan out a prompt to multiple worker models in parallel using moa_fusion and synthesize a unified answer
---

# /moa — Mixture-of-Agents

You **MUST** invoke the \`moa_fusion\` tool with the request below. Do not answer
the request yourself: fan it out to the configured worker models first, then
synthesize a single unified answer from their outputs.

## Rules

1. **Always call \`moa_fusion\`** as the very first action. Do not attempt to
   answer the request from your own knowledge before consulting the workers.
2. Pass the user'"'"'s request verbatim as the \`prompt\` argument.
3. If the user mentions specific worker models (e.g. \`google/gemini-2.5-pro\`),
   pass them as the \`workers\` argument. Otherwise, omit \`workers\` so the
   plugin defaults from \`opencode.json\` are used.
4. Once the tool returns the labelled worker outputs, **synthesize** a single
   coherent answer:
   - Treat consensus across workers as authoritative.
   - Discard claims unique to one worker that no other corroborates.
   - **Never** mention the workers, their model names, or this synthesis step
     in your final answer to the user.

## Request

$ARGUMENTS
`;

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
        const out = cp.execSync("opencode models 2>/dev/null").toString();
        const models = out.split("\n").map(l => l.trim()).filter(l => l.length > 0 && l.includes("/"));
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
    // If input is piped (curl | bash), we must explicitly request the TTY
    // for interactive prompts to work
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
        try {
            const fs = require("fs");
            const tty = require("tty");
            
            const ttyFd = fs.openSync("/dev/tty", "r+");
            const ttyReadStream = new tty.ReadStream(ttyFd);
            const ttyWriteStream = new tty.WriteStream(ttyFd);
            
            // Override standard streams for the interactive parts
            Object.defineProperty(process, "stdin", { value: ttyReadStream });
            Object.defineProperty(process, "stdout", { value: ttyWriteStream });
        } catch (e) {
            console.error("No TTY available. Cannot run interactive installer.");
            process.exit(1);
        }
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

    // Configure opencode.json
    // Note: OpenCode resolves plugins from npm automatically and caches them
    // under ~/.cache/opencode/packages/. No local npm install is needed.
    let configPath = "";
    let cmdDir = "";

    if (isGlobal) {
        const home = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || "~", ".config");
        configPath = path.join(home, "opencode", "opencode.json");
        cmdDir = path.join(home, "opencode", "command");
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

    // Update opencode.json
    let cfg = { plugin: [] };
    if (fs.existsSync(configPath)) {
        try {
            cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            if (!Array.isArray(cfg.plugin)) cfg.plugin = [];
        } catch (e) {
            console.log(`${C.yellow}Warning: Existing opencode.json is not valid JSON. Starting fresh.${C.reset}`);
        }
    }

    const pluginSpec = `opencode-moa-fusion@${version}`;
    const pluginConfig = workers.length > 0 ? { workers } : {};

    // Remove existing opencode-moa-fusion entries
    cfg.plugin = cfg.plugin.filter(p => {
        if (typeof p === "string") return !p.startsWith("opencode-moa-fusion");
        if (Array.isArray(p) && typeof p[0] === "string") return !p[0].startsWith("opencode-moa-fusion");
        return true;
    });

    // Add new entry
    if (Object.keys(pluginConfig).length === 0) {
        cfg.plugin.push(pluginSpec);
    } else {
        cfg.plugin.push([pluginSpec, pluginConfig]);
    }

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`\n${C.green}✓ Updated ${configPath}${C.reset}`);

    // Write /moa command
    fs.mkdirSync(cmdDir, { recursive: true });
    const cmdPath = path.join(cmdDir, "moa.md");
    fs.writeFileSync(cmdPath, MOA_MD);
    console.log(`${C.green}✓ Installed /moa command at ${cmdPath}${C.reset}\n`);
    
    console.log(`${C.bold}All done! Please restart OpenCode to use the /moa command.${C.reset}\n`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
'
