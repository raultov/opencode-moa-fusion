import { describe, expect, it } from "bun:test";
import {
  ALLOWED_HOSTS,
  atomicWriteSync,
  ensureAllowedHost,
  isSemver,
  isValidTag,
  parseInstallArgs,
  parseSha256Sums,
  rawURL,
  releaseAssetURL,
  sha256OfBytes,
  verifyMoaMd,
} from "../src/install-verify.mjs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("install-verify [Unit]", () => {
  describe("ALLOWED_HOSTS", () => {
    it("Given the allowlist When read Then it contains only GitHub-controlled hosts", () => {
      expect(ALLOWED_HOSTS.has("github.com")).toBe(true);
      expect(ALLOWED_HOSTS.has("objects.githubusercontent.com")).toBe(true);
      expect(ALLOWED_HOSTS.has("raw.githubusercontent.com")).toBe(true);
      expect(ALLOWED_HOSTS.size).toBe(3);
    });
  });

  describe("ensureAllowedHost", () => {
    it("Given a github.com URL When ensureAllowedHost is called Then returns the parsed URL", () => {
      const u = ensureAllowedHost("https://github.com/raultov/opencode-moa-fusion/releases");
      expect(u.host).toBe("github.com");
    });

    it("Given an objects.githubusercontent.com URL When ensureAllowedHost is called Then returns the parsed URL", () => {
      const u = ensureAllowedHost("https://objects.githubusercontent.com/foo");
      expect(u.host).toBe("objects.githubusercontent.com");
    });

    it("Given a raw.githubusercontent.com URL When ensureAllowedHost is called Then returns the parsed URL", () => {
      const u = ensureAllowedHost("https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.sh");
      expect(u.host).toBe("raw.githubusercontent.com");
    });

    it("Given a non-GitHub host URL When ensureAllowedHost is called Then throws", () => {
      expect(() => ensureAllowedHost("https://evil.example.com/moa.md")).toThrow(/non-GitHub host/);
      expect(() => ensureAllowedHost("http://github.com/x")).toThrow(/non-HTTPS/);
      expect(() => ensureAllowedHost("not-a-url")).toThrow(/invalid URL/);
      expect(() => ensureAllowedHost("ftp://github.com/x")).toThrow(/non-HTTPS/);
    });

    it("Given allowHttp=true and a 127.0.0.1 URL When ensureAllowedHost is called Then returns the parsed URL", () => {
      const u = ensureAllowedHost("http://127.0.0.1:8080/x", { allowHttp: true });
      expect(u.host).toBe("127.0.0.1:8080");
    });

    it("Given allowHttp=true and an evil http:// URL When ensureAllowedHost is called Then still throws", () => {
      expect(() => ensureAllowedHost("http://evil.example.com/x", { allowHttp: true })).toThrow();
    });
  });

  describe("isSemver", () => {
    it("Given valid semver When isSemver is called Then returns true", () => {
      expect(isSemver("1.2.7")).toBe(true);
      expect(isSemver("0.0.0")).toBe(true);
      expect(isSemver("1.3.0-rc.1")).toBe(true);
      expect(isSemver("10.20.30-beta.2")).toBe(true);
    });
    it("Given invalid semver When isSemver is called Then returns false", () => {
      expect(isSemver("latest")).toBe(false);
      expect(isSemver("1.2")).toBe(false);
      expect(isSemver("1.2.7.4")).toBe(false);
      expect(isSemver("")).toBe(false);
      expect(isSemver("v1.2.7")).toBe(false);
      expect(isSemver(null)).toBe(false);
      expect(isSemver(undefined)).toBe(false);
      expect(isSemver(123)).toBe(false);
    });
  });

  describe("isValidTag", () => {
    it("Given a valid tag When isValidTag is called Then returns true", () => {
      expect(isValidTag("v1.2.7")).toBe(true);
      expect(isValidTag("v1.3.0-rc.1")).toBe(true);
    });
    it("Given an invalid ref When isValidTag is called Then returns false", () => {
      expect(isValidTag("latest")).toBe(false);
      expect(isValidTag("main")).toBe(false);
      expect(isValidTag("1.2.7")).toBe(false); // missing v prefix
      expect(isValidTag("v1.2")).toBe(false);
      expect(isValidTag("")).toBe(false);
    });
  });

  describe("releaseAssetURL", () => {
    it("Given a valid tag When releaseAssetURL is called Then returns a github.com release URL", () => {
      const url = releaseAssetURL({ owner: "raultov", repo: "opencode-moa-fusion", ref: "v1.2.7", asset: "moa.md" });
      expect(url).toBe("https://github.com/raultov/opencode-moa-fusion/releases/download/v1.2.7/moa.md");
    });

    it("Given baseUrl When releaseAssetURL is called Then uses baseUrl instead of github.com", () => {
      const url = releaseAssetURL({
        owner: "raultov",
        repo: "opencode-moa-fusion",
        ref: "v1.2.7",
        asset: "moa.md",
        baseUrl: "http://localhost:8080",
      });
      expect(url).toBe("http://localhost:8080/raultov/opencode-moa-fusion/releases/download/v1.2.7/moa.md");
    });

    it("Given a baseUrl with trailing slash When releaseAssetURL is called Then strips it", () => {
      const url = releaseAssetURL({
        owner: "x",
        repo: "y",
        ref: "v1.0.0",
        asset: "z",
        baseUrl: "http://localhost:8080/",
      });
      expect(url).toBe("http://localhost:8080/x/y/releases/download/v1.0.0/z");
    });

    it("Given a non-tag ref When releaseAssetURL is called Then throws", () => {
      expect(() => releaseAssetURL({ owner: "x", repo: "y", ref: "main", asset: "moa.md" })).toThrow(/non-tag ref/);
      expect(() => releaseAssetURL({ owner: "x", repo: "y", ref: "latest", asset: "moa.md" })).toThrow(/non-tag ref/);
    });
  });

  describe("rawURL", () => {
    it("Given a valid tag When rawURL is called Then returns a raw.githubusercontent.com URL", () => {
      const url = rawURL({ owner: "raultov", repo: "opencode-moa-fusion", ref: "v1.2.7", path: "src/install-merge-config.mjs" });
      expect(url).toBe("https://raw.githubusercontent.com/raultov/opencode-moa-fusion/v1.2.7/src/install-merge-config.mjs");
    });

    it("Given baseUrl When rawURL is called Then uses baseUrl", () => {
      const url = rawURL({
        owner: "x",
        repo: "y",
        ref: "v1.0.0",
        path: "z.mjs",
        baseUrl: "http://localhost:8080",
      });
      expect(url).toBe("http://localhost:8080/x/y/v1.0.0/z.mjs");
    });

    it("Given a non-tag ref When rawURL is called Then throws", () => {
      expect(() => rawURL({ owner: "x", repo: "y", ref: "main", path: "z" })).toThrow(/non-tag ref/);
    });
  });

  describe("parseSha256Sums", () => {
    it("Given a standard sha256sum manifest When parseSha256Sums is called Then returns a filename→sha256 map", () => {
      const sha = "a".repeat(64);
      const sha2 = "b".repeat(64);
      const text = `${sha}  moa.md\n${sha2}  other.txt\n`;
      const m = parseSha256Sums(text);
      expect(m.get("moa.md")).toBe(sha);
      expect(m.get("other.txt")).toBe(sha2);
    });

    it("Given a binary-mode sha256sum manifest (with * prefix) When parseSha256Sums is called Then tolerates the * prefix", () => {
      const sha = "c".repeat(64);
      const text = `${sha} *moa.md\n`;
      expect(parseSha256Sums(text).get("moa.md")).toBe(sha);
    });

    it("Given an empty manifest When parseSha256Sums is called Then returns an empty map", () => {
      expect(parseSha256Sums("").size).toBe(0);
      expect(parseSha256Sums("\n\n\n").size).toBe(0);
    });

    it("Given a manifest with CRLF line endings When parseSha256Sums is called Then handles them", () => {
      const sha = "d".repeat(64);
      const text = `${sha}  moa.md\r\n`;
      expect(parseSha256Sums(text).get("moa.md")).toBe(sha);
    });

    it("Given a manifest with an invalid line When parseSha256Sums is called Then ignores the invalid line", () => {
      const sha = "e".repeat(64);
      const text = `not-a-valid-hash-line\n${sha}  moa.md\n`;
      expect(parseSha256Sums(text).get("moa.md")).toBe(sha);
    });
  });

  describe("sha256OfBytes", () => {
    it("Given a known input When sha256OfBytes is called Then returns the expected hex digest", () => {
      // SHA-256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
      expect(sha256OfBytes("hello world")).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      );
      expect(sha256OfBytes(Buffer.from("hello world"))).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      );
    });

    it("Given empty input When sha256OfBytes is called Then returns the empty-string SHA-256", () => {
      expect(sha256OfBytes("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });
  });

  describe("verifyMoaMd", () => {
    const moaBytes = Buffer.from("# /moa command\n");
    const correctSha = sha256OfBytes(moaBytes);
    const sumsText = `${correctSha}  moa.md\n`;
    const fakeSumsPath = "/tmp/SHA256SUMS";
    const fakeSigPath = "/tmp/SHA256SUMS.sig";
    const fakePemPath = "/tmp/SHA256SUMS.pem";

    it("Given correct SHA-256 and skipSignature=true When verifyMoaMd is called Then resolves without calling cosign/gh", async () => {
      let cosignCalled = false;
      const result = await verifyMoaMd({
        moaMdBytes: moaBytes,
        sha256SumsText: sumsText,
        sha256SumsPath: fakeSumsPath,
        sigPath: fakeSigPath,
        pemPath: fakePemPath,
        owner: "raultov",
        repo: "opencode-moa-fusion",
        skipSignature: true,
        runCommand: async (cmd) => {
          if (cmd === "cosign") cosignCalled = true;
        },
        hasCommand: () => false,
      });
      expect(result).toBeUndefined();
      expect(cosignCalled).toBe(false);
    });

    it("Given a tampered moa.md When verifyMoaMd is called Then throws SHA256 mismatch", async () => {
      await expect(
        verifyMoaMd({
          moaMdBytes: Buffer.from("# /moa command\nTAMPERED\n"),
          sha256SumsText: sumsText,
          sha256SumsPath: fakeSumsPath,
          sigPath: fakeSigPath,
          pemPath: fakePemPath,
          owner: "raultov",
          repo: "opencode-moa-fusion",
          skipSignature: true,
          runCommand: async () => {},
          hasCommand: () => false,
        }),
      ).rejects.toThrow(/SHA256 mismatch/);
    });

    it("Given a SHA256SUMS that does not list moa.md When verifyMoaMd is called Then throws not-listed error", async () => {
      await expect(
        verifyMoaMd({
          moaMdBytes: moaBytes,
          sha256SumsText: `${"f".repeat(64)}  other.txt\n`,
          sha256SumsPath: fakeSumsPath,
          sigPath: fakeSigPath,
          pemPath: fakePemPath,
          owner: "raultov",
          repo: "opencode-moa-fusion",
          skipSignature: true,
          runCommand: async () => {},
          hasCommand: () => false,
        }),
      ).rejects.toThrow(/not listed in SHA256SUMS/);
    });

    it("Given neither cosign nor gh installed When verifyMoaMd is called Then throws CLI-not-found error", async () => {
      await expect(
        verifyMoaMd({
          moaMdBytes: moaBytes,
          sha256SumsText: sumsText,
          sha256SumsPath: fakeSumsPath,
          sigPath: fakeSigPath,
          pemPath: fakePemPath,
          owner: "raultov",
          repo: "opencode-moa-fusion",
          skipSignature: false,
          runCommand: async () => {},
          hasCommand: () => false,
        }),
      ).rejects.toThrow(/Neither cosign nor gh/);
    });

    it("Given cosign installed When verifyMoaMd is called Then invokes cosign verify-blob with the expected args", async () => {
      const invocations: Array<{ cmd: string; args: string[] }> = [];
      await verifyMoaMd({
        moaMdBytes: moaBytes,
        sha256SumsText: sumsText,
        sha256SumsPath: fakeSumsPath,
        sigPath: fakeSigPath,
        pemPath: fakePemPath,
        owner: "raultov",
        repo: "opencode-moa-fusion",
        skipSignature: false,
        runCommand: async (cmd, args) => {
          invocations.push({ cmd, args });
        },
        hasCommand: (c) => c === "cosign",
      });
      expect(invocations).toHaveLength(1);
      expect(invocations[0].cmd).toBe("cosign");
      expect(invocations[0].args[0]).toBe("verify-blob");
      expect(invocations[0].args).toContain("--certificate");
      expect(invocations[0].args).toContain(fakePemPath);
      expect(invocations[0].args).toContain("--signature");
      expect(invocations[0].args).toContain(fakeSigPath);
      expect(invocations[0].args).toContain(fakeSumsPath);
      const regexIdx = invocations[0].args.indexOf("--certificate-identity-regexp");
      expect(regexIdx).toBeGreaterThan(-1);
      expect(invocations[0].args[regexIdx + 1]).toBe(
        "^https://github\\.com/raultov/opencode-moa-fusion/\\.github/workflows/release\\.yml@refs/tags/v",
      );
      const issuerIdx = invocations[0].args.indexOf("--certificate-oidc-issuer");
      expect(issuerIdx).toBeGreaterThan(-1);
      expect(invocations[0].args[issuerIdx + 1]).toBe(
        "https://token.actions.githubusercontent.com",
      );
    });

    it("Given gh installed (and cosign missing) When verifyMoaMd is called Then invokes gh attestation verify", async () => {
      const invocations: Array<{ cmd: string; args: string[] }> = [];
      await verifyMoaMd({
        moaMdBytes: moaBytes,
        sha256SumsText: sumsText,
        sha256SumsPath: fakeSumsPath,
        sigPath: fakeSigPath,
        pemPath: fakePemPath,
        owner: "raultov",
        repo: "opencode-moa-fusion",
        skipSignature: false,
        runCommand: async (cmd, args) => {
          invocations.push({ cmd, args });
        },
        hasCommand: (c) => c === "gh",
      });
      expect(invocations).toHaveLength(1);
      expect(invocations[0].cmd).toBe("gh");
      expect(invocations[0].args[0]).toBe("attestation");
      expect(invocations[0].args[1]).toBe("verify");
      expect(invocations[0].args).toContain("--owner");
      expect(invocations[0].args).toContain("raultov");
      expect(invocations[0].args).toContain(fakeSumsPath);
    });

    it("Given cosign throws (bad signature) When verifyMoaMd is called Then propagates the error", async () => {
      await expect(
        verifyMoaMd({
          moaMdBytes: moaBytes,
          sha256SumsText: sumsText,
          sha256SumsPath: fakeSumsPath,
          sigPath: fakeSigPath,
          pemPath: fakePemPath,
          owner: "raultov",
          repo: "opencode-moa-fusion",
          skipSignature: false,
          runCommand: async () => {
            throw new Error("cosign verification failed");
          },
          hasCommand: (c) => c === "cosign",
        }),
      ).rejects.toThrow(/cosign verification failed/);
    });
  });

  describe("parseInstallArgs", () => {
    it("Given no flags When parseInstallArgs is called Then returns defaults", () => {
      const opts = parseInstallArgs([]);
      expect(opts.skipSignature).toBe(false);
      expect(opts.versionOverride).toBe(null);
      expect(opts.owner).toBe(null);
      expect(opts.repo).toBe(null);
    });

    it("Given --skip-signature When parseInstallArgs is called Then skipSignature=true", () => {
      expect(parseInstallArgs(["--skip-signature"]).skipSignature).toBe(true);
    });

    it("Given --version=1.3.0-rc.1 When parseInstallArgs is called Then captures the value", () => {
      expect(parseInstallArgs(["--version=1.3.0-rc.1"]).versionOverride).toBe("1.3.0-rc.1");
    });

    it("Given --owner and --repo When parseInstallArgs is called Then captures both", () => {
      const opts = parseInstallArgs(["--owner=foo", "--repo=bar"]);
      expect(opts.owner).toBe("foo");
      expect(opts.repo).toBe("bar");
    });

    it("Given --download-base-url When parseInstallArgs is called Then captures the URL", () => {
      const opts = parseInstallArgs(["--download-base-url=http://localhost:9999"]);
      expect(opts.downloadBaseUrl).toBe("http://localhost:9999");
    });

    it("Given --allow-http When parseInstallArgs is called Then allowHttp=true", () => {
      const opts = parseInstallArgs(["--allow-http"]);
      expect(opts.allowHttp).toBe(true);
    });
  });

  describe("atomicWriteSync", () => {
    it("Given a final path and bytes When atomicWriteSync is called Then writes the file atomically (no tmp leftovers)", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-test-"));
      const finalPath = path.join(tmpDir, "out.txt");
      try {
        atomicWriteSync({ finalPath, bytes: Buffer.from("hello") });
        expect(fs.readFileSync(finalPath, "utf-8")).toBe("hello");
        const leftovers = fs.readdirSync(tmpDir).filter((n) => n.startsWith("out.txt.tmp."));
        expect(leftovers).toHaveLength(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("Given a path in a non-existent directory When atomicWriteSync is called Then creates the directory and writes the file", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-test-"));
      const finalPath = path.join(tmpDir, "nested", "deeper", "out.txt");
      try {
        atomicWriteSync({ finalPath, bytes: Buffer.from("nested!") });
        expect(fs.readFileSync(finalPath, "utf-8")).toBe("nested!");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("Given an existing file at the target When atomicWriteSync is called Then overwrites it atomically", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-test-"));
      const finalPath = path.join(tmpDir, "out.txt");
      try {
        fs.writeFileSync(finalPath, "old content");
        atomicWriteSync({ finalPath, bytes: Buffer.from("new content") });
        expect(fs.readFileSync(finalPath, "utf-8")).toBe("new content");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});