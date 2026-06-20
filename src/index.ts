import type { Plugin } from "@opencode-ai/plugin";
import { moaFusionTool } from "./tool.js";

const MoaFusionPlugin: Plugin = async (input, options) => ({
  tool: { moa_fusion: moaFusionTool(input.client, options) },
});

export default MoaFusionPlugin;
