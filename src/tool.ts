import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { callModel } from "./callModel.js";
import { resolveRoles, resolveTimeoutMs } from "./roles.js";
import { RoleResolutionError, type WorkerResult } from "./types.js";
import { resolveWorkerTools } from "./workerTools.js";

const z = tool.schema;

export const ArgsSchema = {
  prompt: z.string().min(1).describe("The user prompt to fan out to every worker model."),
  workers: z
    .array(z.string())
    .optional()
    .describe('Worker model refs as "providerID/modelID". Overrides plugin options.'),
  agent: z
    .string()
    .optional()
    .describe("Agent profile to use for each underlying model call (default: 'general')."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Per-worker timeout in ms. Default 300000 (5 min)."),
};

const SYNTHESIS_INSTRUCTIONS = `Received N worker outputs for the prompt below. Synthesize a single unified
answer in your next reply. Treat consensus across workers as authoritative;
discard claims unique to one worker that no other corroborates. Do not
mention these workers, their models, or this synthesis step in your final
answer to the user.`;

function buildOutputText(prompt: string, workers: WorkerResult[]): string {
  let text = `${SYNTHESIS_INSTRUCTIONS}\n\n## Original prompt\n${prompt}\n`;

  workers.forEach((w, i) => {
    const status = w.ok ? "ok" : `failed: ${w.error}`;
    const sessionInfo = w.sessionID ? `, session: ${w.sessionID}` : "";
    const header = `## Worker ${i + 1} — ${w.model} (${w.elapsedMs}ms${sessionInfo}, ${status})`;

    if (w.ok) {
      text += `\n${header}\n${w.output}\n`;
    } else {
      text += `\n${header}\n`;
    }
  });

  return text;
}

export const moaFusionTool = (client: OpencodeClient, options: Record<string, unknown> = {}) =>
  tool({
    description:
      "Mixture-of-Agents: fan out one prompt to N worker subagents in parallel as child sessions (navigable in the TUI). When all workers complete, returns their outputs labelled. The CALLING AGENT must then synthesize a single unified answer using its own model — do not pass the worker outputs verbatim to the user.",
    args: ArgsSchema,
    async execute(args, ctx): Promise<{ output: string; metadata: { partial: boolean } }> {
      try {
        const roles = await resolveRoles(args, options, client);

        ctx.metadata({ title: `moa_fusion: ${roles.workers.length} workers` });

        const timeoutMs = resolveTimeoutMs(args, options);
        const agent = args.agent || "general";
        const tools = resolveWorkerTools(options);

        const workerPromises = roles.workers.map((model) =>
          callModel({
            client,
            parentID: ctx.sessionID,
            model,
            text: args.prompt,
            agent,
            abort: ctx.abort,
            timeoutMs,
            tools,
          }),
        );

        const workerResults = await Promise.all(workerPromises);
        const partial = workerResults.some((w) => !w.ok);

        const outputText = buildOutputText(args.prompt, workerResults);

        return {
          output: outputText,
          metadata: { partial },
        };
      } catch (e) {
        if (e instanceof RoleResolutionError) {
          return {
            output: e.message,
            metadata: { partial: true },
          };
        }
        return {
          output: e instanceof Error ? e.message : String(e),
          metadata: { partial: true },
        };
      }
    },
  });
