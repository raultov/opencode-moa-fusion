import type { PluginModule as V1PluginModule } from "@opencode-ai/plugin";
import { MoaFusionPlugin } from "./v1.js";
import { type createMoaFusionV2, MoaFusionPluginV2 } from "./v2.js";

export type {
  MoaArgs,
  MoaOptions,
  MoaRunDeps,
  MoaRunResult,
  ProviderLike,
  WorkerCall,
  WorkerRunner,
} from "./core.js";
export {
  buildOutputText,
  READ_ONLY_DIRECTIVE,
  runMoaFusion,
  SYNTHESIS_INSTRUCTIONS,
  TOOL_DESCRIPTION,
  wrapUserPrompt,
  wrapWorkerOutput,
} from "./core.js";
export { MoaFusionPlugin } from "./v1.js";
export { createMoaFusionV2, MoaFusionPluginV2 } from "./v2.js";

/**
 * Dual entrypoint, one package for both opencode generations.
 *
 * opencode V2 reads the default export as a plugin definition (`id` + `setup`)
 * and calls `setup`. opencode V1 (1.18.29 and newer) reads it as a
 * `PluginModule` and calls `server` with the classic `(input, options)`
 * signature. Both implementations share `core.ts`, so the bridged behaviour
 * cannot drift between generations.
 *
 * V1 releases older than 1.18.29 cannot load an object entrypoint: stay on
 * `opencode-moa-fusion@1.3.x` there.
 */
const MoaFusionModule: V1PluginModule & ReturnType<typeof createMoaFusionV2> = {
  ...MoaFusionPluginV2,
  server: MoaFusionPlugin,
};

export default MoaFusionModule;
