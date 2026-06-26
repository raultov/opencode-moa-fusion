// Type declarations for src/install-verify.mjs (plain JS module).

declare const ALLOWED_HOSTS: Set<string>;

export declare function ensureAllowedHost(
  url: string,
  options?: { allowHttp?: boolean },
): URL;

export declare function isSemver(version: unknown): boolean;
export declare function isValidTag(ref: unknown): boolean;

export declare function releaseAssetURL(args: {
  owner: string;
  repo: string;
  ref: string;
  asset: string;
  baseUrl?: string | null;
}): string;

export declare function rawURL(args: {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  baseUrl?: string | null;
}): string;

export declare function parseSha256Sums(text: string): Map<string, string>;
export declare function sha256OfBytes(input: Buffer | string): string;
export declare function sha256OfFile(filePath: string): string;

export declare function verifyMoaMd(opts: {
  moaMdBytes: Buffer;
  sha256SumsText: string;
  sha256SumsPath: string;
  sigPath: string;
  pemPath: string;
  owner: string;
  repo: string;
  skipSignature?: boolean;
  runCommand: (cmd: string, args: string[]) => Promise<void>;
  hasCommand: (cmd: string) => boolean;
}): Promise<void>;

export declare function parseInstallArgs(argv: string[]): {
  skipSignature: boolean;
  versionOverride: string | null;
  owner: string | null;
  repo: string | null;
  downloadBaseUrl: string | null;
  allowHttp: boolean;
};

export declare function atomicWriteSync(args: {
  finalPath: string;
  bytes: Buffer;
  fs?: typeof import("node:fs");
  path?: typeof import("node:path");
}): void;