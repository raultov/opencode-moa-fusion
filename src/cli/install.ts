#!/usr/bin/env node
// src/cli/install.ts
//
// Interactive installer for opencode-moa-fusion. Shipped as the `bin` of
// this npm package. Invoked via:
//
//   npx opencode-moa-fusion@<version> [--command-name=<name>] [--scope=local|global]
//
// All env vars set on the npx invocation are inherited by `opencode models`
// transparently, so providers requiring API keys / custom base URLs work
// without special wiring.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import readline from "node:readline";
import { createRequire } from "node:module";
import { normalizeCommandName, DEFAULT_COMMAND_NAME } from "../commandName.js";

const require_ = createRequire(import.meta.url);
const pkg = require_("../../package.json") as { version: string };
const VERSION = pkg.version;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..", "..");
const MERGE_SCRIPT = path.join(PKG_ROOT, "src", "install-merge-config.mjs");
const MOA_MD_SOURCE = path.join(PKG_ROOT, "commands", "moa.md");

export const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
} as const;

function die(msg: string, code = 1): never {
  console.error(`${C.red}${msg}${C.reset}`);
  process.exit(code);
}

export interface InstallArgs {
  commandName: string | null;
  scope: "local" | "global" | null;
}

export function parseArgs(argv: string[]): InstallArgs {
  const opts: InstallArgs = { commandName: null, scope: null };
  for (const arg of argv) {
    if (arg.startsWith("--command-name=")) {
      opts.commandName = arg.slice("--command-name=".length);
    } else if (arg === "--scope=local") {
      opts.scope = "local";
    } else if (arg === "--scope=global") {
      opts.scope = "global";
    }
    // unknown flags are silently ignored for forward-compatibility
  }
  return opts;
}

function ensureInteractiveTTY(): void {
  if (process.platform === "win32") return;
  if (process.stdout.isTTY && process.stdin.isTTY) return;
  try {
    // node:tty is CJS; use createRequire to keep ESM happy
    const tty = require_("tty") as typeof import("tty");
    const ttyFd = fs.openSync("/dev/tty", "r+");
    const ttyRead = new tty.ReadStream(ttyFd);
    const ttyWrite = new tty.WriteStream(ttyFd);
    Object.defineProperty(process, "stdin", {
      value: ttyRead,
      configurable: true,
    });
    Object.defineProperty(process, "stdout", {
      value: ttyWrite,
      configurable: true,
    });
  } catch {
    console.error("No TTY available. Cannot run interactive installer.");
    process.exit(1);
  }
}

export function getOpencodeModels(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    const out = execSync("opencode models", {
      stdio: ["ignore", "pipe", "ignore"],
      env,
    }).toString();
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.includes("/"));
  } catch {
    return [];
  }
}

async function scopePrompt(): Promise<"local" | "global"> {
  return new Promise((resolve) => {
    process.stdout.write(
      `\n${C.bold}${C.blue}opencode-moa-fusion — Interactive Installer${C.reset}\n\n`,
    );
    process.stdout.write(
      `Where should the plugin and the slash command be installed?\n`,
    );
    process.stdout.write(
      `  ${C.green}1)${C.reset} Local  — current project  (./.opencode/)\n`,
    );
    process.stdout.write(
      `  ${C.green}2)${C.reset} Global — current user     (~/.config/opencode/)\n`,
    );
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
          process.stdout.write(
            `${C.red}Invalid choice "${answer}". Expected 1 or 2, or q to cancel.${C.reset}\n`,
          );
          ask();
        }
      });
    };
    ask();
  });
}

async function commandNamePrompt(defaultName: string): Promise<string> {
  const fallback =
    normalizeCommandName(defaultName) ?? DEFAULT_COMMAND_NAME;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: string) => {
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
      rl.on("close", () => settle(fallback));
      rl.question(
        `${C.bold}Slash command name${C.reset} ${C.gray}(Enter for ${fallback}): ${C.reset}`,
        (answer) => {
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
          process.stdout.write(
            `${C.red}Invalid command name "${trimmed}".${C.reset}\n`,
          );
          process.stdout.write(
            `${C.gray}  Must start with a letter, then lowercase letters / digits / hyphens / underscores (1-32 chars, no slashes).${C.reset}\n`,
          );
          rl.close();
          ask();
        },
      );
    };
    ask();
  });
}

async function multiSelectPrompt(models: string[]): Promise<string[]> {
  if (models.length === 0) return [];

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const selected = new Set<string>();
    let cursorY = 0;
    let filter = "";

    const render = () => {
      const filtered = models.filter((m) =>
        m.toLowerCase().includes(filter.toLowerCase()),
      );
      if (cursorY >= filtered.length && filtered.length > 0)
        cursorY = filtered.length - 1;
      if (filtered.length === 0) cursorY = 0;

      let out = `\n${C.bold}Select worker models (arrows=move, SPACE=select, Enter=confirm, type=filter)${C.reset}\n`;
      out += `Filter: ${C.cyan}${filter}${C.reset}\n\n`;

      const maxVisible = 15;
      let startIdx = Math.max(0, cursorY - Math.floor(maxVisible / 2));
      let endIdx = Math.min(filtered.length, startIdx + maxVisible);
      if (endIdx - startIdx < maxVisible) {
        startIdx = Math.max(0, endIdx - maxVisible);
      }

      for (let i = startIdx; i < endIdx; i++) {
        const m = filtered[i];
        const isSel = selected.has(m);
        const isHov = i === cursorY;
        const prefix = isHov ? `${C.cyan}>` : " ";
        const box = isSel ? `${C.green}[x]${C.reset}` : "[ ]";
        out += `${prefix} ${box} ${m}${isHov ? C.reset : ""}\n`;
      }
      if (filtered.length === 0) {
        out += `${C.gray}No models match filter.${C.reset}\n`;
      }
      out += `\n${C.gray}(Showing ${filtered.length} of ${models.length} models)${C.reset}\n`;

      process.stdout.write("\x1B[2J\x1B[0;0H");
      process.stdout.write(out);
    };

    const onKeypress = (str: string, key: readline.Key) => {
      const filtered = models.filter((m) =>
        m.toLowerCase().includes(filter.toLowerCase()),
      );

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
    type RawStream = NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    if (typeof (process.stdin as RawStream).setRawMode === "function") {
      (process.stdin as RawStream & { setRawMode: (mode: boolean) => void }).setRawMode(true);
    }
    process.stdin.on("keypress", onKeypress);
    render();
  });
}

export function atomicWriteSync(finalPath: string, bytes: Buffer): void {
  const dir = path.dirname(finalPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${finalPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, bytes);
    try {
      fs.fsyncSync(fd);
    } catch {
      // fsync may not be supported on all platforms
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, finalPath);
}

export async function runMergeConfig(
  configPath: string,
  pluginSpec: string,
  workers: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [
        MERGE_SCRIPT,
        `--config-path=${configPath}`,
        `--plugin-spec=${pluginSpec}`,
        `--workers=${workers.join(",")}`,
      ],
      { stdio: "inherit" },
    );
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`merge-config exited with code ${code}`));
    });
  });
}

export { MOA_MD_SOURCE, VERSION };

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Only invoke TTY fallback when interactive prompts are needed
  const needsInteraction = args.scope === null || args.commandName === null;
  if (needsInteraction) ensureInteractiveTTY();

  const scope: "local" | "global" =
    args.scope ?? (await scopePrompt());

  let commandName: string;
  if (args.commandName !== null) {
    const normalized = normalizeCommandName(args.commandName);
    if (!normalized) {
      die(
        `Invalid --command-name: "${args.commandName}". Must start with a letter, then lowercase letters / digits / hyphens / underscores (1-32 chars, no slashes).`,
      );
    }
    commandName = normalized;
    if (args.scope !== null) {
      // fully non-interactive: skip the header that scopePrompt would print
      console.log(
        `${C.blue}Scope: ${scope} | Slash command: /${commandName}${C.reset}`,
      );
    } else {
      console.log(`${C.blue}Slash command: /${commandName}${C.reset}`);
    }
  } else {
    commandName = await commandNamePrompt(DEFAULT_COMMAND_NAME);
  }

  const xdgConfig =
    process.env["XDG_CONFIG_HOME"] ??
    path.join(os.homedir(), ".config");
  const configPath =
    scope === "global"
      ? path.join(xdgConfig, "opencode", "opencode.json")
      : path.join(process.cwd(), "opencode.json");
  const cmdDir =
    scope === "global"
      ? path.join(xdgConfig, "opencode", "command")
      : path.join(process.cwd(), ".opencode", "command");

  console.log(`\n${C.blue}Fetching available models...${C.reset}`);
  const models = getOpencodeModels();
  let workers: string[];
  if (models.length > 0) {
    workers = await multiSelectPrompt(models);
  } else {
    console.log(
      `${C.yellow}Could not fetch models. You can add them to opencode.json manually later.${C.reset}`,
    );
    workers = [];
  }

  console.log(`\n${C.blue}Merging plugin entry...${C.reset}`);
  try {
    await runMergeConfig(
      configPath,
      `opencode-moa-fusion@${VERSION}`,
      workers,
    );
    console.log(`\n${C.green}✓ Updated ${configPath}${C.reset}`);
  } catch (e) {
    die(
      `Failed to merge plugin entry into opencode.json: ${(e as Error).message}\nYour existing opencode.json was NOT modified.`,
    );
  }

  console.log(`\n${C.blue}Installing /${commandName} command...${C.reset}`);
  try {
    const cmdPath = path.join(cmdDir, `${commandName}.md`);
    atomicWriteSync(cmdPath, fs.readFileSync(MOA_MD_SOURCE));
    console.log(
      `${C.green}✓ Installed /${commandName} command at ${cmdPath}${C.reset}\n`,
    );
  } catch (e) {
    die(
      `Failed to install /${commandName} command: ${(e as Error).message}`,
    );
  }

  console.log(
    `${C.bold}All done! Please restart OpenCode to use the /${commandName} command.${C.reset}\n`,
  );
}

// Only run when executed directly, not when imported by tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`${C.red}${(err as Error).message ?? err}${C.reset}`);
    process.exit(1);
  });
}
