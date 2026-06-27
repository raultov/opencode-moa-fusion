export type ModelRef = { providerID: string; modelID: string };

export type WorkerResult =
  | { ok: true; model: string; sessionID: string; output: string; elapsedMs: number }
  | { ok: false; model: string; sessionID?: string; error: string; elapsedMs: number };

export type ResolvedRoles = {
  workers: ModelRef[];
  source: "args" | "options";
};

export class RoleResolutionError extends Error {
  constructor(
    public readonly code:
      | "MISSING_ROLES"
      | "UNKNOWN_MODEL"
      | "INVALID_REF"
      | "INVALID_WORKER_TOOLS"
      | "TOO_MANY_WORKERS",
    message: string,
  ) {
    super(message);
    this.name = "RoleResolutionError";
  }
}
