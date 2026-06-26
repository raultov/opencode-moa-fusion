#!/usr/bin/env node
// src/install-merge-config.mjs
//
// Self-contained CLI that merges the opencode-moa-fusion plugin entry into
// the user's opencode.json. Invoked by install.sh / install.ps1 after they
// download this file from GitHub raw at install time (no npm install step).
//
// Usage:
//   node install-merge-config.mjs --config-path=<path> --plugin-spec=<spec> [--workers=<w1>,<w2>,...]
//
// Behavior:
//   - Reads <path> if it exists. Tolerates JSON5/JSONC (// and /* */ comments
//     and trailing commas) since opencode.json is commonly hand-edited.
//   - Refuses to overwrite if the file is not parseable. Never silently
//     clobbers a malformed file with a default.
//   - Backs up the existing file with a timestamped .bak.<iso> name BEFORE
//     writing, so the user can always recover the previous content.
//   - Adds the plugin entry (removing any previous opencode-moa-fusion
//     entry first, regardless of pinned version).
//   - Writes the new config (2-space indent, trailing newline).
//   - Prints progress to stdout. Exits 0 on success, 1 on failure.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PLUGIN_NAME = "opencode-moa-fusion";

function parseArgs(argv) {
  const args = {
    configPath: null,
    pluginSpec: null,
    workers: [],
  };
  for (const arg of argv) {
    if (arg.startsWith("--config-path=")) {
      args.configPath = arg.slice("--config-path=".length);
    } else if (arg.startsWith("--plugin-spec=")) {
      args.pluginSpec = arg.slice("--plugin-spec=".length);
    } else if (arg.startsWith("--workers=")) {
      args.workers = arg
        .slice("--workers=".length)
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);
    }
  }
  if (!args.configPath || !args.pluginSpec) {
    process.stderr.write(
      "Usage: node install-merge-config.mjs --config-path=<path> --plugin-spec=<spec> [--workers=<w1>,<w2>,...]\n",
    );
    process.exit(2);
  }
  return args;
}

// Strip // and /* */ comments and trailing commas to tolerate JSON5/JSONC.
// Intentionally minimal: it only handles the two comment styles and trailing
// commas, because opencode.json is documented as plain JSON and we do not
// want to encourage non-standard formatting. It is also string-aware so it
// does not eat a // that lives inside a JSON string.
function stripJsonc(input) {
  let out = "";
  let i = 0;
  const n = input.length;
  let inString = false;
  let stringQuote = "";
  while (i < n) {
    const c = input[i];
    const c2 = i + 1 < n ? input[i + 1] : "";
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < n) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (c === stringQuote) inString = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringQuote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && c2 === "/") {
      while (i < n && input[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n - 1 && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { cfg: {}, existed: false };
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  if (raw.trim() === "") {
    return { cfg: {}, existed: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (strictErr) {
    try {
      parsed = JSON.parse(stripJsonc(raw));
    } catch (looseErr) {
      throw new Error(
        `Could not parse ${configPath} as JSON or JSON-with-comments.\n` +
          `  Strict JSON error: ${strictErr.message}\n` +
          `  After stripping comments/trailing commas: ${looseErr.message}\n` +
          `Refusing to overwrite it. Fix the file manually and re-run the installer.`,
      );
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Refusing to overwrite ${configPath}: top-level value must be a JSON object.`,
    );
  }
  return { cfg: parsed, existed: true };
}

function mergePluginEntry(cfg, pluginSpec, workers) {
  if (!Array.isArray(cfg.plugin)) cfg.plugin = [];
  cfg.plugin = cfg.plugin.filter((p) => {
    if (typeof p === "string") return !p.startsWith(PLUGIN_NAME);
    if (Array.isArray(p) && typeof p[0] === "string") {
      return !p[0].startsWith(PLUGIN_NAME);
    }
    return true;
  });
  const pluginConfig = workers.length > 0 ? { workers } : {};
  if (Object.keys(pluginConfig).length === 0) {
    cfg.plugin.push(pluginSpec);
  } else {
    cfg.plugin.push([pluginSpec, pluginConfig]);
  }
  return cfg;
}

function backupConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.bak.${stamp}`;
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { configPath, pluginSpec, workers } = args;

  const { cfg, existed } = loadConfig(configPath);
  const existingKeys = Object.keys(cfg);
  process.stdout.write(`[install-merge-config] target: ${configPath}\n`);
  if (existed) {
    process.stdout.write(
      `[install-merge-config] existing top-level keys: ${existingKeys.length > 0 ? existingKeys.join(", ") : "(none)"}\n`,
    );
  } else {
    process.stdout.write(
      `[install-merge-config] file does not exist, will be created\n`,
    );
  }

  mergePluginEntry(cfg, pluginSpec, workers);

  if (existed) {
    const backupPath = backupConfig(configPath);
    if (backupPath) {
      process.stdout.write(`[install-merge-config] backup created: ${backupPath}\n`);
    }
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
  process.stdout.write(`[install-merge-config] wrote ${configPath}\n`);
  process.stdout.write(
    `[install-merge-config] final top-level keys: ${Object.keys(cfg).join(", ")}\n`,
  );
}

try {
  main();
} catch (e) {
  process.stderr.write(`[install-merge-config] ERROR: ${e.message}\n`);
  process.exit(1);
}
