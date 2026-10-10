import { describe, expect, it } from "bun:test";
import { SYNTHESIS_INSTRUCTIONS } from "../src/core.js";
import { createMoaFusionV2 } from "../src/v2.js";

type ToolInfo = {
  name: string;
  description: string;
  input: unknown;
  output?: unknown;
  execute: (
    args: unknown,
    ctx: {
      sessionID: string;
      signal: AbortSignal;
      progress: (update: unknown) => Promise<void>;
    },
  ) => Promise<{ output: string; metadata: { partial: boolean } }>;
};

type CreateInput = {
  parentID?: string;
  title?: string;
  agent?: string;
  model?: { id: string; providerID: string };
};

function makeHarness(options: Record<string, unknown>) {
  const state = {
    tool: undefined as ToolInfo | undefined,
    createCalls: [] as CreateInput[],
    promptCalls: [] as Array<{ sessionID: string; text: string }>,
  };
  let child = 0;

  const session = {
    create: async (input: CreateInput) => {
      state.createCalls.push(input);
      child += 1;
      return { id: `ses_child_${child}` };
    },
    prompt: async (input: { sessionID: string; text: string }) => {
      state.promptCalls.push(input);
      return {};
    },
    wait: async () => undefined,
    context: async ({ sessionID }: { sessionID: string }) => [
      {
        type: "assistant",
        content: [{ type: "text", text: `answer from ${sessionID}` }],
      },
    ],
  };

  // Mirrors the real V2 host (2.0.26): `Provider.Info` carries no `models`, so
  // the model catalogue only comes from `model.list()` (`Model.Info` rows).
  const provider = {
    list: async () => ({
      location: { directory: "/mock" },
      data: [{ id: "openai", name: "OpenAI", activation: "auto", package: "" }],
    }),
  };

  const model = {
    list: async () => ({
      location: { directory: "/mock" },
      data: [
        { id: "gpt-4o-mini", providerID: "openai" },
        { id: "gpt-4o", providerID: "openai" },
      ],
    }),
  };

  const ctx = {
    options,
    tool: {
      transform: (fn: (editor: { add: (tool: ToolInfo) => void }) => void) => {
        fn({
          add: (tool: ToolInfo) => {
            state.tool = tool;
          },
        });
      },
    },
    session,
    provider,
    model,
  };

  const toolCtx = (sessionID: string) => ({
    sessionID,
    signal: new AbortController().signal,
    progress: async () => undefined,
  });

  return { ctx, state, toolCtx };
}

const setupTool = async (options: Record<string, unknown>) => {
  const harness = makeHarness(options);
  const plugin = createMoaFusionV2();
  await plugin.setup(harness.ctx as never);
  const tool = harness.state.tool;
  if (!tool) throw new Error("tool was not registered");
  return { ...harness, tool };
};

describe("MoaFusionPluginV2 [Component]", () => {
  it("Given setup When transformed Then registers the moa_fusion tool", async () => {
    const { tool } = await setupTool({ workers: ["openai/gpt-4o-mini"] });
    expect(tool.name).toBe("moa_fusion");
    expect(tool.description).toContain("Mixture-of-Agents");
    expect(tool.input).toBeTruthy();
  });

  it("Given setup When transformed Then declares a string output schema (the V2 host rejects results with `output` otherwise)", async () => {
    const { tool } = await setupTool({ workers: ["openai/gpt-4o-mini"] });
    expect(tool.output).toEqual({ type: "string" });
  });

  it("Given two workers When executed Then fans out and returns labelled outputs with synthesis instructions", async () => {
    const { tool, state, toolCtx } = await setupTool({
      workers: ["openai/gpt-4o-mini", "openai/gpt-4o"],
    });

    const result = await tool.execute({ prompt: "do it" }, toolCtx("ses_main"));

    expect(result.metadata.partial).toBe(false);
    expect(result.output).toContain(SYNTHESIS_INSTRUCTIONS.slice(0, 40));
    expect(result.output).toContain("openai/gpt-4o-mini");
    expect(result.output).toContain("openai/gpt-4o");
    expect(result.output).toContain("answer from ses_child_1");
    expect(result.output).toContain("answer from ses_child_2");
    expect(state.createCalls).toHaveLength(2);
    expect(state.createCalls[0].parentID).toBe("ses_main");
  });

  it("Given an invocation from inside a worker session When executed Then refuses to fan out again", async () => {
    const { tool, toolCtx } = await setupTool({ workers: ["openai/gpt-4o-mini"] });

    await tool.execute({ prompt: "first" }, toolCtx("ses_main"));
    const result = await tool.execute({ prompt: "nested" }, toolCtx("ses_child_1"));

    expect(result.output).toContain("disabled inside MoA worker sessions");
    expect(result.metadata.partial).toBe(true);
  });

  it("Given no workers anywhere When executed Then reports MISSING_ROLES as partial output", async () => {
    const { tool, toolCtx } = await setupTool({});

    const result = await tool.execute({ prompt: "do it" }, toolCtx("ses_main"));

    expect(result.metadata.partial).toBe(true);
    expect(result.output).toContain("no models configured");
  });

  it("Given an unknown model When executed Then reports Unknown model as partial output", async () => {
    const { tool, toolCtx } = await setupTool({ workers: ["openai/gpt-999"] });

    const result = await tool.execute({ prompt: "do it" }, toolCtx("ses_main"));

    expect(result.metadata.partial).toBe(true);
    expect(result.output).toContain("Unknown model: openai/gpt-999");
  });

  it("Given a failing worker When executed Then marks partial and includes the error", async () => {
    const { tool, state, toolCtx, ctx } = await setupTool({
      workers: ["openai/gpt-4o-mini", "openai/gpt-4o"],
    });
    (ctx.session as { prompt: unknown }).prompt = async (input: { sessionID: string }) => {
      if (input.sessionID === "ses_child_2") throw new Error("boom");
      return {};
    };

    const result = await tool.execute({ prompt: "do it" }, toolCtx("ses_main"));

    expect(state.createCalls).toHaveLength(2);
    expect(result.output).toContain("## Worker 1 — openai/gpt-4o-mini");
    expect(result.output).toContain("## Worker 2 — openai/gpt-4o");
    expect(result.output).toContain("[error]");
    expect(result.metadata.partial).toBe(true);
  });

  it("Given a model only present in model.list When executed Then it resolves as a known worker", async () => {
    const { tool, toolCtx, ctx, state } = await setupTool({ workers: ["google/antigravity-x"] });
    (ctx.model as { list: unknown }).list = async () => ({
      data: [{ id: "antigravity-x", providerID: "google" }],
    });

    const result = await tool.execute({ prompt: "do it" }, toolCtx("ses_main"));

    expect(result.metadata.partial).toBe(false);
    expect(result.output).toContain("google/antigravity-x");
    expect(state.createCalls).toHaveLength(1);
  });

  it("Given model.list fails When executed Then it falls back to the provider catalogue", async () => {
    const { tool, toolCtx, ctx } = await setupTool({ workers: ["openai/gpt-4o"] });
    (ctx.model as { list: unknown }).list = async () => {
      throw new Error("model.list unavailable");
    };
    (ctx.provider as { list: unknown }).list = async () => ({
      data: [{ id: "openai", models: { "gpt-4o": {} } }],
    });

    const result = await tool.execute({ prompt: "do it" }, toolCtx("ses_main"));

    expect(result.metadata.partial).toBe(false);
    expect(result.output).toContain("openai/gpt-4o");
  });

  it("Given provider.list fails When executed Then models from model.list still resolve", async () => {
    const { tool, toolCtx, ctx } = await setupTool({ workers: ["openai/gpt-4o"] });
    (ctx.provider as { list: unknown }).list = async () => {
      throw new Error("provider.list unavailable");
    };

    const result = await tool.execute({ prompt: "do it" }, toolCtx("ses_main"));

    expect(result.metadata.partial).toBe(false);
    expect(result.output).toContain("openai/gpt-4o");
  });

  it("Given the host exposes no ctx.model When executed Then it keeps working from provider.list", async () => {
    const { tool, toolCtx, ctx } = await setupTool({ workers: ["openai/gpt-4o"] });
    delete (ctx as { model?: unknown }).model;
    (ctx.provider as { list: unknown }).list = async () => ({
      data: [{ id: "openai", models: { "gpt-4o": {} } }],
    });

    const result = await tool.execute({ prompt: "do it" }, toolCtx("ses_main"));

    expect(result.metadata.partial).toBe(false);
    expect(result.output).toContain("openai/gpt-4o");
  });

  it("Given a model absent from both catalogues When executed Then it is reported as unknown", async () => {
    const { tool, toolCtx, ctx } = await setupTool({ workers: ["google/ghost"] });
    (ctx.model as { list: unknown }).list = async () => ({ data: [] });

    const result = await tool.execute({ prompt: "do it" }, toolCtx("ses_main"));

    expect(result.metadata.partial).toBe(true);
    expect(result.output).toContain("Unknown model: google/ghost");
  });
});
