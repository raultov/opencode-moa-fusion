import { describe, expect, it } from "bun:test";
import { assistantText, createV2WorkerRunner, type V2SessionClient } from "../src/callModelV2.js";
import { READ_ONLY_DIRECTIVE } from "../src/core.js";

type Call = Parameters<ReturnType<typeof createV2WorkerRunner>>[0];

const baseCall = (over: Partial<Call> = {}): Call => ({
  parentID: "ses_parent",
  model: { providerID: "openai", modelID: "gpt-4o-mini" },
  text: "analyze this",
  agent: "general",
  abort: new AbortController().signal,
  timeoutMs: 5000,
  ...over,
});

type Script = {
  create?: () => Promise<{ id?: string }>;
  prompt?: (input?: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
  wait?: () => Promise<void>;
  context?: () => Promise<unknown[]>;
};

/** Hanging prompt that rejects on abort, like the real client with a signal. */
const hangingPrompt = (ms: number) => (_input?: unknown, options?: { signal?: AbortSignal }) =>
  new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (signal) {
      const fail = () => reject(signal.reason ?? new Error("aborted"));
      if (signal.aborted) return fail();
      signal.addEventListener("abort", fail);
    }
    setTimeout(() => resolve({}), ms);
  });

function makeSession(script: Script = {}) {
  const calls: {
    create: unknown[];
    prompt: unknown[];
    wait: unknown[];
    context: unknown[];
  } = { create: [], prompt: [], wait: [], context: [] };
  const session: V2SessionClient = {
    create: (async (input: unknown) => {
      calls.create.push(input);
      return (script.create ? await script.create() : { id: "ses_child" }) as never;
    }) as never,
    prompt: (async (input: unknown, options?: { signal?: AbortSignal }) => {
      calls.prompt.push(input);
      return (script.prompt ? await script.prompt(input, options) : {}) as never;
    }) as never,
    wait: (async (input: unknown) => {
      calls.wait.push(input);
      if (script.wait) await script.wait();
      return undefined as never;
    }) as never,
    context: (async (input: unknown) => {
      calls.context.push(input);
      return (script.context ? await script.context() : []) as never;
    }) as never,
  };
  return { session, calls };
}

const assistant = (text: string) => ({
  type: "assistant",
  content: [{ type: "text", text }],
});

describe("createV2WorkerRunner [Component]", () => {
  it("Given a healthy worker When run Then creates a child session with model and agent and returns its text", async () => {
    const { session, calls } = makeSession({
      context: async () => [{ type: "user" }, assistant("worker says hi")],
    });
    const run = createV2WorkerRunner(session);

    const result = await run(baseCall());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe("worker says hi");
      expect(result.model).toBe("openai/gpt-4o-mini");
      expect(result.sessionID).toBe("ses_child");
    }
    expect(calls.create[0]).toMatchObject({
      parentID: "ses_parent",
      title: "moa:gpt-4o-mini",
      agent: "general",
      model: { id: "gpt-4o-mini", providerID: "openai" },
    });
  });

  it("Given a worker When run Then folds the read-only directive and wraps the prompt in the text", async () => {
    const { session, calls } = makeSession();
    const run = createV2WorkerRunner(session);

    await run(baseCall({ text: "hello", system: "extra" }));

    const prompt = calls.prompt[0] as { text: string };
    expect(prompt.text).toContain(READ_ONLY_DIRECTIVE);
    expect(prompt.text).toContain("extra");
    expect(prompt.text).toContain("<user_prompt>\nhello\n</user_prompt>");
  });

  it("Given a create response without id When run Then returns a failed result", async () => {
    const { session } = makeSession({ create: async () => ({}) });
    const run = createV2WorkerRunner(session);

    const result = await run(baseCall());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no ID returned");
  });

  it("Given a worker that times out When run Then returns a failed result", async () => {
    const { session } = makeSession({
      prompt: hangingPrompt(5000),
    });
    const run = createV2WorkerRunner(session);

    const result = await run(baseCall({ timeoutMs: 20 }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("timeout");
  });

  it("Given an aborted outer signal When run Then returns a failed result", async () => {
    const ac = new AbortController();
    const { session } = makeSession({
      prompt: hangingPrompt(5000),
    });
    const run = createV2WorkerRunner(session);
    const promise = run(baseCall({ abort: ac.signal, timeoutMs: 5000 }));
    ac.abort(new Error("aborted"));

    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("abort");
  });

  it("Given worker tracking When run Then registers the child session id", async () => {
    const { session } = makeSession();
    const seen = new Set<string>();
    const run = createV2WorkerRunner(session, seen);

    await run(baseCall());

    expect(seen.has("ses_child")).toBe(true);
  });

  it("Given several assistant messages When extracting text Then the last assistant message wins", () => {
    const text = assistantText([assistant("first"), { type: "user" }, assistant("second")]);
    expect(text).toBe("second");
  });

  it("Given no assistant message When extracting text Then returns empty", () => {
    expect(assistantText([{ type: "user" }])).toBe("");
    expect(assistantText([])).toBe("");
  });
});
