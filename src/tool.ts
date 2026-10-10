import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { callModel } from "./callModel.js";
import { runMoaFusion, TOOL_DESCRIPTION } from "./core.js";

const z = tool.schema;

export const ArgsSchema = {
  prompt: z.string().min(1).describe("The user prompt to fan out to every worker model."),
  workers: z
    .array(z.string())
    .min(1)
    .max(8)
    .optional()
    .describe(
      'Worker model refs as "providerID/modelID". Overrides plugin options. ' +
        "Up to 8 workers per call; duplicates are rejected.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Per-worker timeout in ms. Default 300000 (5 min)."),
};

export const moaFusionTool = (client: OpencodeClient, options: Record<string, unknown> = {}) =>
  tool({
    description: TOOL_DESCRIPTION,
    args: ArgsSchema,
    async execute(args, ctx): Promise<{ output: string; metadata: { partial: boolean } }> {
      return runMoaFusion(args, options, {
        runWorker: (call) => callModel({ ...call, client }),
        listProviders: async () => (await client.config.providers()).data?.providers ?? [],
        sessionID: ctx.sessionID,
        abort: ctx.abort,
        notify: (title) => {
          ctx.metadata({ title });
        },
      });
    },
  });
