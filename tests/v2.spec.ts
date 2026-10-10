import { describe, expect, it } from "bun:test";
import { SYNTHESIS_INSTRUCTIONS } from "../src/core.js";
import { createMoaFusionV2 } from "../src/v2.js";

type ToolInfo = {
  name: string;
  description: string;
  input: unknown;
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

  const provider = {
    list: async () => ({
      location: { directory: "/mock" },
      data: [{ id: "openai", models: { "gpt-4o-mini": {}, "gpt-4o": {} } }],
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
});
