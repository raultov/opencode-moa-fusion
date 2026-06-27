import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dir, "..", "src", "install-merge-config.mjs");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(args: string[]): RunResult {
  const r = spawnSync("node", [SCRIPT, ...args], { encoding: "utf-8" });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-merge-test-"));
  configPath = path.join(tmpDir, "opencode.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("install-merge-config.mjs [CLI]", () => {
  describe("Scenario: file does not exist", () => {
    it("Given no config on disk When merge runs Then a new config is created with the plugin entry", () => {
      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
        `--workers=google/gemini-2.5-flash,anthropic/claude-haiku-4-5`,
      ]);
      expect(r.status).toBe(0);
      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written.plugin).toEqual([
        [
          "opencode-moa-fusion@1.2.7",
          { workers: ["google/gemini-2.5-flash", "anthropic/claude-haiku-4-5"] },
        ],
      ]);
    });

    it("Given no workers arg When merge runs Then plugin is registered as a bare string", () => {
      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(0);
      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written.plugin).toEqual(["opencode-moa-fusion@1.2.7"]);
    });

    it("Given no backup file existed When merge runs Then no .bak is created", () => {
      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(0);
      const entries = fs.readdirSync(tmpDir);
      expect(entries.filter((e) => e.includes(".bak."))).toEqual([]);
    });
  });

  describe("Scenario: valid existing JSON config", () => {
    it("Given a config with model, provider and mcp keys When merge runs Then all top-level keys are preserved", () => {
      const original = {
        $schema: "https://opencode.ai/config.json",
        model: "anthropic/claude-3-5-sonnet",
        provider: { anthropic: { options: { apiKey: "secret" } } },
        mcp: { someMcp: { type: "local", command: ["npx", "x"] } },
        theme: "system",
      };
      fs.writeFileSync(configPath, JSON.stringify(original, null, 2));

      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
        `--workers=google/gemini-2.5-flash`,
      ]);
      expect(r.status).toBe(0);

      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written.$schema).toBe(original.$schema);
      expect(written.model).toBe(original.model);
      expect(written.provider).toEqual(original.provider);
      expect(written.mcp).toEqual(original.mcp);
      expect(written.theme).toBe(original.theme);
      expect(written.plugin).toEqual([
        ["opencode-moa-fusion@1.2.7", { workers: ["google/gemini-2.5-flash"] }],
      ]);
    });

    it("Given an existing config When merge runs Then a timestamped .bak is created with the original content", () => {
      const original = { model: "anthropic/claude-3-5-sonnet" };
      fs.writeFileSync(configPath, JSON.stringify(original, null, 2));

      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(0);

      const bakFiles = fs.readdirSync(tmpDir).filter((f) => f.startsWith("opencode.json.bak."));
      expect(bakFiles.length).toBe(1);
      const backup = JSON.parse(fs.readFileSync(path.join(tmpDir, bakFiles[0]), "utf-8"));
      expect(backup).toEqual(original);
    });

    it("Given an existing moa-fusion entry from an older version When merge runs Then it is replaced and other plugins are preserved", () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          plugin: [
            ["opencode-moa-fusion@1.0.0", { workers: ["old/model"] }],
            "unrelated-plugin@2.0.0",
          ],
        }),
      );

      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
        `--workers=new/model`,
      ]);
      expect(r.status).toBe(0);

      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written.plugin).toEqual([
        "unrelated-plugin@2.0.0",
        ["opencode-moa-fusion@1.2.7", { workers: ["new/model"] }],
      ]);
    });

    it("Given an existing moa-fusion entry as a bare string When merge runs Then it is replaced with the new spec", () => {
      fs.writeFileSync(configPath, JSON.stringify({ plugin: ["opencode-moa-fusion@1.0.0"] }));

      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
        `--workers=x/y`,
      ]);
      expect(r.status).toBe(0);

      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written.plugin).toEqual([["opencode-moa-fusion@1.2.7", { workers: ["x/y"] }]]);
    });
  });

  describe("Scenario: JSON5/JSONC tolerance (the original bug)", () => {
    it("Given an opencode.json with a // line comment and a trailing comma When merge runs Then it is parsed and preserved", () => {
      // The original bug: this file made JSON.parse throw, the catch block
      // silently fell back to { plugin: [] } and overwrote the user's config.
      const original = `{
  // my custom model
  "model": "anthropic/claude-3-5-sonnet",
  "plugin": [],
}
`;
      fs.writeFileSync(configPath, original);

      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
        `--workers=google/gemini-2.5-flash`,
      ]);
      expect(r.status).toBe(0);

      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written.model).toBe("anthropic/claude-3-5-sonnet");
      expect(written.plugin).toEqual([
        ["opencode-moa-fusion@1.2.7", { workers: ["google/gemini-2.5-flash"] }],
      ]);
    });

    it("Given an opencode.json with a /* block */ comment When merge runs Then it is parsed correctly", () => {
      const original = `{
  /* block comment */
  "model": "anthropic/claude-3-5-sonnet",
  "plugin": []
}
`;
      fs.writeFileSync(configPath, original);

      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(0);

      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written.model).toBe("anthropic/claude-3-5-sonnet");
    });

    it("Given a // inside a string value When merge runs Then the comment-like text is preserved verbatim", () => {
      // The string-aware stripper must not eat the // inside "https://...".
      fs.writeFileSync(configPath, JSON.stringify({ model: "https://example.com/foo" }));
      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(0);
      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written.model).toBe("https://example.com/foo");
    });
  });

  describe("Scenario: malformed config (the original bug)", () => {
    it("Given a config that cannot be parsed as JSON or JSONC When merge runs Then the install fails and the file is NOT touched", () => {
      // The original bug: a malformed file would silently be overwritten
      // with { plugin: [moa-fusion] }, losing all of the user's settings.
      const original = "{ this is not valid json : :: ::";
      fs.writeFileSync(configPath, original);

      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Refusing to overwrite");
      expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
    });

    it("Given a top-level JSON array When merge runs Then the install fails and the file is NOT touched", () => {
      const original = "[1, 2, 3]";
      fs.writeFileSync(configPath, original);

      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Refusing to overwrite");
      expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
    });

    it("Given a top-level JSON null When merge runs Then the install fails and the file is NOT touched", () => {
      fs.writeFileSync(configPath, "null");

      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Refusing to overwrite");
      expect(fs.readFileSync(configPath, "utf-8")).toBe("null");
    });
  });

  describe("Scenario: argument validation", () => {
    it("Given no --config-path or --plugin-spec When merge runs Then it exits 2 with a usage message", () => {
      const r = runScript([]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Usage:");
    });
  });

  describe("Scenario: opencode.json write is atomic (M3 / TOCTOU)", () => {
    it("Given a successful merge When merge runs Then no .tmp.* leftover files remain next to opencode.json", () => {
      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(0);
      const entries = fs.readdirSync(tmpDir);
      const leftovers = entries.filter((e) => e.includes(".tmp."));
      expect(leftovers).toEqual([]);
    });

    it("Given an existing config overwritten by merge When merge runs Then the new content is final and no tmp file remains", () => {
      fs.writeFileSync(configPath, JSON.stringify({ model: "old/model" }));
      const r = runScript([
        `--config-path=${configPath}`,
        `--plugin-spec=opencode-moa-fusion@1.2.7`,
      ]);
      expect(r.status).toBe(0);
      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written.model).toBe("old/model");
      expect(written.plugin).toEqual(["opencode-moa-fusion@1.2.7"]);
      const entries = fs.readdirSync(tmpDir);
      const leftovers = entries.filter((e) => e.includes(".tmp."));
      expect(leftovers).toEqual([]);
    });
  });
});
