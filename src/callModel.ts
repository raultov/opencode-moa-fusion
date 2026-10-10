import type { AssistantMessage, OpencodeClient, Part } from "@opencode-ai/sdk";
import { READ_ONLY_DIRECTIVE, type WorkerCall, wrapUserPrompt } from "./core.js";
import { partsToText } from "./extract.js";
import { sanitizeErrorMessage } from "./sanitize.js";
import type { WorkerResult } from "./types.js";

// Re-exported for existing consumers and tests.
export { READ_ONLY_DIRECTIVE, wrapUserPrompt } from "./core.js";

type SessionCreateBody = NonNullable<Parameters<OpencodeClient["session"]["create"]>[0]>["body"];

type ExtendedSessionCreateBody = SessionCreateBody & {
  agent?: string;
};

type PromptResult = {
  data: { info: AssistantMessage; parts: Part[] } | undefined;
  error: { name?: string; data?: { message?: string } } | undefined;
  request: Request;
  response: Response;
};

export type CallModelOpts = WorkerCall & {
  client: OpencodeClient;
};

export async function callModel(opts: CallModelOpts): Promise<WorkerResult> {
  const start = Date.now();
  const modelStr = `${opts.model.providerID}/${opts.model.modelID}`;
  let childSessionID: string | undefined;

  try {
    const createRes = await opts.client.session.create({
      body: {
        parentID: opts.parentID,
        title: `moa:${opts.model.modelID}`,
        agent: opts.agent || "general",
      } as ExtendedSessionCreateBody,
    });

    childSessionID = createRes.data?.id;
    if (!childSessionID) {
      return {
        ok: false,
        model: modelStr,
        error: "Failed to create child session, no ID returned",
        elapsedMs: Date.now() - start,
      };
    }

    const ac = new AbortController();
    const onOuterAbort = () => ac.abort(new Error("aborted"));
    opts.abort.addEventListener("abort", onOuterAbort);
    if (opts.abort.aborted) onOuterAbort();

    const timeoutId = setTimeout(() => ac.abort(new Error("timeout")), opts.timeoutMs);

    let promptRes: PromptResult | undefined;
    let promptError: unknown;

    // Compose the system channel: READ_ONLY_DIRECTIVE is always prepended.
    // If the caller passes their own opts.system, we append it after, so
    // the read-only directive always wins (defence in depth against
    // prompt injection that reaches the system channel).
    const system = opts.system ? `${READ_ONLY_DIRECTIVE}\n\n${opts.system}` : READ_ONLY_DIRECTIVE;

    try {
      promptRes = await opts.client.session.prompt({
        path: { id: childSessionID },
        body: {
          model: opts.model,
          agent: opts.agent || "general",
          system,
          parts: [{ type: "text", text: wrapUserPrompt(opts.text) }],
          tools: { ...(opts.tools || {}), moa_fusion: false },
        },
        signal: ac.signal,
      });
    } catch (e) {
      promptError = e;
    } finally {
      clearTimeout(timeoutId);
      opts.abort.removeEventListener("abort", onOuterAbort);
    }

    let errStr: string | undefined;

    if (ac.signal.aborted) {
      errStr = sanitizeErrorMessage(ac.signal.reason || "aborted");
    } else if (promptError) {
      errStr = sanitizeErrorMessage(promptError);
    } else if (promptRes?.error) {
      errStr = sanitizeErrorMessage(promptRes.error);
    }

    if (errStr !== undefined) {
      return {
        ok: false,
        model: modelStr,
        sessionID: childSessionID,
        error: errStr,
        elapsedMs: Date.now() - start,
      };
    }

    const parts = promptRes?.data?.parts || [];
    const output = partsToText(parts);

    return {
      ok: true,
      model: modelStr,
      sessionID: childSessionID,
      output,
      elapsedMs: Date.now() - start,
    };
  } catch (e) {
    return {
      ok: false,
      model: modelStr,
      error: sanitizeErrorMessage(e),
      elapsedMs: Date.now() - start,
    };
  }
}
