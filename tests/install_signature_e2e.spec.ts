import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const repoRoot = path.resolve(import.meta.dir, "..");
const driverPath = path.join(repoRoot, "tests", "install_signature_e2e.mjs");

describe("install_signature_e2e [E2E]", () => {
  it("Given the driver When run with node Then all assertions pass", () => {
    if (!fs.existsSync(driverPath)) {
      throw new Error(`E2E driver not found at ${driverPath}`);
    }
    const res = spawnSync(process.execPath, [driverPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: process.env,
    });
    if (res.status !== 0) {
      throw new Error(
        `E2E driver exited ${res.status}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
      );
    }
    expect(res.stdout).toContain("All install_signature_e2e assertions passed.");
  });
});