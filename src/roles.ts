import type { OpencodeClient, Provider } from "@opencode-ai/sdk";
import { parseModelRef } from "./parseModelRef.js";
import { type ModelRef, type ResolvedRoles, RoleResolutionError } from "./types.js";

type Args = { workers?: string[] };
type Options = { workers?: unknown };

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
