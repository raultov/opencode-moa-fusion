import { describe, expect, it } from "bun:test";
import { callModel, READ_ONLY_DIRECTIVE, wrapUserPrompt } from "../src/callModel.js";
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
      expect(promptBody.parts as unknown as Array<{ type: "text"; text: string }>).toEqual([
        { type: "text", text: wrapUserPrompt("hello world") },
      ]);
      expect(promptBody.tools).toEqual({ moa_fusion: false });

      expect(client.__spy.deleteCalls).toHaveLength(0);
    });
  });

  describe("Scenario: READ_ONLY_DIRECTIVE placement (Step 5 / consensus #5)", () => {
    it("Given no opts.system When callModel is called Then system field equals READ_ONLY_DIRECTIVE", async () => {
      const client = makeMockClient({
        onPrompt: async () => ({ parts: [{ type: "text", text: "ok" }] }),
      });
      await callModel({
        client,
        parentID: "p",
        model: { providerID: "p", modelID: "m" },
        text: "hello",
        abort: new AbortController().signal,
        timeoutMs: 1000,
      });
      expect(client.__spy.promptCalls[0].body.system).toBe(READ_ONLY_DIRECTIVE);
    });

    it("Given opts.system When callModel is called Then system field prepends READ_ONLY_DIRECTIVE before opts.system", async () => {
      const client = makeMockClient({
        onPrompt: async () => ({ parts: [{ type: "text", text: "ok" }] }),
      });
      await callModel({
        client,
        parentID: "p",
        model: { providerID: "p", modelID: "m" },
        text: "hello",
        system: "caller-supplied system",
        abort: new AbortController().signal,
        timeoutMs: 1000,
      });
      const sys = client.__spy.promptCalls[0].body.system as string;
      expect(sys.startsWith(READ_ONLY_DIRECTIVE)).toBe(true);
      expect(sys).toContain("caller-supplied system");
      // Directive must come first — no caller value should be able to
      // shadow it.
      expect(sys.indexOf(READ_ONLY_DIRECTIVE)).toBe(0);
      expect(sys.indexOf("caller-supplied system")).toBeGreaterThan(
        sys.indexOf(READ_ONLY_DIRECTIVE),
      );
    });

    it("Given any prompt When callModel is called Then the user prompt is wrapped in <user_prompt>...</user_prompt>", async () => {
      const client = makeMockClient({
        onPrompt: async () => ({ parts: [{ type: "text", text: "ok" }] }),
      });
      await callModel({
        client,
        parentID: "p",
        model: { providerID: "p", modelID: "m" },
        text: "the actual user payload",
        abort: new AbortController().signal,
        timeoutMs: 1000,
      });
      const part = client.__spy.promptCalls[0].body.parts[0] as { type: "text"; text: string };
      const text = part.text;
      expect(text).toContain("<user_prompt>");
      expect(text).toContain("the actual user payload");
      expect(text).toContain("</user_prompt>");
      expect(text).toBe(wrapUserPrompt("the actual user payload"));
    });

    it("Given any prompt When callModel is called Then the legacy '[USER PROMPT BELOW]' marker is gone", async () => {
      const client = makeMockClient({
        onPrompt: async () => ({ parts: [{ type: "text", text: "ok" }] }),
      });
      await callModel({
        client,
        parentID: "p",
        model: { providerID: "p", modelID: "m" },
        text: "hello",
        abort: new AbortController().signal,
        timeoutMs: 1000,
      });
      const sys = client.__spy.promptCalls[0].body.system as string;
      const part = client.__spy.promptCalls[0].body.parts[0] as { type: "text"; text: string };
      const text = part.text;
      expect(sys).not.toContain("[USER PROMPT BELOW]");
      expect(text).not.toContain("[USER PROMPT BELOW]");
    });

    it("Given the READ_ONLY_DIRECTIVE constant When read Then it does not contain the legacy '[USER PROMPT BELOW]' marker", () => {
      expect(READ_ONLY_DIRECTIVE).not.toContain("[USER PROMPT BELOW]");
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

    it("Given signal already aborted before call When callModel is called Then returns aborted error (M6 / TOCTOU)", async () => {
      const ac = new AbortController();
      ac.abort();
      const client = makeMockClient({
        onPrompt: async () => ({ parts: [] }),
      });
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
    });
  });

  describe("Scenario: error messages are sanitized (M1 / information leak)", () => {
    it("Given prompt rejects with an error containing a filesystem path When callModel is called Then the error is sanitized", async () => {
      const client = makeMockClient({
        onPrompt: async () => {
          throw new Error("EACCES: /Users/victim/.opencode/sessions/abc.json");
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
        expect(result.error).not.toContain("/Users/victim");
        expect(result.error).toContain("<path>");
      }
    });

    it("Given session.create rejects with a path-bearing error When callModel is called Then the error is sanitized", async () => {
      const client = makeMockClient();
      client.session.create = async () => {
        throw new Error("cannot create session at /home/user/.config/opencode/x");
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
      if (!result.ok) {
        expect(result.error).not.toContain("/home/user");
      }
    });
  });
});
