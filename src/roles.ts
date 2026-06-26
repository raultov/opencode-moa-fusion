import type { OpencodeClient, Provider } from "@opencode-ai/sdk";
import { parseModelRef } from "./parseModelRef.js";
import { type ModelRef, type ResolvedRoles, RoleResolutionError } from "./types.js";

type Args = { workers?: string[]; timeoutMs?: number };
type Options = { workers?: unknown; timeoutMs?: unknown; agent?: unknown };

export function resolveTimeoutMs(args: Args, options: Options, fallback = 300000): number {
  const fromArgs =
    typeof args.timeoutMs === "number" && args.timeoutMs > 0 ? args.timeoutMs : undefined;
  if (fromArgs) return fromArgs;
  const fromOpts =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0 ? options.timeoutMs : undefined;
  if (fromOpts) return fromOpts;
  return fallback;
}

/**
 * Resolve the OpenCode agent profile under which workers run.
 *
 * The agent MUST come from the user's `opencode.json` plugin options
 * (a trusted source). It is deliberately NOT accepted as a tool argument:
 * a prompt-injection payload that reached the orchestrator agent could
 * otherwise pick an elevated-permission worker profile. See
 * `SECURITY_PLAN.md` step 3 (consensus #3, CWE-20).
 */
export function resolveAgent(options: Options, fallback = "general"): string {
  if (typeof options.agent === "string" && options.agent.length > 0) {
    return options.agent;
  }
  return fallback;
}

export async function resolveRoles(
  args: Args,
  options: Options,
  client: OpencodeClient,
): Promise<ResolvedRoles> {
  let workersRaw: string[] | undefined;
  let source: "args" | "options";

  if (args.workers && args.workers.length > 0) {
    workersRaw = args.workers;
    source = "args";
  } else if (Array.isArray(options.workers) && options.workers.length > 0) {
    workersRaw = options.workers.filter((w) => typeof w === "string") as string[];
    source = "options";
  } else {
    throw new RoleResolutionError(
      "MISSING_ROLES",
      `moa_fusion: no models configured. Provide \`workers\` in args or plugin options.`,
    );
  }

  const res = await client.config.providers();
  const providers: Provider[] = res.data?.providers ?? [];
  const knownModels = new Set<string>();
  providers.forEach((p) => {
    Object.keys(p.models || {}).forEach((m) => {
      knownModels.add(`${p.id}/${m}`);
    });
  });

  const validate = (raw: string): ModelRef => {
    const ref = parseModelRef(raw);
    const full = `${ref.providerID}/${ref.modelID}`;
    if (!knownModels.has(full)) {
      throw new RoleResolutionError("UNKNOWN_MODEL", `Unknown model: ${full}`);
    }
    return ref;
  };

  const workers = workersRaw.map(validate);

  return { workers, source };
}
