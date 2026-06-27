import { RoleResolutionError } from "./types.js";

export type WorkerToolsOption = string[] | undefined;

export type OptionsLike = { workerTools?: unknown };

const DANGEROUS_TOOLS = [
  "bash",
  "write",
  "edit",
  "webfetch",
  "patch",
  "todowrite",
] as const;

export const DEFAULT_WORKER_TOOLS: ReadonlyArray<string> = ["read", "glob", "grep"];

/**
 * Resolve the worker tool allowlist into the `Record<string, boolean>` shape
 * that the OpenCode SDK's `session.prompt({ body: { tools } })` expects.
 *
 * - When `options.workerTools` is absent → return the default read-only set
 *   (`read`, `glob`, `grep`).
 * - When `options.workerTools` is `[]` (empty array) → return `{}` so the
 *   workers run in pure LLM-only mode (no tools).
 * - When `options.workerTools` is a non-empty array of strings → return a
 *   map that:
 *     - sets every listed tool to `true`,
 *     - sets every well-known side-effect tool to `false` (defence in depth
 *       in case the SDK inherits the parent agent's tool surface when a
 *       tool is omitted from the map),
 *     - forces `moa_fusion: false` (recursion guard).
 *
 * Throws `RoleResolutionError` with code `INVALID_WORKER_TOOLS` if the option
 * is present but is not an array of non-empty strings.
 */
export function resolveWorkerTools(options: OptionsLike): Record<string, boolean> {
  const raw = options.workerTools;

  if (raw === undefined) {
    return defaultToolsMap();
  }

  if (!Array.isArray(raw)) {
    throw new RoleResolutionError(
      "INVALID_WORKER_TOOLS",
      "moa_fusion: `workerTools` must be an array of tool name strings (e.g. [\"read\", \"glob\", \"grep\"]).",
    );
  }

  for (const item of raw) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new RoleResolutionError(
        "INVALID_WORKER_TOOLS",
        "moa_fusion: every entry in `workerTools` must be a non-empty string (tool name).",
      );
    }
  }

  if (raw.length === 0) {
    return {};
  }

  const result: Record<string, boolean> = {};
  for (const name of raw) {
    result[name] = true;
  }
  for (const dangerous of DANGEROUS_TOOLS) {
    if (!(dangerous in result)) {
      result[dangerous] = false;
    }
  }
  result.moa_fusion = false;
  return result;
}

function defaultToolsMap(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const name of DEFAULT_WORKER_TOOLS) {
    result[name] = true;
  }
  for (const dangerous of DANGEROUS_TOOLS) {
    result[dangerous] = false;
  }
  result.moa_fusion = false;
  return result;
}