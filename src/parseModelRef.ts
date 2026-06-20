import { type ModelRef, RoleResolutionError } from "./types.js";

export function parseModelRef(s: string): ModelRef {
  const trimmed = s.trim();
  if (!trimmed) {
    throw new RoleResolutionError("INVALID_REF", "Model ref cannot be empty");
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) {
    throw new RoleResolutionError(
      "INVALID_REF",
      `Invalid model ref format: "${trimmed}". Expected "providerID/modelID"`,
    );
  }

  const providerID = trimmed.slice(0, slashIndex);
  const modelID = trimmed.slice(slashIndex + 1);

  return { providerID, modelID };
}
