import { describe, expect, it, mock } from "bun:test";
import { sleep } from "bun";
import type { ToolContext, ToolDefinition } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { moaFusionTool } from "../src/tool.js";
import { makeMockClient, type MockClient, type MockPromptData } from "./_fixtures/mockClient.js";

type ToolResult = Awaited<ReturnType<ToolDefinition["execute"]>>;
type ObjectToolResult = { output: string; metadata: { partial: boolean } };

function expectObject(res: ToolResult): asserts res is ObjectToolResult {
  if (typeof res === "string" || !res.metadata) {
    throw new Error("Expected object tool result with metadata");
  }
}

describe("tool [Component]", () => {
  const getTool = (client: MockClient, options?: Record<string, unknown>) => {
    return moaFusionTool(client, options);
  };

  const getClientWithModels = (
    onPrompt?: (sessionID: string, body: import("./_fixtures/mockClient.js").MockPromptBody) => Promise<MockPromptData> | Promise<never>,
  ) => {
    return makeMockClient({
      onPrompt,
      providers: async () => ({
        data: {
          providers: [
            {
              id: "p",
              name: "p",
              source: "config",
              env: [],
              options: {},
              models: {
                m1: {} as import("./_fixtures/mockClient.js").MockModel,
                m2: {} as import("./_fixtures/mockClient.js").MockModel,
                m3: {} as import("./_fixtures/mockClient.js").MockModel,
                m: {} as import("./_fixtures/mockClient.js").MockModel,
                slow: {} as import("./_fixtures/mockClient.js").MockModel,
                fast: {} as import("./_fixtures/mockClient.js").MockModel,
              },
            },
          ],
          default: {},
        },
      }),
    });
  };

  const ctxFor = (overrides: Partial<ToolContext> = {}): ToolContext => ({
    sessionID: "s",
    messageID: "m",
    agent: "general",
    directory: "/mock",
    worktree: "/mock",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
    ...overrides,
  });

  describe("Scenario: happy path", () => {
    it("Given 3 workers When executed Then returns text output with all worker outputs", async () => {
      let promptIndex = 0;
      const client = getClientWithModels(async () => {
        promptIndex++;
        return { parts: [{ type: "text", text: `output_${promptIndex}` }] };
      });
      const toolObj = getTool(client, {});

      const metadata = mock(() => {});
      const ctx = ctxFor({ sessionID: "s1", messageID: "m1", metadata });
      const args = {
        prompt: "hello",
        workers: ["p/m1", "p/m2", "p/m3"],
      };

      const res = await toolObj.execute(args, ctx);
      expectObject(res);

      expect(res.output).toContain("output_1");
      expect(res.output).toContain("output_2");
      expect(res.output).toContain("output_3");
      expect(res.output).toContain("Worker 1");
      expect(res.output).toContain("Worker 2");
      expect(res.output).toContain("Worker 3");
      expect(res.output).toContain("Original prompt");
      expect(res.output).toContain("hello");
      expect(res.metadata.partial).toBe(false);

      expect(metadata).toHaveBeenCalled();
    });
  });

  describe("Scenario: partial worker failure", () => {
    it("Given 1 worker fails When executed Then output includes error, partial=true", async () => {
      const client = getClientWithModels(async (_, body) => {
        if (body.model?.modelID === "m2") throw new Error("fail2");
        return { parts: [{ type: "text", text: "ok" }] };
      });
      const toolObj = getTool(client, {});
      const res = await toolObj.execute(
        { prompt: "P", workers: ["p/m1", "p/m2", "p/m3"] },
        ctxFor(),
      );
      expectObject(res);

      expect(res.output).toContain("ok");
      expect(res.output).toContain("fail2");
      expect(res.output).toContain("failed:");
      expect(res.metadata.partial).toBe(true);
    });
  });

  describe("Scenario: all workers fail", () => {
    it("Given all fail When executed Then output includes all errors", async () => {
      const client = getClientWithModels(async () => {
        throw new Error("fail");
      });
      const toolObj = getTool(client, {});
      const res = await toolObj.execute({ prompt: "P", workers: ["p/m1", "p/m2"] }, ctxFor());
      expectObject(res);

      expect(res.output).toContain("fail");
      expect(res.output).toContain("failed:");
      expect(res.metadata.partial).toBe(true);
      expect(client.__spy.promptCalls.length).toBe(2);
    });
  });

  describe("Scenario: RoleResolutionError", () => {
    it("Given bad config When executed Then returns output message string without session calls", async () => {
      const client = getClientWithModels();
      const toolObj = getTool(client, {});
      const res = await toolObj.execute({ prompt: "P" }, ctxFor());
      expectObject(res);
      expect(res.metadata.partial).toBe(true);
      expect(res.output).toContain("no models configured");
      expect(client.__spy.createCalls.length).toBe(0);
    });
  });

  describe("Scenario: ctx.metadata called before worker prompt", () => {
    it("Given happy path When executed Then ctx.metadata is called first", async () => {
      const callOrder: string[] = [];
      const client = getClientWithModels(async () => {
        callOrder.push("prompt");
        return { parts: [{ type: "text", text: "ok" }] };
      });
      const toolObj = getTool(client, {});
      await toolObj.execute(
        { prompt: "P", workers: ["p/m1"] },
        ctxFor({
          metadata: () => {
            callOrder.push("metadata");
          },
        }),
      );
      expect(callOrder[0]).toBe("metadata");
    });
  });

  describe("Scenario: Promise.all concurrency", () => {
    it("Given slow worker and fast worker When executed Then they run concurrently", async () => {
      const client = getClientWithModels(async (_, body) => {
        if (body.model?.modelID === "slow") {
          await sleep(50);
        }
        return { parts: [{ type: "text", text: "ok" }] };
      });
      const toolObj = getTool(client, {});
      const start = Date.now();
      await toolObj.execute({ prompt: "P", workers: ["p/slow", "p/fast"] }, ctxFor());
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(80);
    });
  });

  describe("Scenario: recursion guard", () => {
    it("Given run When executed Then all prompt calls have tools.moa_fusion=false", async () => {
      const client = getClientWithModels(async () => ({
        parts: [{ type: "text", text: "ok" }],
      }));
      const toolObj = getTool(client, {});
      await toolObj.execute({ prompt: "P", workers: ["p/m1"] }, ctxFor());
      for (const call of client.__spy.promptCalls) {
        expect(call.body.tools).toEqual({ moa_fusion: false });
      }
    });
  });

  describe("Scenario: sessions are NOT deleted", () => {
    it("Given run When executed Then no session.delete calls are made", async () => {
      const client = getClientWithModels(async () => ({
        parts: [{ type: "text", text: "ok" }],
      }));
      const toolObj = getTool(client, {});
      await toolObj.execute({ prompt: "P", workers: ["p/m1", "p/m2"] }, ctxFor());
      expect(client.__spy.deleteCalls.length).toBe(0);
    });
  });

  describe("Scenario: output includes session IDs", () => {
    it("Given run When executed Then output includes session IDs for each worker", async () => {
      const client = getClientWithModels(async () => ({
        parts: [{ type: "text", text: "ok" }],
      }));
      const toolObj = getTool(client, {});
      const res = await toolObj.execute({ prompt: "P", workers: ["p/m1"] }, ctxFor());
      expectObject(res);
      expect(res.output).toContain("session:");
      expect(res.output).toContain("mock_session_1");
    });
  });

  describe("Scenario: Plugin entry (default export)", () => {
    it("Given importing default When invoked as Plugin Then returns Hooks with tool.moa_fusion", async () => {
      const plugin = (await import("../src/index.js")).default;
      const client: OpencodeClient = getClientWithModels();
      const hooks = await plugin({ client, project: {} as never, directory: "/mock", worktree: "/mock", experimental_workspace: { register: () => {} }, serverUrl: new URL("http://localhost"), $: {} as never });
      expect(hooks).toBeDefined();
      expect(hooks.tool).toBeDefined();
      expect(hooks.tool?.moa_fusion).toBeDefined();
      expect(hooks.tool?.moa_fusion?.description).toBeTruthy();
    });
  });
});
