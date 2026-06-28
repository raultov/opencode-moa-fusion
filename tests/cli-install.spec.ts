import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  atomicWriteSync,
  getExistingWorkers,
  getOpencodeModels,
  MOA_MD_SOURCE,
  parseArgs,
  runMergeConfig,
  VERSION,
} from "../src/cli/install.js";
import { normalizeCommandName } from "../src/commandName.js";

// ── parseArgs ─────────────────────────────────────────────────────────────────

describe("parseArgs [Unit]", () => {
  it("Given no args Then returns null commandName and null scope", () => {
    expect(parseArgs([])).toEqual({ commandName: null, scope: null });
  });

  it("Given --command-name=team Then returns commandName 'team'", () => {
    expect(parseArgs(["--command-name=team"])).toEqual({
      commandName: "team",
      scope: null,
    });
  });

  it("Given --scope=local Then returns scope 'local'", () => {
    expect(parseArgs(["--scope=local"])).toEqual({
      commandName: null,
      scope: "local",
    });
  });

  it("Given --scope=global Then returns scope 'global'", () => {
    expect(parseArgs(["--scope=global"])).toEqual({
      commandName: null,
      scope: "global",
    });
  });

  it("Given both flags Then returns both values", () => {
    expect(parseArgs(["--command-name=council", "--scope=global"])).toEqual({
      commandName: "council",
      scope: "global",
    });
  });

  it("Given unknown flag Then ignores it silently", () => {
    expect(parseArgs(["--unknown=foo", "--command-name=moa"])).toEqual({
      commandName: "moa",
      scope: null,
    });
  });

  it("Given --command-name with uppercase Then stores raw value (validation happens later)", () => {
    // parseArgs stores raw; normalizeCommandName is called in main()
    expect(parseArgs(["--command-name=Council"])).toEqual({
      commandName: "Council",
      scope: null,
    });
  });
});

// ── normalizeCommandName (via commandName.ts, used by install.ts) ─────────────

describe("normalizeCommandName [Unit] (used by installer)", () => {
  it("Given '/team' Then strips slash and returns 'team'", () => {
    expect(normalizeCommandName("/team")).toBe("team");
  });

  it("Given 'MOA' Then lowercases and returns 'moa'", () => {
    expect(normalizeCommandName("MOA")).toBe("moa");
  });

  it("Given a 33-char string Then returns null (too long)", () => {
    expect(normalizeCommandName("a".repeat(33))).toBeNull();
  });

  it("Given 'Council' (uppercase) Then returns null after normalization", () => {
    // 'Council' → trim → lowercase → 'council' → valid
    expect(normalizeCommandName("Council")).toBe("council");
  });

  it("Given '3invalid' (starts with digit) Then returns null", () => {
    expect(normalizeCommandName("3invalid")).toBeNull();
  });
});

// ── getOpencodeModels env propagation ─────────────────────────────────────────

describe("getOpencodeModels [Unit] (env propagation)", () => {
  let tmpDir: string;
  let origPath: string | undefined;
  let origToken: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-test-models-"));
    origPath = process.env.PATH;
    origToken = process.env.MOA_TEST_TOKEN;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origPath !== undefined) process.env.PATH = origPath;
    if (origToken === undefined) delete process.env.MOA_TEST_TOKEN;
    else process.env.MOA_TEST_TOKEN = origToken;
  });

  it("Given a fake opencode binary that echoes an env var When getOpencodeModels is called Then the env var is inherited", () => {
    // fake opencode outputs a line with "/" so it passes the model filter
    const fakeScript = path.join(tmpDir, "opencode");
    fs.writeFileSync(fakeScript, `#!/bin/sh\necho "provider/$MOA_TEST_TOKEN"\n`, { mode: 0o755 });
    const testEnv = {
      ...process.env,
      PATH: `${tmpDir}:${origPath ?? ""}`,
      MOA_TEST_TOKEN: "hello123",
    };
    const models = getOpencodeModels(testEnv);
    expect(models).toContain("provider/hello123");
  });

  it("Given opencode not in PATH or failing Then returns empty array", () => {
    // Point PATH to empty dir so opencode is not found
    const models = getOpencodeModels({ PATH: tmpDir });
    expect(models).toEqual([]);
  });

  it("Given opencode outputs lines without '/' Then filters them out", () => {
    const fakeScript = path.join(tmpDir, "opencode");
    fs.writeFileSync(fakeScript, `#!/bin/sh\necho "no-slash-here"\necho "a/b"\n`, {
      mode: 0o755,
    });
    const testEnv = { ...process.env, PATH: `${tmpDir}:${origPath ?? ""}` };
    const models = getOpencodeModels(testEnv);
    expect(models).not.toContain("no-slash-here");
    expect(models).toContain("a/b");
  });
});

// ── atomicWriteSync ───────────────────────────────────────────────────────────

describe("atomicWriteSync [Unit]", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-test-write-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Given a path with non-existent parent dirs Then creates dirs and writes file", () => {
    const target = path.join(tmpDir, "nested", "dir", "file.md");
    const data = Buffer.from("hello world");
    atomicWriteSync(target, data);
    expect(fs.readFileSync(target)).toEqual(data);
  });

  it("Given an existing file Then overwrites atomically", () => {
    const target = path.join(tmpDir, "file.md");
    fs.writeFileSync(target, "old content");
    atomicWriteSync(target, Buffer.from("new content"));
    expect(fs.readFileSync(target, "utf-8")).toBe("new content");
  });

  it("Given a write Then leaves no .tmp files behind", () => {
    const target = path.join(tmpDir, "file.md");
    atomicWriteSync(target, Buffer.from("data"));
    const entries = fs.readdirSync(tmpDir);
    expect(entries.filter((e) => e.includes(".tmp"))).toHaveLength(0);
  });
});

// ── getExistingWorkers ────────────────────────────────────────────────────────

describe("getExistingWorkers [Unit]", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-test-existing-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Given a non-existent config path Then returns an empty array", () => {
    const result = getExistingWorkers(path.join(tmpDir, "missing.json"));
    expect(result).toEqual([]);
  });

  it("Given an empty file Then returns an empty array", () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(configPath, "");
    expect(getExistingWorkers(configPath)).toEqual([]);
  });

  it("Given a config with a moa-fusion [spec, config] entry Then returns its workers", () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        plugin: [["opencode-moa-fusion@1.0.0", { workers: ["a/b", "c/d"] }]],
      }),
    );
    expect(getExistingWorkers(configPath)).toEqual(["a/b", "c/d"]);
  });

  it("Given a bare moa-fusion plugin string (no config) Then returns an empty array", () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(configPath, JSON.stringify({ plugin: ["opencode-moa-fusion@1.0.0"] }));
    expect(getExistingWorkers(configPath)).toEqual([]);
  });

  it("Given a moa-fusion entry with a config object but no workers key Then returns an empty array", () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        plugin: [["opencode-moa-fusion@1.0.0", { other: true }]],
      }),
    );
    expect(getExistingWorkers(configPath)).toEqual([]);
  });

  it("Given a config without any moa-fusion entry Then returns an empty array", () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ plugin: [["some-other-plugin@1.0.0", { workers: ["x/y"] }]] }),
    );
    expect(getExistingWorkers(configPath)).toEqual([]);
  });

  it("Given a JSONC config with comments and trailing commas Then parses and returns workers", () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(
      configPath,
      `{
        // a comment
        "plugin": [
          ["opencode-moa-fusion@1.0.0", { "workers": ["a/b", "c/d"], }],
        ],
      }`,
    );
    expect(getExistingWorkers(configPath)).toEqual(["a/b", "c/d"]);
  });

  it("Given an unparseable config Then returns an empty array (does not throw)", () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(configPath, "{ this is not json");
    expect(getExistingWorkers(configPath)).toEqual([]);
  });

  it("Given a top-level array (not an object) Then returns an empty array", () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(configPath, JSON.stringify(["not", "an", "object"]));
    expect(getExistingWorkers(configPath)).toEqual([]);
  });

  it("Given a workers array with non-string entries Then filters them out", () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        plugin: [["opencode-moa-fusion@1.0.0", { workers: ["a/b", 42, null, "c/d"] }]],
      }),
    );
    expect(getExistingWorkers(configPath)).toEqual(["a/b", "c/d"]);
  });
});

// ── runMergeConfig + atomicWriteSync E2E (no TTY) ────────────────────────────

describe("E2E install flow [Integration] (no TTY, no internet)", () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-test-e2e-"));
    origCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Given existing opencode.json with plugins When runMergeConfig is called Then merges correctly and creates backup", async () => {
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        plugin: [["other-plugin@1.0.0", { workers: ["x/y"] }]],
      }),
    );

    await runMergeConfig(configPath, `opencode-moa-fusion@${VERSION}`, [
      "anthropic/claude-3-5-haiku-latest",
    ]);

    const result = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    // moa-fusion entry is appended
    const moaEntry = result.plugin.find(
      (p: unknown) => Array.isArray(p) && (p as string[])[0]?.startsWith("opencode-moa-fusion"),
    );
    expect(moaEntry).toBeDefined();
    expect((moaEntry as string[])[0]).toBe(`opencode-moa-fusion@${VERSION}`);
    expect((moaEntry as [string, { workers: string[] }])[1].workers).toEqual([
      "anthropic/claude-3-5-haiku-latest",
    ]);
    // other-plugin is preserved
    expect(result.plugin).toHaveLength(2);
    // backup created
    const backups = fs.readdirSync(tmpDir).filter((f) => f.includes(".bak."));
    expect(backups).toHaveLength(1);
  });

  it("Given no existing opencode.json When runMergeConfig is called Then creates it with plugin entry", async () => {
    const configPath = path.join(tmpDir, "opencode.json");
    await runMergeConfig(configPath, `opencode-moa-fusion@${VERSION}`, []);

    const result = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(result.plugin).toHaveLength(1);
    // no workers → bare string entry
    expect(result.plugin[0]).toBe(`opencode-moa-fusion@${VERSION}`);
    // no backup when file didn't exist before
    const backups = fs.readdirSync(tmpDir).filter((f) => f.includes(".bak."));
    expect(backups).toHaveLength(0);
  });

  it("Given a merge and command install When atomicWriteSync copies moa.md Then file contents match source", () => {
    const cmdDir = path.join(tmpDir, ".opencode", "command");
    const cmdPath = path.join(cmdDir, "testcmd.md");
    atomicWriteSync(cmdPath, fs.readFileSync(MOA_MD_SOURCE));

    expect(fs.existsSync(cmdPath)).toBe(true);
    expect(fs.readFileSync(cmdPath)).toEqual(fs.readFileSync(MOA_MD_SOURCE));
  });
});

// ── Full subprocess smoke test (uses dist/cli/install.js) ────────────────────

describe("CLI subprocess smoke test [E2E]", () => {
  let tmpDir: string;
  const distCli = path.resolve(import.meta.dir, "..", "dist", "cli", "install.js");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-test-smoke-"));
    fs.writeFileSync(path.join(tmpDir, "opencode.json"), JSON.stringify({ plugin: [] }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Given --scope=local and --command-name=smoketest When run in tmpdir Then creates expected files", () => {
    // Runs fully non-interactive: no TTY prompts, no model fetch (opencode not in PATH)
    execSync(`"${process.execPath}" "${distCli}" --scope=local --command-name=smoketest`, {
      cwd: tmpDir,
      env: { ...process.env, PATH: "" }, // no opencode in PATH → models = []
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });

    // opencode.json updated
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpDir, "opencode.json"), "utf-8"));
    const moaEntry = cfg.plugin.find((p: unknown) =>
      typeof p === "string"
        ? p.startsWith("opencode-moa-fusion")
        : Array.isArray(p) &&
          typeof (p as string[])[0] === "string" &&
          (p as string[])[0].startsWith("opencode-moa-fusion"),
    );
    expect(moaEntry).toBeDefined();

    // slash command installed
    const cmdPath = path.join(tmpDir, ".opencode", "command", "smoketest.md");
    expect(fs.existsSync(cmdPath)).toBe(true);
    expect(fs.readFileSync(cmdPath)).toEqual(fs.readFileSync(MOA_MD_SOURCE));
  });
});
