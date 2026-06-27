import type { AssistantMessage, OpencodeClient, Part } from "@opencode-ai/sdk";
import { partsToText } from "./extract.js";
import { sanitizeErrorMessage } from "./sanitize.js";
import type { ModelRef, WorkerResult } from "./types.js";

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

export const READ_ONLY_DIRECTIVE = `[SYSTEM DIRECTIVE: EXTREME IMPORTANCE]
You are a worker node in a Mixture-of-Agents (MoA) architecture.
Your role is strictly READ-ONLY.
You MUST NOT attempt to modify any files, write code to disk, or execute destructive bash commands.
If you need to analyze the codebase, use read, glob, grep, or knot tools.
Provide your proposed solution or analysis in text format only. The orchestrator agent will handle any actual file modifications.`;

/**
 * Wraps the user-supplied prompt in unambiguous XML-style boundary markers.
 * Even if the provider/model ignores the `system` channel, the worker still
 * has a clear start/end for the user payload and cannot be tricked into
 * "overriding previous instructions" by an injected payload that runs past
 * a textual delimiter.
 */
export function wrapUserPrompt(text: string): string {
  return `<user_prompt>\n${text}\n</user_prompt>`;
}

export type CallModelOpts = {
  client: OpencodeClient;
  parentID: string;
  model: ModelRef;
  text: string;
  system?: string;
  agent?: string;
  abort: AbortSignal;
  timeoutMs: number;
  tools?: Record<string, boolean>;
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
