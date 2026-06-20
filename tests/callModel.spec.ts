import { describe, expect, it } from "bun:test";
import type { Part } from "@opencode-ai/sdk";
import { callModel, wrapReadOnly } from "../src/callModel.js";
import { makeMockClient } from "./_fixtures/mockClient.js";

describe("callModel [Component]", () => {
  describe("Scenario: happy path", () => {
    it("Given happy path When callModel is called Then it creates and prompts correctly, does NOT delete", async () => {
      const client = makeMockClient({
        onPrompt: async () => ({
          parts: [{ type: "text", text: "success_output" }],
        }),
      });
      const abort = new AbortController().signal;
      const result = await callModel({
        client,
        parentID: "parent_1",
        model: { providerID: "openai", modelID: "gpt-4o-mini" },
        text: "hello world",
        system: "sys_prompt",
        abort,
        timeoutMs: 1000,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toBe("success_output");
        expect(result.model).toBe("openai/gpt-4o-mini");
        expect(result.sessionID).toBe("mock_session_1");
        expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      }

      expect(client.__spy.createCalls).toHaveLength(1);
      expect(client.__spy.createCalls[0].body?.parentID).toBe("parent_1");
      expect(client.__spy.createCalls[0].body?.title).toBe("moa:gpt-4o-mini");

      expect(client.__spy.promptCalls).toHaveLength(1);
      const promptBody = client.__spy.promptCalls[0].body;
      expect(promptBody.model).toEqual({ providerID: "openai", modelID: "gpt-4o-mini" });
      expect(promptBody.system).toBe("sys_prompt");
      expect(promptBody.parts).toEqual(
        [{ type: "text", text: wrapReadOnly("hello world") }] as Part[],
      );
      expect(promptBody.tools).toEqual({ moa_fusion: false });

      expect(client.__spy.deleteCalls).toHaveLength(0);
    });
  });

  describe("Scenario: session.prompt rejects", () => {
    it("Given prompt throws When callModel is called Then returns error result, does NOT delete", async () => {
      const client = makeMockClient({
        onPrompt: async () => {
          throw new Error("prompt failed");
        },
      });
      const result = await callModel({
        client,
        parentID: "p1",
        model: { providerID: "p", modelID: "m" },
        text: "t",
        abort: new AbortController().signal,
        timeoutMs: 1000,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("prompt failed");
        expect(result.sessionID).toBe("mock_session_1");
      }
      expect(client.__spy.deleteCalls).toHaveLength(0);
    });
  });

  describe("Scenario: session.create rejects", () => {
    it("Given create throws When callModel is called Then returns error and does NOT delete", async () => {
      const client = makeMockClient();
      client.session.create = async () => {
        throw new Error("create failed");
      };
      const result = await callModel({
        client,
        parentID: "p1",
        model: { providerID: "p", modelID: "m" },
        text: "t",
        abort: new AbortController().signal,
        timeoutMs: 1000,
      });
      expect(result.ok).toBe(false);
      expect(client.__spy.deleteCalls).toHaveLength(0);
    });
  });

  describe("Scenario: per-call timeout exceeded", () => {
    it("Given slow prompt When callModel is called Then returns timeout error", async () => {
      const client = makeMockClient({
        onPrompt: async () => new Promise((r) => setTimeout(r, 100)),
      });
      const result = await callModel({
        client,
        parentID: "p1",
        model: { providerID: "p", modelID: "m" },
        text: "t",
        abort: new AbortController().signal,
        timeoutMs: 10,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("timeout");
        expect(result.elapsedMs).toBeGreaterThanOrEqual(10);
      }
      expect(client.__spy.deleteCalls).toHaveLength(0);
    });
  });

  describe("Scenario: outer ctx.abort fires", () => {
    it("Given outer abort When callModel is called Then returns aborted error", async () => {
      const ac = new AbortController();
      const client = makeMockClient({
        onPrompt: async () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ parts: [] }), 50);
          }),
      });
      setTimeout(() => ac.abort(), 10);
      const result = await callModel({
        client,
        parentID: "p1",
        model: { providerID: "p", modelID: "m" },
        text: "t",
        abort: ac.signal,
        timeoutMs: 1000,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("aborted");
      }
      expect(client.__spy.deleteCalls).toHaveLength(0);
    });
  });
});
