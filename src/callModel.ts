import type { AssistantMessage, OpencodeClient, Part } from "@opencode-ai/sdk";
import { partsToText } from "./extract.js";
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
Provide your proposed solution or analysis in text format only. The orchestrator agent will handle any actual file modifications.
[USER PROMPT BELOW]`;

export function wrapReadOnly(text: string): string {
  return `${READ_ONLY_DIRECTIVE}\n\n${text}`;
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
    if (opts.abort.aborted) onOuterAbort();
    opts.abort.addEventListener("abort", onOuterAbort);

    const timeoutId = setTimeout(() => ac.abort(new Error("timeout")), opts.timeoutMs);

    let promptRes: PromptResult | undefined;
    let promptError: unknown;

    try {
      promptRes = await opts.client.session.prompt({
        path: { id: childSessionID },
        body: {
          model: opts.model,
          agent: opts.agent || "general",
          ...(opts.system ? { system: opts.system } : {}),
          parts: [{ type: "text", text: wrapReadOnly(opts.text) }],
          tools: { moa_fusion: false },
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
      errStr =
        ac.signal.reason instanceof Error
          ? ac.signal.reason.message
          : String(ac.signal.reason || "aborted");
    } else if (promptError) {
      errStr = promptError instanceof Error ? promptError.message : String(promptError);
    } else if (promptRes?.error) {
      errStr =
        typeof promptRes.error === "string" ? promptRes.error : JSON.stringify(promptRes.error);
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
      error: e instanceof Error ? e.message : String(e),
      elapsedMs: Date.now() - start,
    };
  }
}
