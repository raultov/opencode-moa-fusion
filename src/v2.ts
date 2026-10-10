/**
 * opencode V2 plugin: registers the `moa_fusion` tool through the native
 * `tool.transform` editor. The orchestration is `core.ts`, shared verbatim
 * with the V1 entrypoint (`v1.ts`).
 *
 * V2-specific notes:
 *
 * - Tool input is a JSON Schema literal (the V1 zod shape lives in `tool.ts`;
 *   keep both in sync).
 * - Worker calls go through `ctx.session` child sessions (`callModelV2.ts`).
 * - V2 cannot scope tool selection per call, so a `moa_fusion` invocation made
 *   from inside a worker child session is refused here (the V1 transport
 *   disables the tool per prompt instead).
 */
import { define, type Plugin } from "@opencode/plugin/promise/plugin";
import { createV2WorkerRunner } from "./callModelV2.js";
import { type MoaArgs, runMoaFusion, TOOL_DESCRIPTION } from "./core.js";

/** Keep in sync with `ArgsSchema` in `tool.ts` (V1 zod shape). */
const ARGS_JSON_SCHEMA = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      minLength: 1,
      description: "The user prompt to fan out to every worker model.",
    },
    workers: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 8,
      description:
        'Worker model refs as "providerID/modelID". Overrides plugin options. ' +
        "Up to 8 workers per call; duplicates are rejected.",
    },
    timeoutMs: {
      type: "integer",
      minimum: 1,
      description: "Per-worker timeout in ms. Default 300000 (5 min).",
    },
  },
  required: ["prompt"],
};

const WORKER_REFUSAL =
  "moa_fusion is disabled inside MoA worker sessions: workers answer with text only (read-only directive).";

export function createMoaFusionV2(): Plugin {
  return define({
    id: "opencode-moa-fusion",
    setup: (ctx) => {
      const options = (ctx.options ?? {}) as Record<string, unknown>;
      const workerSessions = new Set<string>();

      ctx.tool.transform((editor) => {
        editor.add({
          name: "moa_fusion",
          description: TOOL_DESCRIPTION,
          input: ARGS_JSON_SCHEMA,
          output: { type: "string" },
          execute: async (args, toolCtx) => {
            if (workerSessions.has(String(toolCtx.sessionID))) {
              return { output: WORKER_REFUSAL, metadata: { partial: true } };
            }
            return runMoaFusion(args as MoaArgs, options, {
              runWorker: createV2WorkerRunner(ctx.session, workerSessions),
              listProviders: async () => {
                const [providersRes, modelsRes] = await Promise.all([
                  ctx.provider?.list
                    ? ctx.provider.list().catch(() => ({ data: [] }))
                    : Promise.resolve({ data: [] }),
                  ctx.model?.list
                    ? ctx.model.list().catch(() => ({ data: [] }))
                    : Promise.resolve({ data: [] }),
                ]);
                const providers =
                  (
                    providersRes as {
                      data?: Array<{ id: string; models?: Record<string, unknown> }>;
                    }
                  )?.data ?? [];
                const map = new Map<string, { id: string; models: Record<string, unknown> }>();
                for (const p of providers) {
                  map.set(p.id, { id: p.id, models: { ...(p.models || {}) } });
                }
                const models =
                  (modelsRes as { data?: Array<{ id: string; providerID: string }> })?.data ?? [];
                for (const m of models) {
                  let p = map.get(m.providerID);
                  if (!p) {
                    p = { id: m.providerID, models: {} };
                    map.set(m.providerID, p);
                  }
                  p.models[m.id] = {};
                }
                return [...map.values()];
              },
              sessionID: String(toolCtx.sessionID),
              abort: toolCtx.signal,
              notify: async (title) => {
                await toolCtx.progress({ title });
              },
            });
          },
        });
      });
    },
  });
}

export const MoaFusionPluginV2 = createMoaFusionV2();
