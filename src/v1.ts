import type { Plugin } from "@opencode-ai/plugin";
import { moaFusionTool } from "./tool.js";

/**
 * opencode V1 plugin: registers the `moa_fusion` tool through the classic
 * `(input, options) => hooks` signature. opencode V1 (1.18.29 and newer)
 * reaches this through the `server` property of the dual entrypoint.
 */
export const MoaFusionPlugin: Plugin = async (input, options) => ({
  tool: { moa_fusion: moaFusionTool(input.client, options) },
});

export default MoaFusionPlugin;
